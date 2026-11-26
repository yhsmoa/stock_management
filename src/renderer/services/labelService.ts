/* ================================================================
   라벨 출력 — 상품관리 행 → 인쇄 항목 변환 · 로그인 계정
   - 인쇄 자체는 services/labelPrintService.ts (QZ Tray), 템플릿은 labelTemplateService.ts
   - data 의 키는 utils/label/labelTypes.ts 의 SOURCE_PRODUCT_FIELDS.stock
     (라벨 설정 편집기의 필드 드롭다운)과 반드시 같아야 한다 — 바꾸면 양쪽을 같이 고친다.
   - 성인/키즈 · 출력 조건(성인 = 혼용률, 키즈 = 혼용률 + 권장연령)은 labelInfoRules.ts.
     두 라벨 화면(상품관리 · 사입관리)이 같은 순서로 부른다:
       toLabelPrintItems → applyLabelInfo → splitPrintableLabelItems
   ================================================================ */

import type { AuthUser } from '../types/auth'
import { itemAudience, type LabelPrintItem } from './labelPrintService'
import { fetchItemInfosByBarcodes } from './itemInfoService'
import { isRealComposition } from './coupangNotices'
import { isKidsCategory, labelBlockReason } from './labelInfoRules'

// ══════════════════════════════════════════════════════════════════
// 타입 정의
// ══════════════════════════════════════════════════════════════════

/** 라벨에 쓰는 si_coupang_items 컬럼 — 상품관리의 CoupangItem 이 그대로 들어온다 */
export interface LabelSourceItem {
  barcode?: string | null
  item_name?: string | null
  option_name?: string | null
  product_name?: string | null
  item_code?: string | null
  option_id?: string | null
  item_id?: string | null
  product_id?: string | null
  price?: number | null
  regular_price?: number | null
  stock?: number | null
  season?: string | null
  note?: string | null
  package_type?: string | null
  /** 혼용률 — 쿠팡 고시정보 "제품 소재"/"소재" (상세 받기 때 저장). 직접 입력값(si_item_info)이 있으면 그쪽 우선 */
  composition?: string | null
  /** 쿠팡 고시정보 분류 ('어린이제품' 이면 키즈 양식) — notices 첫 항목의 category */
  notice_category?: string | null
}

/** 로그인 계정 — 템플릿 범위("내 것 + 공용")·인쇄 기록에 쓴다 */
export interface LabelAccount {
  id: string
  username: string | null
}

/** 출력 조건에 걸린 항목 */
export interface BlockedLabelItem {
  item: LabelPrintItem
  reason: string
}

// ── 상수 ──────────────────────────────────────────────────────────
/** 제외 안내에 이름을 보여 주는 최대 항목 수 (나머지는 건수만) */
const BLOCKED_SUMMARY_LINES = 5

// ══════════════════════════════════════════════════════════════════
// 로그인 계정
// ══════════════════════════════════════════════════════════════════

/** localStorage['user'] 의 si_users 행에서 id·아이디만 꺼낸다 (없으면 null) */
export function getCurrentLabelAccount(): LabelAccount | null {
  try {
    const raw = localStorage.getItem('user')
    if (!raw) return null
    const u = JSON.parse(raw) as AuthUser
    return u.id ? { id: u.id, username: u.username ?? null } : null
  } catch {
    return null
  }
}

// ══════════════════════════════════════════════════════════════════
// 데이터 변환
// ══════════════════════════════════════════════════════════════════

/**
 * si_coupang_items 행 → 인쇄 항목 (1장씩).
 * 바코드 없는 행은 라벨을 찍을 수 없으므로 제외한다 (호출 측이 건수를 안내).
 * 혼용률은 쿠팡 값, 권장연령은 빈 값으로 싣는다 → applyLabelInfo 가 직접 입력값으로 채운다.
 */
