/* ================================================================
   상품관리 — 상품 수정 서비스 (상세 패널 [수정] 탭)
   - 최신 상세 받기 → 수정 폼 보기 모델 (toEditableView)
   - 배송·반품: 상품 수정(승인불필요, partial) — 바로 반영 (applyShippingEdits)
   - 상품 정보 · 옵션 값: 상품 수정(승인필요) — 저장 직전에 상세를 다시 받아 바꾼 칸만 덮어써
     전문을 그대로 PUT (mergeProductEdits · submitProductEdits). requested=true 로 승인요청까지 한 번에
   - 쿠팡이 성공해야 DB 를 고친다. 재승인 수정은 승인 뒤에 값이 바뀌므로 상세를 다시 받아 맞춘다
   - 설계: docs/plan-coupang-product-edit.md
   ================================================================ */

import { supabase } from './supabase'
import { fetchRgProductDetail, getCoupangHeaders } from './purchaseService'
import { assertProxyOk, syncProductDetails } from './coupangProductService'
import type {
  ChannelKey,
  ChannelValues,
  EditableItemView,
  EditableProductView,
  ProductEdits,
  ShippingEdits,
  ShippingValues,
} from '../types/coupangProductEdit'

// ── 상수 ──────────────────────────────────────────────────────────
const TABLE = 'si_coupang_items'
export const SEARCH_TAG_MAX_COUNT = 20      // 쿠팡: 검색태그 최대 20개
export const SEARCH_TAG_MAX_LENGTH = 20     // 쿠팡: 태그 1개당 20자 이내
export const FREE_SHIP_UNIT = 100           // 쿠팡: 조건부 무료 기준 금액 100원 단위
/** 쿠팡이 "임시저장·승인대기 상품은 수정할 수 없다" 고 한 상태 (partial) · 승인대기 중 재수정도 막는다 */
export const EDIT_LOCKED_STATUSES = ['임시저장', '임시저장중', '승인대기', '승인대기중', '심사중']
/**
 * 수정 요청 직후 잠깐 거치는 상태 — 쿠팡은 임시저장 → 승인대기중 → (자동 승인이면) 승인완료 를
 * 1초 안에 지나가기도 한다 (2026-10-20 운영 실측). 이 상태일 때 상세를 저장하면 옛 값이 남는다.
 */
const TRANSIENT_STATUSES = ['임시저장', '임시저장중']
const SETTLE_POLL_INTERVAL_MS = 1500   // 상태 다시 보기 간격
const SETTLE_POLL_MAX_TRIES = 7        // 최대 약 10초 기다린다 (그 뒤엔 그때 상태로 저장)
/** 쿠팡 로켓그로스 상품 수정 문서: additionalInformationForRocketGrowth.legalAgreement — 'AGREE' 가 아니면 처리 안 됨 */
const ROCKET_GROWTH_LEGAL_AGREEMENT = 'AGREE'
/** 하이브리드 응답의 채널 데이터 키 — 상세는 소문자 p, 목록은 대문자 P 로 온다 */
const MP_DATA_KEYS = ['marketplaceItemData', 'marketPlaceItemData'] as const
const RG_DATA_KEY = 'rocketGrowthItemData'

type Json = Record<string, any>

// ══════════════════════════════════════════════════════════════════
// 상세 응답 → 수정 폼 보기 모델
// ══════════════════════════════════════════════════════════════════

/** 옵션의 일반 채널 데이터 (없으면 null) */
function mpData(item: Json): Json | null {
  for (const k of MP_DATA_KEYS) if (item[k]) return item[k]
  return null
}

/**
 * 옵션 키 — 저장 직전에 다시 받은 응답과 화면의 옵션을 맞춘다.
 * 등록옵션 ID(sellerProductItemId)가 옵션마다 고유하고 수정해도 그대로라 그것을 쓴다.
 */
export function itemKey(item: Json): string {
  const id = item.sellerProductItemId ?? mpData(item)?.sellerProductItemId ?? item[RG_DATA_KEY]?.sellerProductItemId
    ?? item.vendorItemId ?? mpData(item)?.vendorItemId ?? item[RG_DATA_KEY]?.vendorItemId
  return id != null ? String(id) : ''
}