export function toLabelPrintItems(items: LabelSourceItem[]): { items: LabelPrintItem[]; skipped: number } {
  const out: LabelPrintItem[] = []
  let skipped = 0
  for (const it of items) {
    const barcode = (it.barcode ?? '').trim()
    if (!barcode) {
      skipped++
      continue
    }
    out.push({
      qty: 1,
      // 어린이제품이면 키즈로 고정. 그 밖에는 정하지 않는다 → 권장연령이 들어오면 키즈, 없으면 성인 (itemAudience)
      ...(isKidsCategory(it.notice_category) ? { audience: 'kids' as const } : {}),
      data: {
        barcode,
        item_name: it.item_name ?? '',
        option_name: it.option_name ?? '',
        product_name: it.product_name ?? '',
        item_code: it.item_code ?? '',
        option_id: it.option_id ?? '',
        item_id: it.item_id ?? '',
        product_id: it.product_id ?? '',
        price: it.price ?? null,
        regular_price: it.regular_price ?? null,
        stock: it.stock ?? null,
        season: it.season ?? '',
        note: it.note ?? '',
        package_type: it.package_type ?? '',
        composition: it.composition ?? '',
        recommanded_age: '',
      },
    })
  }
  return { items: out, skipped }
}

// ══════════════════════════════════════════════════════════════════
// 직접 입력값 싣기 — 아이템관리 › 상품정보(si_item_info, 바코드 기준)
//   · 혼용률: ① 직접 입력값 ② 쿠팡 고시정보 "제품 소재"/"소재" (si_coupang_items.composition)
//             쿠팡 값이 "상세페이지 참조" 같은 안내 문구라 비어 있거나, 틀린 상품을 고칠 때 ①을 쓴다.
//   · 권장연령: 직접 입력값뿐이다 (키즈 상품은 상세를 받을 때 사이즈로 자동 입력 — recommendedAgeService).
//     DB 칼럼은 recommended_age, 라벨 data 키는 recommanded_age (label-service 와 같은 철자).
//   조회에 실패하면 throw — 값을 모르는 채로 찍으면 키즈 라벨이 성인 양식으로 나갈 수 있다.
// ══════════════════════════════════════════════════════════════════

/** 인쇄 항목의 data.composition · data.recommanded_age 를 직접 입력값으로 채운다 (items 를 직접 고친다) */
export async function applyLabelInfo(items: LabelPrintItem[], userId: string): Promise<void> {
  const barcodes = items.map((it) => String(it.data.barcode ?? ''))
  const manual = await fetchItemInfosByBarcodes(userId, barcodes)
  if (manual.size === 0) return
  for (const it of items) {
    const row = manual.get(String(it.data.barcode ?? '').trim())
    if (!row) continue
    if (isRealComposition(row.composition)) it.data.composition = row.composition!.trim()
    const age = (row.recommended_age ?? '').trim()
    if (age) it.data.recommanded_age = age
  }
}

// ══════════════════════════════════════════════════════════════════
// 출력 조건 — 성인 = 혼용률 / 키즈 = 혼용률 + 권장연령 (labelInfoRules)
// ══════════════════════════════════════════════════════════════════

/** 이 항목을 찍을 수 없는 사유 (찍을 수 있으면 null) — applyLabelInfo 뒤에 부른다 */
export function labelItemBlockReason(it: LabelPrintItem): string | null {
  return labelBlockReason(itemAudience(it), String(it.data.composition ?? ''), String(it.data.recommanded_age ?? ''))
}

/** 찍을 수 있는 항목과 조건에 걸린 항목으로 나눈다 */
export function splitPrintableLabelItems(items: LabelPrintItem[]): { printable: LabelPrintItem[]; blocked: BlockedLabelItem[] } {
  const printable: LabelPrintItem[] = []
  const blocked: BlockedLabelItem[] = []
  for (const item of items) {
    const reason = labelItemBlockReason(item)
    if (reason) blocked.push({ item, reason })
    else printable.push(item)
  }
  return { printable, blocked }
}

/** 조건에 걸린 항목 안내 문구 (앞의 몇 개만 이름을 보여 준다) */
export function blockedLabelSummary(blocked: BlockedLabelItem[]): string {
  const lines = blocked.slice(0, BLOCKED_SUMMARY_LINES).map(({ item, reason }) => {
    const name = [item.data.item_name, item.data.option_name].filter(Boolean).join(', ') || String(item.data.barcode ?? '')
    return `· ${name} — ${reason}`
  })
  if (blocked.length > BLOCKED_SUMMARY_LINES) lines.push(`· … 외 ${blocked.length - BLOCKED_SUMMARY_LINES}개`)
  return `라벨 정보가 빠진 ${blocked.length}개 항목은 출력하지 않습니다.\n${lines.join('\n')}\n\n일반판매자 상품 화면에서 상품명을 눌러 [라벨] 탭에서 입력할 수 있습니다.`
}