function str(v: unknown): string {
  return v == null ? '' : String(v)
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** 옵션의 채널별 값 — 순수 일반상품은 flat 하나, 하이브리드는 일반/로켓 각각 */
function itemChannels(item: Json): EditableItemView['channels'] {
  const mp = mpData(item)
  const rg = item[RG_DATA_KEY] as Json | null | undefined
  const view = (key: ChannelKey, label: string, d: Json) => ({
    key,
    label,
    vendorItemId: d.vendorItemId != null ? String(d.vendorItemId) : null,
    barcode: str(d.barcode),
    modelNo: str(d.modelNo),
    externalVendorSku: str(d.externalVendorSku),
  })
  if (mp || rg) {
    const out: EditableItemView['channels'] = []
    if (mp) out.push(view('mp', '일반', mp))
    if (rg) out.push(view('rg', '로켓', rg))
    return out
  }
  return [view('flat', '일반', item)]
}

/** 배송·반품 값 — 하이브리드는 marketplaceShippingAndReturnInfo, 순수 일반은 최상위. 로켓 전용은 null */
function shippingValues(detail: Json, kind: EditableProductView['kind']): ShippingValues | null {
  const src: Json | null = detail.marketplaceShippingAndReturnInfo ?? (kind === 'mp' ? detail : null)
  if (!src) return null
  return {
    deliveryMethod: src.deliveryMethod ?? null,
    deliveryCompanyCode: src.deliveryCompanyCode ?? null,
    deliveryChargeType: src.deliveryChargeType ?? null,
    deliveryCharge: numOrNull(src.deliveryCharge),
    freeShipOverAmount: numOrNull(src.freeShipOverAmount),
    deliveryChargeOnReturn: numOrNull(src.deliveryChargeOnReturn),
    returnCharge: numOrNull(src.returnCharge),
    remoteAreaDeliverable: src.remoteAreaDeliverable ?? null,
    unionDeliveryType: src.unionDeliveryType ?? null,
    outboundShippingTimeDay: numOrNull(src.outboundShippingTimeDay ?? detail.items?.[0]?.outboundShippingTimeDay),
  }
}

export function toEditableView(detail: Json): EditableProductView {
  const items: Json[] = Array.isArray(detail.items) ? detail.items : []
  const hasMp = items.some((it) => mpData(it) || (!it[RG_DATA_KEY] && !mpData(it)))
  const hasRg = items.some((it) => !!it[RG_DATA_KEY])
  const kind: EditableProductView['kind'] = hasMp && hasRg ? 'hybrid' : hasRg ? 'rg' : 'mp'
  return {
    sellerProductId: String(detail.sellerProductId),
    statusName: detail.statusName ?? null,
    kind,
    info: {
      displayProductName: str(detail.displayProductName),
      sellerProductName: str(detail.sellerProductName),
      brand: str(detail.brand),
      manufacture: str(detail.manufacture),
      saleStartedAt: str(detail.saleStartedAt),
      saleEndedAt: str(detail.saleEndedAt),
    },
    searchTags: Array.isArray(items[0]?.searchTags) ? items[0].searchTags.map(String) : [],
    shipping: shippingValues(detail, kind),
    items: items.map((it) => ({
      key: itemKey(it),
      itemName: str(it.itemName),
      maximumBuyForPerson: numOrNull(it.maximumBuyForPerson),
      maximumBuyForPersonPeriod: numOrNull(it.maximumBuyForPersonPeriod),
      channels: itemChannels(it),
    })),
    readonly: {
      displayCategoryCode: numOrNull(detail.displayCategoryCode),
      offerCondition: items[0]?.offerCondition ?? null,
    },
  }
}

// ══════════════════════════════════════════════════════════════════
// 검증 (쿠팡에 보내기 전)
// ══════════════════════════════════════════════════════════════════

/** 재승인 수정 검증 — 문제 목록 (없으면 빈 배열) */
export function validateProductEdits(edits: ProductEdits): string[] {
  const problems: string[] = []
  const i = edits.info
  if (i.displayProductName !== undefined && !i.displayProductName.trim()) problems.push('노출상품명은 비울 수 없습니다.')
  if (i.sellerProductName !== undefined && !i.sellerProductName.trim()) problems.push('등록상품명은 비울 수 없습니다.')
  if (i.saleStartedAt && i.saleEndedAt && i.saleStartedAt > i.saleEndedAt) problems.push('판매 시작이 판매 종료보다 늦습니다.')
  if (edits.searchTags) {
    if (edits.searchTags.length > SEARCH_TAG_MAX_COUNT) problems.push(`검색태그는 최대 ${SEARCH_TAG_MAX_COUNT}개입니다.`)
    const long = edits.searchTags.filter((t) => t.length > SEARCH_TAG_MAX_LENGTH)
    if (long.length) problems.push(`검색태그는 ${SEARCH_TAG_MAX_LENGTH}자 이내: ${long.join(', ')}`)
  }
  for (const [key, it] of Object.entries(edits.items)) {
    if (it.itemName !== undefined && !it.itemName.trim()) problems.push(`옵션명은 비울 수 없습니다 (옵션 ${key}).`)
    for (const n of [it.maximumBuyForPerson, it.maximumBuyForPersonPeriod]) {
      if (n !== undefined && (!Number.isInteger(n) || n < 0)) problems.push(`인당 최대구매 값은 0 이상의 정수여야 합니다 (옵션 ${key}).`)
    }
    for (const [ch, v] of Object.entries(it.channels ?? {})) {
      // 바코드를 비우려면 쿠팡에 '바코드 없음 사유'를 따로 보내야 해서 여기서는 막는다
      if (v?.barcode !== undefined && !v.barcode.trim()) problems.push(`바코드는 비울 수 없습니다 (옵션 ${key} · ${ch}).`)
    }
  }
  return problems
}

const SHIPPING_FIELD_LABELS: Record<keyof ShippingValues, string> = {
  deliveryMethod: '배송방법',
  deliveryCompanyCode: '택배사 코드',
  deliveryChargeType: '배송비 종류',
  deliveryCharge: '기본 배송비',
  freeShipOverAmount: '무료배송 기준 금액',
  deliveryChargeOnReturn: '초도반품배송비',
  returnCharge: '반품배송비',
  remoteAreaDeliverable: '도서산간 배송',
  unionDeliveryType: '묶음배송',
  outboundShippingTimeDay: '출고 소요일',
}

/** 배송·반품 수정 검증 */
export function validateShippingEdits(edits: ShippingEdits): string[] {
  const problems: string[] = []
  for (const [k, v] of Object.entries(edits)) {
    // 빈 칸을 그대로 보내면 쿠팡에 null 이 간다 — 값을 지우는 수정은 받지 않는다
    if (v === null || v === '') problems.push(`${SHIPPING_FIELD_LABELS[k as keyof ShippingValues] ?? k}: 비울 수 없습니다.`)
    else if (typeof v === 'number' && (!Number.isInteger(v) || v < 0)) problems.push(`${SHIPPING_FIELD_LABELS[k as keyof ShippingValues] ?? k}: 0 이상의 정수여야 합니다.`)
  }
  if (edits.freeShipOverAmount != null && edits.freeShipOverAmount % FREE_SHIP_UNIT !== 0) {
    problems.push(`조건부 무료 기준 금액은 ${FREE_SHIP_UNIT}원 단위여야 합니다.`)
  }
  return problems
}

// ══════════════════════════════════════════════════════════════════
// 전문 머지 — 다시 받은 상세(raw)에 바꾼 칸만 덮어쓴다 (순수 함수)
// ══════════════════════════════════════════════════════════════════

const CHANNEL_FIELDS: (keyof ChannelValues)[] = ['barcode', 'modelNo', 'externalVendorSku']

/**
 * @returns PUT 본문 — raw 를 복사해 수정 칸만 바꾸고 requested=true(승인요청 자동)를 붙인 것
 * @throws 화면의 옵션이 다시 받은 응답에 없으면 (그 사이 옵션이 바뀜) — 덮어쓰지 않고 멈춘다
 */
export function mergeProductEdits(raw: Json, edits: ProductEdits): Json {
  const body: Json = structuredClone(raw)

  // ── 상품 단위 ──
  for (const [k, v] of Object.entries(edits.info)) {
    if (v !== undefined) body[k] = typeof v === 'string' ? v.trim() : v
  }

  // ── 옵션 단위 ──
  const items: Json[] = Array.isArray(body.items) ? body.items : []
  const byKey = new Map(items.map((it) => [itemKey(it), it]))
  for (const [key, it] of Object.entries(edits.items)) {
    const target = byKey.get(key)
    if (!target) throw new Error(`옵션 ${key} 를 쿠팡 최신 정보에서 찾지 못했습니다. 상세를 다시 열어 주세요.`)
    if (it.itemName !== undefined) target.itemName = it.itemName.trim()
    if (it.maximumBuyForPerson !== undefined) target.maximumBuyForPerson = it.maximumBuyForPerson
    if (it.maximumBuyForPersonPeriod !== undefined) target.maximumBuyForPersonPeriod = it.maximumBuyForPersonPeriod
    for (const [ch, values] of Object.entries(it.channels ?? {}) as [ChannelKey, Partial<ChannelValues>][]) {
      const dest = ch === 'flat' ? target : ch === 'mp' ? mpData(target) : target[RG_DATA_KEY]
      if (!dest) throw new Error(`옵션 ${key} 에 ${ch === 'rg' ? '로켓' : '일반'} 채널 정보가 없습니다.`)
      for (const f of CHANNEL_FIELDS) {
        if (values[f] !== undefined) dest[f] = values[f]!.trim()
      }
    }
  }

  // ── 검색태그 (모든 옵션) ──
  if (edits.searchTags) {
    const tags = edits.searchTags.map((t) => t.trim()).filter(Boolean)
    for (const it of items) it.searchTags = tags
  }

  // ── 로켓그로스 입고 불가 조건 동의 — 로켓·하이브리드 상품은 쿠팡이 요구한다 (2026-10-20 운영 실측:
  //    빠지면 "로켓그로스 입고 불가 조건을 확인하시고 동의해주세요" 로 거절). 사용자가 체크한 경우만 넣는다 ──
  if (hasRocketGrowth(raw)) {
    if (edits.rocketGrowthAgreement !== true) {
      throw new Error('로켓그로스 상품은 쿠팡의 "로켓그로스 입고 불가 조건" 동의가 있어야 수정할 수 있습니다. 동의 체크 후 다시 보내 주세요.')
    }
    body.additionalInformationForRocketGrowth = {
      ...(body.additionalInformationForRocketGrowth ?? {}),
      legalAgreement: ROCKET_GROWTH_LEGAL_AGREEMENT,
    }
  }

  body.requested = true
  return body
}

/** 로켓그로스 옵션이 하나라도 있는 상품인지 (로켓 전용 · 하이브리드) */
export function hasRocketGrowth(detail: Json): boolean {
  return Array.isArray(detail.items) && detail.items.some((it: Json) => !!it?.[RG_DATA_KEY])
}

/** 바뀐 칸이 하나라도 있는지 */
export function hasProductEdits(edits: ProductEdits): boolean {
  return Object.values(edits.info).some((v) => v !== undefined)
    || edits.searchTags !== undefined
    || Object.keys(edits.items).length > 0
}

// ══════════════════════════════════════════════════════════════════
// 쿠팡 호출
// ══════════════════════════════════════════════════════════════════

/** 최신 상세 (전문) — 수정 폼을 열 때와 재승인 수정을 보내기 직전에 받는다 */
export async function fetchLiveProductDetail(sellerProductId: string): Promise<Json> {
  return (await fetchRgProductDetail(Number(sellerProductId))) as unknown as Json
}

/** 수정이 막힌 상태인지 — 사유 또는 null */
export function editLockReason(statusName: string | null): string | null {
  if (statusName && EDIT_LOCKED_STATUSES.includes(statusName)) {
    return `지금 상태(${statusName})에서는 쿠팡이 수정을 받지 않습니다. 승인 결과가 나온 뒤 수정하세요.`
  }
  return null
}

/**
 * 배송·반품 수정 (승인불필요) — 바로 반영.
 * 성공하면 이 앱이 저장하는 배송비 칸(종류·금액·조건부 무료 금액)도 그 상품 행에 맞춘다.
 */
export async function applyShippingEdits(userId: string, sellerProductId: string, edits: ShippingEdits): Promise<void> {
  const problems = validateShippingEdits(edits)
  if (problems.length) throw new Error(problems.join('\n'))
  if (Object.keys(edits).length === 0) throw new Error('바꾼 값이 없습니다.')

  const res = await fetch('/api/coupang/seller-product-partial', {
    method: 'PUT',
    headers: { ...getCoupangHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ sellerProductId, ...edits }),
  })
  assertProxyOk(await res.json(), '배송·반품 수정 실패')

  const patch: Record<string, unknown> = {}
  if (edits.deliveryChargeType !== undefined) patch.delivery_charge_type = edits.deliveryChargeType
  if (edits.deliveryCharge !== undefined) patch.delivery_charge = edits.deliveryCharge
  if (edits.freeShipOverAmount !== undefined) patch.free_ship_over_amount = edits.freeShipOverAmount
  if (Object.keys(patch).length > 0) {
    patch.app_changed_at = new Date().toISOString()
    const { error } = await supabase.from(TABLE).update(patch).eq('user_id', userId).eq('item_id', sellerProductId)
    if (error) throw new Error(`쿠팡 적용됨 · DB 기록 실패: ${error.message}`)
  }
}

export interface SubmitProductEditsResult {
  /** 상세를 다시 받아 DB 를 맞췄는지 (실패해도 쿠팡 수정 요청은 이미 들어간 상태) */
  resynced: boolean
  /** 기다린 뒤 쿠팡 상태 (승인완료 = 자동 승인됨, 승인대기중 = 심사 중) */
  statusName: string | null
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 수정 요청 직후 임시저장 단계를 지날 때까지 잠깐 기다린다 → 그때 상태 (못 받으면 null) */
async function waitForSettledStatus(sellerProductId: string): Promise<string | null> {
  let status: string | null = null
  for (let i = 0; i < SETTLE_POLL_MAX_TRIES; i++) {
    await sleep(SETTLE_POLL_INTERVAL_MS)
    try {
      status = (await fetchLiveProductDetail(sellerProductId)).statusName ?? null
    } catch {
      status = null
    }
    if (status && !TRANSIENT_STATUSES.includes(status)) break
  }
  return status
}

/**
 * 재승인 수정 — 최신 상세를 다시 받아 바꾼 칸만 덮어쓴 전문을 PUT (승인요청 포함).
 * 화면을 연 뒤 쿠팡 쪽 값이 바뀌었어도, 사용자가 고친 칸 외에는 최신 값이 그대로 간다.
 */
export async function submitProductEdits(
  userId: string,
  sellerProductId: string,
  edits: ProductEdits,
): Promise<SubmitProductEditsResult> {
  const problems = validateProductEdits(edits)
  if (problems.length) throw new Error(problems.join('\n'))
  if (!hasProductEdits(edits)) throw new Error('바꾼 값이 없습니다.')

  // ── 1) 최신 전문 → 상태 확인 → 머지 ──
  const raw = await fetchLiveProductDetail(sellerProductId)
  const lock = editLockReason(raw.statusName ?? null)
  if (lock) throw new Error(lock)
  const body = mergeProductEdits(raw, edits)

  // ── 2) 수정 요청 (승인요청 자동) ──
  const res = await fetch('/api/coupang/seller-product', {
    method: 'PUT',
    headers: { ...getCoupangHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  assertProxyOk(await res.json(), '상품 수정 요청 실패')

  // ── 3) DB 맞추기 — 승인대기로 표시 → 임시저장 단계를 지날 때까지 기다린 뒤 상세를 다시 받아 실제 값으로 덮는다 ──
  await supabase
    .from(TABLE)
    .update({ coupang_approval: '승인대기중', app_changed_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('item_id', sellerProductId)
  const statusName = await waitForSettledStatus(sellerProductId)
  try {
    const r = await syncProductDetails(userId, [sellerProductId])
    return { resynced: r.failed.length === 0, statusName }
  } catch {
    return { resynced: false, statusName }
  }
}
