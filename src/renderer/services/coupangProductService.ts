/* ================================================================
   상품관리 (CoupangManagement) 서비스
   - si_coupang_items 조회 · 직접 입력값(분류·비고) 저장
   - 쿠팡 상품 API 동기화: 목록(일반 + 로켓그로스) → 상세(옵션·가격·재고·이미지) → 판매상태
   - 가격 · 재고 · 할인율 기준가 · 판매상태 변경 (쿠팡 성공 후에만 DB 반영)
   - WING 가격/재고 엑셀 업로드(보조) · 분류 엑셀 · 내보내기
   - 모든 조회는 1000행 페이지 루프, 쿠팡 호출은 초당 5회 큐(rateLimitQueue)
   ================================================================ */

import * as XLSX from 'xlsx'
import { supabase } from './supabase'
import {
  fetchAllRgProducts,
  fetchRgProductDetail,
  fetchVendorItemInventory,
  updateVendorItemPrice,
  setVendorItemSale,
  getCoupangHeaders,
  getRepresentativeImageUrl,
} from './purchaseService'
import { runRateLimited, COUPANG_RATE_LIMIT, isAbortError } from '../utils/rateLimitQueue'
import type {
  CoupangProductRow,
  CoupangProductFilters,
  CoupangProductSummary,
  CoupangSyncSummary,
  CoupangChannel,
  SalesFilter,
  SalesCounts,
  ApiListProduct,
  ApiProductDetail,
  ApiDetailItem,
  ApiDetailItemData,
  ApiProductHistory,
} from '../types/coupangProduct'
import { PACKAGE_TYPE_OPTIONS } from '../types/coupangProduct'
import type { CoupangNotice } from '../types/coupangProduct'
import { toCoupangNotices, extractComposition } from './coupangNotices'

// ── 상수 ──────────────────────────────────────────────────────────
const TABLE = 'si_coupang_items'
const PAGE_ROWS = 1000             // Supabase 한 요청 최대 행
const PARALLEL_PAGES = 6           // 전체 조회 때 동시에 받는 페이지 수
const UPSERT_BATCH = 500           // upsert 배치 크기
const IN_CHUNK = 100               // .in() 한 번에 보낼 ID 수 (URL 길이 보호)
const LIST_PAGE_SIZE = 100         // 쿠팡 목록 maxPerPage 최대
const LIST_MAX_PAGES = 5000        // 목록 nextToken 무한 루프 방지

/**
 * 목록 · 내보내기에서 읽는 칼럼 — 고시정보(notices, 옵션당 ~1KB JSON)는 뺀다.
 * 7.8만 행 계정에서 '*' 로 읽으면 고시정보만 수십 MB 라, 고시정보는 상세 패널을 열 때 상품 1개만 받는다
 * (fetchProductNotices). CoupangProductRow 의 칼럼이 늘면 여기도 같이 늘린다.
 */
const ROW_COLUMNS = [
  'option_id', 'user_id', 'item_id', 'product_id', 'item_status', 'barcode', 'item_code',
  'product_name', 'item_name', 'option_name', 'price', 'regular_price', 'sales_status', 'stock',
  'sales_data', 'coupang_approval', 'package_type', 'note', 'season', 'channel', 'img_url',
  'delivery_charge_type', 'delivery_charge', 'free_ship_over_amount',
  'detail_synced_at', 'status_checked_at', 'app_changed_at', 'excel_synced_at', 'composition',
].join(', ')

// ══════════════════════════════════════════════════════════════════
// 공통 헬퍼
// ══════════════════════════════════════════════════════════════════

/** localStorage 의 로그인 사용자 id (없으면 '') */
export function getCurrentUserId(): string {
  try {
    const raw = localStorage.getItem('user')
    return raw ? ((JSON.parse(raw) as { id?: string }).id ?? '') : ''
  } catch {
    return ''
  }
}

/** 쿠팡 ID 값 → 저장용 문자열. 없거나 'null' 글자면 null (purchaseService.idString 과 같은 규칙) */
function idString(v: number | string | null | undefined): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s && s !== 'null' && s !== 'undefined' ? s : null
}

/** 빈 문자열은 null 로 */
function textOrNull(v: string | null | undefined): string | null {
  const s = (v ?? '').trim()
  return s ? s : null
}

/** 숫자 아니면 null */
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** 프록시 응답 { success, data: { code, message, data } } 검증 → 쿠팡 응답 본문 (상품 수정 서비스도 쓴다) */
export function assertProxyOk(json: any, fallback: string): any {
  if (!json?.success) throw new Error(json?.error || fallback)
  if (json.data?.code && json.data.code !== 'SUCCESS') throw new Error(json.data?.message || fallback)
  return json.data
}

/** 쿠팡 offerCondition → 엑셀 D열 "상품상태" 값 (새상품이 기본) */
function offerConditionLabel(v: string | null | undefined): string | null {
  if (!v) return null
  if (v === 'NEW') return '새상품'
  if (v === 'REFURBISHED') return '리퍼'
  if (v.startsWith('USED')) return '중고'
  return v
}

/** 배열을 n 개씩 */
function chunk<T>(arr: readonly T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// ══════════════════════════════════════════════════════════════════
// 조회 — 화면 페이지 · 상품 요약 · 건수
// ══════════════════════════════════════════════════════════════════

/** supabase 빌더의 필터 메서드만 (메서드가 this 를 돌려주므로 부수효과로 쓴다) */
interface FilterableQuery {
  eq: (column: string, value: unknown) => unknown
  is: (column: string, value: null) => unknown
  not: (column: string, operator: string, value: unknown) => unknown
  or: (filters: string) => unknown
  ilike: (column: string, pattern: string) => unknown
}

/** PostgREST or() 안에 넣을 값 — 콤마·괄호·따옴표가 있어도 깨지지 않게 큰따옴표로 감싼다 */
function quoteFilterValue(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** 화면 필터 → 쿼리 조건 (user_id 포함) */
function applyFilters(q: FilterableQuery, userId: string, f: CoupangProductFilters, salesOverride?: SalesFilter): void {
  q.eq('user_id', userId)

  // ── 출처: channel 우선, 없으면 바코드 유무 ──
  if (f.channel === 'MP') q.or('channel.eq.MP,and(channel.is.null,or(barcode.is.null,barcode.eq.))')
  else if (f.channel === 'RG') q.or('channel.eq.RG,and(channel.is.null,barcode.not.is.null,barcode.neq.)')

  // ── 판매상태 ──
  switch (salesOverride ?? f.sales) {
    case 'on': q.eq('sales_status', '판매중'); break
    case 'off': q.eq('sales_status', '판매중지'); break
    case 'zeroStock': q.eq('stock', 0); break
    // 판매상태를 한 번도 받은 적 없는 행 (목록 동기화로 새로 들어온 옵션). 예전 엑셀 행은 시각 칼럼이 없어도 상태값은 있다
    case 'unchecked': q.is('sales_status', null); break
    default: break
  }

  // ── 승인상태 ──
  if (f.approval === 'pending') q.or('coupang_approval.neq.승인완료,coupang_approval.is.null')

  // ── 검색 ──
  const s = f.search.trim()
  if (s) {
    switch (f.searchField) {
      case 'name': {
        const v = quoteFilterValue(`%${s}%`)
        q.or(`item_name.ilike.${v},product_name.ilike.${v}`)
        break
      }
      case 'optionId': q.eq('option_id', s); break
      case 'barcode': q.eq('barcode', s); break
      case 'itemCode': q.ilike('item_code', `%${s}%`); break
      case 'itemId': q.eq('item_id', s); break
    }
  }
}

/** 상품 단위 한 페이지 결과 */
export interface ProductPageResult {
  /** 이 페이지 상품들의 (필터에 맞는) 옵션 행 전부 */
  rows: CoupangProductRow[]
  /** 이 페이지 상품의 등록상품 ID (화면 순서) */
  itemIds: string[]
  /** 다음 페이지 커서 = 이 페이지 마지막 등록상품 ID. 다음 페이지가 없으면 null */
  nextCursor: string | null
}

/**
 * 한 페이지 — **상품 단위** (등록상품 ID 내림차순, 커서 방식)
 * - 예전에는 옵션 100행씩 잘라 한 상품의 옵션이 두 페이지에 걸쳤다. 상품을 접어서 보여 주려면
 *   페이지가 상품 단위여야 해서 바꿨다 (2026-10-20).
 * - DB 함수 없이 상품 단위로 자르려고 커서를 쓴다: ① 등록상품 ID 만 훑어 이 페이지 상품 N 개를 고르고
 *   ② 그 상품들의 옵션 행을 받는다. 다음 페이지는 "마지막 등록상품 ID 보다 작은 것"부터.
 *   → 페이지 번호로 바로 건너뛰기는 안 된다 (이전 · 다음만).
 * - item_id 는 text 라 정렬·비교가 문자열 기준이다 — 정렬과 커서 비교가 같은 기준이라 빠짐·중복은 없다.
 * - item_id 가 없는 행은 상품으로 묶을 수 없어 이 목록에 나오지 않는다 (2026-10-20 실측 0건).
 * @param cursor 이전 페이지의 nextCursor (첫 페이지는 null)
 */
export async function fetchProductPage(
  userId: string,
  filters: CoupangProductFilters,
  cursor: string | null,
  productsPerPage: number,
): Promise<ProductPageResult> {
  // ── ① 이 페이지 상품 고르기 — 등록상품 ID 만, 1000행씩 (한 상품의 옵션이 여러 행이라 중복 제거) ──
  const itemIds: string[] = []
  const seen = new Set<string>()
  let hasMore = false
  scan: for (let from = 0; ; from += PAGE_ROWS) {
    const query = supabase.from(TABLE).select('item_id')
    applyFilters(query as unknown as FilterableQuery, userId, filters)
    query.not('item_id', 'is', null)
    if (cursor) query.lt('item_id', cursor)
    const { data, error } = await query
      .order('item_id', { ascending: false })
      .order('option_id', { ascending: true })
      .range(from, from + PAGE_ROWS - 1)
    if (error) {
      console.error('[fetchProductPage] 상품 ID 조회 오류:', error)
      throw error
    }
    for (const r of (data ?? []) as { item_id: string | null }[]) {
      if (!r.item_id || seen.has(r.item_id)) continue
      if (itemIds.length === productsPerPage) { hasMore = true; break scan }   // 한 상품 더 있음 = 다음 페이지 있음
      seen.add(r.item_id)
      itemIds.push(r.item_id)
    }
    if (!data || data.length < PAGE_ROWS) break
  }
  if (itemIds.length === 0) return { rows: [], itemIds, nextCursor: null }

  // ── ② 고른 상품들의 옵션 행 (필터에 맞는 것만, 1000행 루프) ──
  const rows: CoupangProductRow[] = []
  for (const ids of chunk(itemIds, IN_CHUNK)) {
    for (let from = 0; ; from += PAGE_ROWS) {
      const query = supabase.from(TABLE).select(ROW_COLUMNS)
      applyFilters(query as unknown as FilterableQuery, userId, filters)
      const { data, error } = await query
        .in('item_id', ids)
        .order('item_id', { ascending: false })
        .order('option_id', { ascending: true })
        .range(from, from + PAGE_ROWS - 1)
      if (error) {
        console.error('[fetchProductPage] 옵션 행 조회 오류:', error)
        throw error
      }
      // ROW_COLUMNS 가 런타임 문자열이라 supabase 가 행 타입을 추론하지 못한다 → 칼럼 목록과 같은 모양으로 단언
      rows.push(...((data ?? []) as unknown as CoupangProductRow[]))
      if (!data || data.length < PAGE_ROWS) break
    }
  }

  return { rows, itemIds, nextCursor: hasMore ? itemIds[itemIds.length - 1] : null }
}

/**
 * 판매상태 칩별 건수 (현재 출처·승인·검색 조건 안에서)
 * - 7.8만 행 계정에서 count 를 동시에 여러 개 보내면 DB statement timeout 이 난다 (2026-10-20 실측) → 순서대로
 */
export async function fetchSalesCounts(userId: string, filters: CoupangProductFilters): Promise<SalesCounts> {
  const kinds: SalesFilter[] = ['all', 'on', 'off', 'zeroStock', 'unchecked']
  const counts: number[] = []
  for (const kind of kinds) {
    const query = supabase.from(TABLE).select('option_id', { count: 'exact', head: true })
    applyFilters(query as unknown as FilterableQuery, userId, filters, kind)
    const { count, error } = await query
    if (error) {
      console.error('[fetchSalesCounts] 오류:', error)
      counts.push(0)
      continue
    }
    counts.push(count ?? 0)
  }
  return { all: counts[0], on: counts[1], off: counts[2], zeroStock: counts[3], unchecked: counts[4] }
}

/**
 * 페이지에 보이는 상품들의 전체 옵션 요약 (페이지에 안 보이는 옵션 포함)
 * - 전체/일반/로켓 구분, 옵션 수, 판매중 수, 이미지, 노출상품 ID
 * - 상품 100개 × 옵션 수십 개라도 1000행을 넘을 수 있어 페이지 루프
 */
export async function fetchProductSummaries(
  userId: string,
  itemIds: string[],
): Promise<Map<string, CoupangProductSummary>> {
  const map = new Map<string, CoupangProductSummary>()
  if (itemIds.length === 0) return map

  type Row = Pick<CoupangProductRow, 'item_id' | 'channel' | 'barcode' | 'sales_status' | 'img_url' | 'product_id' | 'detail_synced_at'>
  const rows: Row[] = []
  for (const ids of chunk(itemIds, IN_CHUNK)) {
    for (let from = 0; ; from += PAGE_ROWS) {
      const { data, error } = await supabase
        .from(TABLE)
        .select('item_id, channel, barcode, sales_status, img_url, product_id, detail_synced_at')
        .eq('user_id', userId)
        .in('item_id', ids)
        .order('option_id')
        .range(from, from + PAGE_ROWS - 1)
      if (error) {
        console.error('[fetchProductSummaries] 오류:', error)
        throw error
      }
      rows.push(...((data ?? []) as Row[]))
      if (!data || data.length < PAGE_ROWS) break
    }
  }

  for (const r of rows) {
    if (!r.item_id) continue
    const s = map.get(r.item_id) ?? {
      totalOptions: 0, mpOptions: 0, rgOptions: 0, onSale: 0, imgUrl: null, productId: null, detailSynced: false,
    }
    s.totalOptions++
    const ch: CoupangChannel = r.channel ?? (r.barcode ? 'RG' : 'MP')
    if (ch === 'RG') s.rgOptions++
    else s.mpOptions++
    if (r.sales_status === '판매중') s.onSale++
    if (!s.imgUrl && r.img_url) s.imgUrl = r.img_url
    if (!s.productId && r.product_id) s.productId = r.product_id
    if (r.detail_synced_at) s.detailSynced = true
    map.set(r.item_id, s)
  }
  return map
}

/** 머리 카드용 동기화 요약 */
export async function fetchSyncSummary(userId: string): Promise<CoupangSyncSummary> {
  const countWhere = async (build: (q: FilterableQuery) => void): Promise<number> => {
    const query = supabase.from(TABLE).select('option_id', { count: 'exact', head: true }).eq('user_id', userId)
    build(query as unknown as FilterableQuery)
    const { count, error } = await query
    if (error) {
      console.error('[fetchSyncSummary] count 오류:', error)
      return 0
    }
    return count ?? 0
  }
  const latest = async (column: string): Promise<string | null> => {
    const { data, error } = await supabase
      .from(TABLE)
      .select(column)
      .eq('user_id', userId)
      .not(column, 'is', null)
      .order(column, { ascending: false })
      .limit(1)
    if (error) {
      console.error('[fetchSyncSummary] latest 오류:', error)
      return null
    }
    const row = (data?.[0] ?? null) as unknown as Record<string, string | null> | null
    return row?.[column] ?? null
  }

  // 동시에 보내면 큰 계정에서 statement timeout — 순서대로
  const totalRows = await countWhere(() => undefined)
  const detailMissing = await countWhere((q) => q.is('detail_synced_at', null))
  const noticesReceived = await countWhere((q) => q.not('notices', 'is', null))
  const statusUnchecked = await countWhere((q) => q.is('sales_status', null))
  const lastDetailAt = await latest('detail_synced_at')
  const lastCheckedAt = await latest('status_checked_at')
  const lastExcelAt = await latest('excel_synced_at')

  const lastStatusAt = [lastCheckedAt, lastExcelAt].filter((v): v is string => !!v).sort().pop() ?? null
  return { totalRows, detailMissing, noticesReceived, statusUnchecked, lastDetailAt, lastStatusAt, lastExcelAt }
}

// ── 전체 행 조회 (동기화 비교 · 내보내기) ───────────────────────────

/**
 * 계정의 전체 행을 필요한 칼럼만 받는다 — 건수를 먼저 세고 페이지를 병렬로 받는다
 * (immong 7.8만 행: 78페이지 · 6개씩 병렬)
 */
async function fetchAllRows<T>(
  userId: string,
  select: string,
  onProgress?: (done: number, total: number) => void,
  /** 추가 조건 (건수 · 페이지 조회에 똑같이 건다) */
  where?: (q: FilterableQuery) => void,
): Promise<T[]> {
  const countQuery = supabase
    .from(TABLE)
    .select('option_id', { count: 'exact', head: true })
    .eq('user_id', userId)
  where?.(countQuery as never)
  const { count, error: countError } = await countQuery
  if (countError) throw countError
  const total = count ?? 0
  const pages = Math.ceil(total / PAGE_ROWS)
  const out: T[][] = new Array(pages)
  let done = 0

  const fetchPage = async (p: number) => {
    const from = p * PAGE_ROWS
    const pageQuery = supabase
      .from(TABLE)
      .select(select)
      .eq('user_id', userId)
    where?.(pageQuery as never)
    const { data, error } = await pageQuery
      .order('option_id')
      .range(from, from + PAGE_ROWS - 1)
    if (error) throw error
    out[p] = (data ?? []) as T[]
    done++
    onProgress?.(Math.min(done * PAGE_ROWS, total), total)
  }

  for (const group of chunk([...Array(pages).keys()], PARALLEL_PAGES)) {
    await Promise.all(group.map(fetchPage))
  }
  return out.flat()
}

// ══════════════════════════════════════════════════════════════════
// 직접 입력값 — 분류 · 비고 · 삭제
// ══════════════════════════════════════════════════════════════════

export async function updatePackageType(userId: string, optionId: string, packageType: string): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ package_type: packageType }).eq('option_id', optionId).eq('user_id', userId)
  if (error) throw error
}

export async function updateNote(userId: string, optionId: string, note: string): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ note: note || null }).eq('option_id', optionId).eq('user_id', userId)
  if (error) throw error
}

/** 선택 옵션들의 분류를 바꾼다. 비고는 값이 있을 때만 같이 바꾼다 (비우면 기존 유지) */
export async function bulkClassify(userId: string, optionIds: string[], packageType: string, note: string): Promise<void> {
  const payload: { package_type: string; note?: string } = { package_type: packageType }
  if (note.trim()) payload.note = note.trim()
  for (const ids of chunk(optionIds, IN_CHUNK)) {
    const { error } = await supabase.from(TABLE).update(payload).eq('user_id', userId).in('option_id', ids)
    if (error) throw error
  }
}

export async function deleteProductRow(userId: string, optionId: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('option_id', optionId).eq('user_id', userId)
  if (error) throw error
}

// ══════════════════════════════════════════════════════════════════
// 쿠팡 API 호출 (프록시 경유)
// ══════════════════════════════════════════════════════════════════

// ── 일반 목록 (businessTypes 없음) — 전체 페이지 ──
//   실측(2026-10-20): registrationType 'NORMAL' 상품만 오고 items 가 없다. 하이브리드는 로켓그로스 목록에서 온다.
async function fetchAllMpProducts(onProgress?: (count: number) => void): Promise<ApiListProduct[]> {
  const all: ApiListProduct[] = []
  let nextToken: string | null = null
  const seenTokens = new Set<string>()

  for (let page = 0; page < LIST_MAX_PAGES; page++) {
    const params = new URLSearchParams({ maxPerPage: String(LIST_PAGE_SIZE) })
    if (nextToken) params.set('nextToken', nextToken)
    const res = await fetch(`/api/coupang/mp-products?${params}`, { headers: getCoupangHeaders() })
    const body = assertProxyOk(await res.json(), '일반 상품 목록 조회 실패')
    const data = Array.isArray(body?.data) ? (body.data as ApiListProduct[]) : []
    all.push(...data)
    onProgress?.(all.length)

    const token = typeof body?.nextToken === 'string' ? body.nextToken.trim() : ''
    if (!token || data.length === 0 || seenTokens.has(token)) break
    seenTokens.add(token)
    nextToken = token
  }
  return all
}

// ── 상세 (기존 rg-product 경로 — 같은 seller-products 엔드포인트) ──
async function fetchProductDetailApi(sellerProductId: string): Promise<ApiProductDetail> {
  const detail = await fetchRgProductDetail(Number(sellerProductId))
  return detail as unknown as ApiProductDetail
}

// ── 상태 변경 이력 ──
export async function fetchProductHistories(sellerProductId: string): Promise<ApiProductHistory[]> {
  const params = new URLSearchParams({ sellerProductId, maxPerPage: '50' })
  const res = await fetch(`/api/coupang/product-histories?${params}`, { headers: getCoupangHeaders() })
  const body = assertProxyOk(await res.json(), '상태 변경 이력 조회 실패')
  return Array.isArray(body?.data) ? (body.data as ApiProductHistory[]) : []
}

// ── 재고 · 할인율 기준가 변경 ──
async function putVendorItemQuantity(vendorItemId: string, quantity: number): Promise<void> {
  const res = await fetch('/api/coupang/vendor-item-quantity', {
    method: 'PUT',
    headers: { ...getCoupangHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendorItemId, quantity }),
  })
  assertProxyOk(await res.json(), '재고 변경 실패')
}

async function putVendorItemOriginalPrice(vendorItemId: string, originalPrice: number): Promise<void> {
  const res = await fetch('/api/coupang/vendor-item-original-price', {
    method: 'PUT',
    headers: { ...getCoupangHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendorItemId, originalPrice }),
  })
  assertProxyOk(await res.json(), '할인율 기준가 변경 실패')
}

// ══════════════════════════════════════════════════════════════════
// 동기화 1 — 목록 (일반 목록 + 로켓그로스 목록)
//   - 로켓그로스 목록의 하이브리드 상품은 옵션 ID 가 같이 와서 옵션 행을 바로 만든다
//   - 일반 목록(NORMAL)은 옵션이 없다: 이미 행이 있으면 상품 칼럼만 고치고, 없으면 상세 대상으로 돌려준다
//   - 저장은 option_id 기준 upsert(빠진 칼럼 유지) — 바뀐 행만 보낸다
// ══════════════════════════════════════════════════════════════════

/** 목록 동기화로 고치는 칼럼 (한 배치의 행은 이 키를 전부 가진다) */
interface ListSyncRow {
  option_id: string
  user_id: string
  item_id: string
  product_id: string | null
  item_name: string | null
  option_name: string | null
  coupang_approval: string | null
  channel: CoupangChannel
}

type ExistingRow = Pick<CoupangProductRow, 'option_id' | 'item_id' | 'product_id' | 'item_name' | 'option_name' | 'coupang_approval' | 'channel' | 'barcode'>

export interface ListSyncResult {
  mpProducts: number        // 일반 목록 상품 수
  rgProducts: number        // 로켓그로스 목록 상품 수 (하이브리드 포함)
  hybridProducts: number
  upserted: number          // 새로 넣거나 고친 옵션 행
  unchanged: number
  needDetail: string[]      // 행이 하나도 없는 일반 상품 (상세를 받아야 옵션이 생긴다)
  newRgProducts: string[]   // 이번에 처음 들어온 로켓그로스/하이브리드 상품
  notInCoupang: number      // DB 에는 있지만 두 목록 어디에도 없는 상품 수 (지우지 않는다)
  errors: string[]
}

export async function syncProductList(
  userId: string,
  onProgress?: (message: string) => void,
): Promise<ListSyncResult> {
  // ── STEP 1: 쿠팡 두 목록 ──
  onProgress?.('일반 상품 목록 받는 중…')
  const mpList = await fetchAllMpProducts((n) => onProgress?.(`일반 상품 목록 ${n.toLocaleString()}개…`))
  onProgress?.('로켓그로스 상품 목록 받는 중…')
  const rgList = (await fetchAllRgProducts((n) => onProgress?.(`로켓그로스 상품 목록 ${n.toLocaleString()}개…`))) as unknown as ApiListProduct[]

  // ── STEP 2: 기존 행 ──
  onProgress?.('기존 데이터 읽는 중…')
  const existing = await fetchAllRows<ExistingRow>(
    userId,
    'option_id, item_id, product_id, item_name, option_name, coupang_approval, channel, barcode',
    (d, t) => onProgress?.(`기존 데이터 읽는 중… ${d.toLocaleString()} / ${t.toLocaleString()}`),
  )
  const existingByOption = new Map<string, ExistingRow>()
  const existingByItem = new Map<string, ExistingRow[]>()
  for (const r of existing) {
    existingByOption.set(r.option_id, r)
    if (r.item_id) {
      const g = existingByItem.get(r.item_id)
      if (g) g.push(r)
      else existingByItem.set(r.item_id, [r])
    }
  }

  // ── STEP 3: 목록 → 옵션 행 ──
  const rowsByOption = new Map<string, ListSyncRow>()
  const listedItems = new Set<string>()
  const needDetail: string[] = []
  const newRgProducts: string[] = []
  let hybridProducts = 0

  // 상품 하나의 product_id: 목록 값 → 없으면 기존 행 값 유지
  const productIdFor = (p: ApiListProduct, itemId: string): string | null =>
    idString(p.productId) ?? existingByItem.get(itemId)?.find((r) => r.product_id)?.product_id ?? null

  // 3-a. 로켓그로스 목록 (옵션 ID 있음)
  for (const p of rgList) {
    const itemId = idString(p.sellerProductId)
    if (!itemId) continue
    listedItems.add(itemId)
    const productId = productIdFor(p, itemId)
    let hasMp = false
    let hasRg = false
    for (const item of p.items ?? []) {
      const mp = item.marketPlaceItemData ?? item.marketplaceItemData
      const rg = item.rocketGrowthItemData
      const base = {
        user_id: userId,
        item_id: itemId,
        product_id: productId,
        item_name: textOrNull(p.sellerProductName),
        option_name: textOrNull(item.itemName),
        coupang_approval: textOrNull(p.statusName),
      }
      const mpId = idString(mp?.vendorItemId)
      const rgId = idString(rg?.vendorItemId)
      if (mpId) { rowsByOption.set(mpId, { option_id: mpId, channel: 'MP', ...base }); hasMp = true }
      if (rgId) { rowsByOption.set(rgId, { option_id: rgId, channel: 'RG', ...base }); hasRg = true }
    }
    if (hasMp && hasRg) hybridProducts++
    if (!existingByItem.has(itemId) && (hasMp || hasRg)) newRgProducts.push(itemId)
  }

  // 3-b. 일반 목록 (옵션 없음) — 기존 행의 상품 칼럼만, 행이 없으면 상세 대상
  for (const p of mpList) {
    const itemId = idString(p.sellerProductId)
    if (!itemId) continue
    listedItems.add(itemId)
    const olds = existingByItem.get(itemId)
    if (!olds || olds.length === 0) { needDetail.push(itemId); continue }
    const productId = productIdFor(p, itemId)
    for (const old of olds) {
      if (rowsByOption.has(old.option_id)) continue   // 로켓그로스 목록에서 이미 만든 행
      rowsByOption.set(old.option_id, {
        option_id: old.option_id,
        user_id: userId,
        item_id: itemId,
        product_id: productId,
        item_name: textOrNull(p.sellerProductName) ?? old.item_name,
        option_name: old.option_name,              // 일반 목록엔 옵션명이 없다 — 그대로
        coupang_approval: textOrNull(p.statusName) ?? old.coupang_approval,
        // 일반 상품의 옵션은 전부 판매자배송 — 예전 행(채널 없음)에 채운다
        channel: old.channel ?? 'MP',
      })
    }
  }

  // ── STEP 4: 바뀐 행만 upsert ──
  const toUpsert: ListSyncRow[] = []
  let unchanged = 0
  for (const row of rowsByOption.values()) {
    const old = existingByOption.get(row.option_id)
    if (
      old &&
      old.item_id === row.item_id &&
      (old.product_id ?? null) === row.product_id &&
      (old.item_name ?? null) === row.item_name &&
      (old.option_name ?? null) === row.option_name &&
      (old.coupang_approval ?? null) === row.coupang_approval &&
      old.channel === row.channel
    ) { unchanged++; continue }
    toUpsert.push(row)
  }

  const errors: string[] = []
  let upserted = 0
  const batches = chunk(toUpsert, UPSERT_BATCH)
  for (let i = 0; i < batches.length; i++) {
    onProgress?.(`저장 중… ${Math.min((i + 1) * UPSERT_BATCH, toUpsert.length).toLocaleString()} / ${toUpsert.length.toLocaleString()}`)
    const { error } = await supabase.from(TABLE).upsert(batches[i], { onConflict: 'option_id', defaultToNull: false })
    if (error) {
      console.error('[syncProductList] upsert 오류:', error)
      errors.push(`저장 배치 ${i + 1}: ${error.message}`)
    } else {
      upserted += batches[i].length
    }
  }

  // ── STEP 5: 쿠팡에 없는 상품 (보고만) ──
  let notInCoupang = 0
  for (const itemId of existingByItem.keys()) if (!listedItems.has(itemId)) notInCoupang++

  console.log(`[syncProductList] 일반 ${mpList.length} · RG ${rgList.length} · 하이브리드 ${hybridProducts} · 저장 ${upserted} · 그대로 ${unchanged} · 상세 필요 ${needDetail.length} · 쿠팡에 없음 ${notInCoupang}`)
  return {
    mpProducts: mpList.length,
    rgProducts: rgList.length,
    hybridProducts,
    upserted,
    unchanged,
    needDetail,
    newRgProducts,
    notInCoupang,
    errors,
  }
}

// ══════════════════════════════════════════════════════════════════
// 동기화 2 — 상세 (상품 1건 = 호출 1번, 옵션 전부)
//   - 순수 일반상품: items[] 에 값이 평평하게 (vendorItemId · salePrice · maximumBuyCount …)
//   - 하이브리드: items[].marketplaceItemData / rocketGrowthItemData 안에 채널별로
//   - 바코드는 API 값이 비어 있지 않을 때만 쓴다 (엑셀로 넣은 값을 ""로 지우지 않는다)
// ══════════════════════════════════════════════════════════════════

/** 상세로 채우는 칼럼 (바코드 · product_id 는 조건부라 따로) */
interface DetailRow {
  option_id: string
  user_id: string
  item_id: string
  item_status: string | null
  item_code: string | null
  product_name: string | null
  item_name: string | null
  option_name: string | null
  price: number | null
  regular_price: number | null
  stock: number | null
  coupang_approval: string | null
  channel: CoupangChannel
  img_url: string | null
  delivery_charge_type: string | null
  delivery_charge: number | null
  free_ship_over_amount: number | null
  detail_synced_at: string
  /** 고시정보 — 받았으면 항상 배열([] 포함) 이라 "미수신(null)" 과 구분된다 */
  notices: CoupangNotice[]
  composition: string | null
}

interface ParsedDetail {
  itemId: string
  productId: string | null
  rows: { row: DetailRow; barcode: string | null }[]
}

/** 채널 데이터(하이브리드) 또는 평평한 item 에서 옵션 값 뽑기 */
function optionValues(item: ApiDetailItem, data: ApiDetailItemData | null | undefined) {
  if (data) {
    return {
      vendorItemId: idString(data.vendorItemId),
      price: numOrNull(data.priceData?.salePrice),
      regularPrice: numOrNull(data.priceData?.originalPrice),
      stock: numOrNull(data.maximumBuyCount),
      barcode: textOrNull(data.barcode),
      itemCode: textOrNull(data.externalVendorSku),
    }
  }
  return {
    vendorItemId: idString(item.vendorItemId),
    price: numOrNull(item.salePrice),
    regularPrice: numOrNull(item.originalPrice),
    stock: numOrNull(item.maximumBuyCount),
    barcode: textOrNull(item.barcode),
    itemCode: textOrNull(item.externalVendorSku),
  }
}

export function parseProductDetail(detail: ApiProductDetail, userId: string, nowIso: string): ParsedDetail {
  const itemId = String(detail.sellerProductId)
  const ship = detail.marketplaceShippingAndReturnInfo ?? detail
  const common = {
    user_id: userId,
    item_id: itemId,
    product_name: textOrNull(detail.displayProductName),
    item_name: textOrNull(detail.sellerProductName),
    coupang_approval: textOrNull(detail.statusName),
    delivery_charge_type: textOrNull(ship.deliveryChargeType),
    delivery_charge: numOrNull(ship.deliveryCharge),
    free_ship_over_amount: numOrNull(ship.freeShipOverAmount),
    detail_synced_at: nowIso,
  }

  const rows: ParsedDetail['rows'] = []
  for (const item of detail.items ?? []) {
    const optionName = textOrNull(item.itemName)
    const itemStatus = offerConditionLabel(item.offerCondition)
    const imgUrl = getRepresentativeImageUrl(item.images ?? undefined)
    // 고시정보는 옵션(item) 단위 — 하이브리드면 일반·로켓 두 행에 같은 값을 둔다
    const notices = toCoupangNotices(item.notices)
    const composition = extractComposition(notices)
    const mp = item.marketplaceItemData ?? item.marketPlaceItemData
    const rg = item.rocketGrowthItemData

    const push = (channel: CoupangChannel, v: ReturnType<typeof optionValues>) => {
      if (!v.vendorItemId) return   // 승인 전 옵션은 옵션 ID 가 없다 — PK 가 없어 저장하지 않는다
      rows.push({
        barcode: v.barcode,
        row: {
          option_id: v.vendorItemId,
          item_status: itemStatus,
          item_code: v.itemCode,
          option_name: optionName,
          price: v.price,
          regular_price: v.regularPrice,
          stock: v.stock,
          channel,
          img_url: imgUrl,
          notices,
          composition,
          ...common,
        },
      })
    }

    if (mp || rg) {
      if (mp) push('MP', optionValues(item, mp))
      if (rg) push('RG', optionValues(item, rg))
    } else {
      push('MP', optionValues(item, null))
    }
  }

  return { itemId, productId: idString(detail.productId), rows }
}

/** 상세 행 저장 — 바코드 유무·product_id 유무로 키 구성이 같은 묶음끼리 upsert */
async function saveParsedDetail(parsed: ParsedDetail): Promise<number> {
  const withBarcode = parsed.rows.filter((r) => r.barcode)
  const withoutBarcode = parsed.rows.filter((r) => !r.barcode)
  const groups: Record<string, unknown>[][] = [
    withBarcode.map((r) => ({ ...r.row, barcode: r.barcode })),
    withoutBarcode.map((r) => ({ ...r.row })),
  ]
  let saved = 0
  for (const group of groups) {
    if (group.length === 0) continue
    const rows = parsed.productId ? group.map((r) => ({ ...r, product_id: parsed.productId })) : group
    for (const batch of chunk(rows, UPSERT_BATCH)) {
      const { error } = await supabase.from(TABLE).upsert(batch, { onConflict: 'option_id', defaultToNull: false })
      if (error) throw new Error(error.message)
      saved += batch.length
    }
  }
  return saved
}

export interface DetailSyncResult {
  products: number
  options: number
  failed: string[]     // "등록상품ID: 사유"
  aborted: boolean
}

export async function syncProductDetails(
  userId: string,
  sellerProductIds: string[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<DetailSyncResult> {
  const ids = [...new Set(sellerProductIds)]
  const results = await runRateLimited(
    ids,
    async (id) => {
      const detail = await fetchProductDetailApi(id)
      const parsed = parseProductDetail(detail, userId, new Date().toISOString())
      return saveParsedDetail(parsed)
    },
    { ...COUPANG_RATE_LIMIT, signal, onProgress },
  )

  let products = 0
  let options = 0
  let aborted = false
  const failed: string[] = []
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') { products++; options += r.value; return }
    if (isAbortError(r.reason)) { aborted = true; return }
    failed.push(`${ids[i]}: ${(r.reason as Error)?.message ?? '조회 실패'}`)
  })
  console.log(`[syncProductDetails] 상품 ${products} · 옵션 ${options} · 실패 ${failed.length}${aborted ? ' · 중단' : ''}`)
  return { products, options, failed, aborted }
}

/** 상세를 아직 받지 않은 상품 (detail_synced_at 이 없는 상품) — 범위별 ID 목록 */
export interface DetailMissingIds {
  /** 판매중 옵션이 하나라도 있는 상품 */
  onSale: string[]
  /** 전부 (판매중 상품이 앞) */
  all: string[]
}

export async function fetchDetailMissingProductIds(userId: string): Promise<DetailMissingIds> {
  type Row = Pick<CoupangProductRow, 'item_id' | 'detail_synced_at' | 'sales_status'>
  const rows = await fetchAllRows<Row>(userId, 'item_id, detail_synced_at, sales_status')
  const synced = new Set<string>()
  const onSale = new Set<string>()
  const all = new Set<string>()
  for (const r of rows) {
    if (!r.item_id) continue
    all.add(r.item_id)
    if (r.detail_synced_at) synced.add(r.item_id)
    if (r.sales_status === '판매중') onSale.add(r.item_id)
  }
  const missing = [...all].filter((id) => !synced.has(id))
  const missingOnSale = missing.filter((id) => onSale.has(id))
  return { onSale: missingOnSale, all: [...missingOnSale, ...missing.filter((id) => !onSale.has(id))] }
}

/**
 * 상세는 받았지만 고시정보가 없는(notices = null) 상품 — 고시정보 저장(2026-10-20) 전에 상세를 받은 상품.
 * [상세 받기] 의 '고시정보 받기' 범위. 고시정보 JSON 은 읽지 않고 서버에서 null 로 거른다.
 */
export async function fetchNoticesMissingProductIds(userId: string): Promise<DetailMissingIds> {
  type Row = Pick<CoupangProductRow, 'item_id' | 'sales_status'>
  const rows = await fetchAllRows<Row>(userId, 'item_id, sales_status', undefined, (q) => {
    q.is('notices', null)
    q.not('detail_synced_at', 'is', null)
  })
  const onSale = new Set<string>()
  const all = new Set<string>()
  for (const r of rows) {
    if (!r.item_id) continue
    all.add(r.item_id)
    if (r.sales_status === '판매중') onSale.add(r.item_id)
  }
  const onSaleIds = [...all].filter((id) => onSale.has(id))
  return { onSale: onSaleIds, all: [...onSaleIds, ...[...all].filter((id) => !onSale.has(id))] }
}

/** 상품 1개의 고시정보 · 혼용률 (상세 패널용) — 받은 적이 없으면 notices = null */
export async function fetchProductNotices(
  userId: string,
  itemId: string,
): Promise<{ notices: CoupangNotice[] | null; composition: string | null }> {
  // 하이브리드면 같은 고시정보가 일반·로켓 두 행에 있다 — 받은 행 하나면 충분
  const { data, error } = await supabase
    .from(TABLE)
    .select('notices, composition')
    .eq('user_id', userId)
    .eq('item_id', itemId)
    .not('notices', 'is', null)
    .order('option_id')
    .limit(1)
  if (error) throw error
  const row = (data ?? [])[0] as { notices: CoupangNotice[] | null; composition: string | null } | undefined
  return { notices: row?.notices ?? null, composition: row?.composition ?? null }
}

// ══════════════════════════════════════════════════════════════════
// 동기화 3 — 판매상태 (옵션 1개 = 호출 1번)
// ══════════════════════════════════════════════════════════════════

export interface StatusCheckResult {
  checked: number
  failed: string[]
  aborted: boolean
}

export async function checkSalesStatus(
  userId: string,
  optionIds: string[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<StatusCheckResult> {
  const ids = [...new Set(optionIds)]
  const results = await runRateLimited(
    ids,
    async (id) => {
      const inv = await fetchVendorItemInventory(id)
      const update: Partial<CoupangProductRow> = {
        sales_status: inv.onSale ? '판매중' : '판매중지',
        status_checked_at: new Date().toISOString(),
      }
      if (inv.amountInStock != null) update.stock = inv.amountInStock
      if (inv.salePrice != null) update.price = inv.salePrice
      const { error } = await supabase.from(TABLE).update(update).eq('option_id', id).eq('user_id', userId)
      if (error) throw new Error(error.message)
    },
    { ...COUPANG_RATE_LIMIT, signal, onProgress },
  )

  let checked = 0
  let aborted = false
  const failed: string[] = []
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') { checked++; return }
    if (isAbortError(r.reason)) { aborted = true; return }
    failed.push(`${ids[i]}: ${(r.reason as Error)?.message ?? '조회 실패'}`)
  })
  return { checked, failed, aborted }
}

/** 판매상태 확인이 오래된 순으로 옵션 ID (API 확인·엑셀 반영 중 최근 시각 기준, 없는 것이 맨 앞) */
export async function fetchStaleStatusOptionIds(userId: string, limit: number): Promise<string[]> {
  type Row = Pick<CoupangProductRow, 'option_id' | 'status_checked_at' | 'excel_synced_at' | 'channel' | 'barcode'>
  const rows = await fetchAllRows<Row>(userId, 'option_id, status_checked_at, excel_synced_at, channel, barcode')
  const key = (r: Row) => [r.status_checked_at, r.excel_synced_at].filter((v): v is string => !!v).sort().pop() ?? ''
  return rows
    .sort((a, b) => key(a).localeCompare(key(b)))
    .slice(0, limit)
    .map((r) => r.option_id)
}

// ══════════════════════════════════════════════════════════════════
// 변경 작업 — 가격 · 재고 · 할인율 기준가 · 판매 재개/중지
//   쿠팡 API 가 성공한 옵션만 DB 를 고친다 (app_changed_at 기록)
// ══════════════════════════════════════════════════════════════════

export type ChangeKind = 'price' | 'quantity' | 'originalPrice' | 'resume' | 'stop'

export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  price: '판매가 변경',
  quantity: '재고 변경',
  originalPrice: '할인율 기준가 변경',
  resume: '판매 재개',
  stop: '판매 중지',
}

export interface ChangeTarget {
  optionId: string
  /** price · quantity · originalPrice 에서 적용할 값 */
  value?: number
}

export interface ChangeResult {
  ok: number
  failed: { optionId: string; error: string }[]
  aborted: boolean
}

export async function applyChanges(
  userId: string,
  kind: ChangeKind,
  targets: ChangeTarget[],
  options: { force?: boolean; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<ChangeResult> {
  const now = new Date().toISOString()
  const results = await runRateLimited(
    targets,
    async (t) => {
      let update: Partial<CoupangProductRow>
      switch (kind) {
        case 'price':
          if (t.value == null) throw new Error('값 없음')
          await updateVendorItemPrice(t.optionId, t.value, options.force ?? false)
          update = { price: t.value }
          break
        case 'quantity':
          if (t.value == null) throw new Error('값 없음')
          await putVendorItemQuantity(t.optionId, t.value)
          update = { stock: t.value }
          break
        case 'originalPrice':
          if (t.value == null) throw new Error('값 없음')
          await putVendorItemOriginalPrice(t.optionId, t.value)
          update = { regular_price: t.value }
          break
        case 'resume':
          await setVendorItemSale(t.optionId, 'resume')
          update = { sales_status: '판매중', status_checked_at: now }
          break
        case 'stop':
          await setVendorItemSale(t.optionId, 'stop')
          update = { sales_status: '판매중지', status_checked_at: now }
          break
      }
      const { error } = await supabase
        .from(TABLE)
        .update({ ...update, app_changed_at: now })
        .eq('option_id', t.optionId)
        .eq('user_id', userId)
      if (error) throw new Error(`쿠팡 적용됨 · DB 기록 실패: ${error.message}`)
    },
    { ...COUPANG_RATE_LIMIT, signal: options.signal, onProgress: options.onProgress },
  )

  let ok = 0
  let aborted = false
  const failed: ChangeResult['failed'] = []
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') { ok++; return }
    if (isAbortError(r.reason)) { aborted = true; return }
    failed.push({ optionId: targets[i].optionId, error: (r.reason as Error)?.message ?? '실패' })
  })
  return { ok, failed, aborted }
}

// ══════════════════════════════════════════════════════════════════
// 엑셀 1 — WING 가격/재고 엑셀 업로드 (보조)
//   양식: 1행 안내 · 2행 묶음 · 3행 머리글 · 4행부터 데이터 (A~O 조회 결과, P~S 변경 요청)
//   A 업체상품ID · B Product ID · C 옵션ID · D 상품상태 · E 바코드 · F 업체상품코드 · G 쿠팡 노출 상품명
//   H 업체 등록 상품명 · I 등록 옵션명 · J 판매가격 · K 할인율기준가 · L 판매상태 · M 잔여수량 · N 판매수량 · O 승인상태
//   - 기존 행은 분류·비고·시즌·채널을 건드리지 않고, 새 행에만 분류 '출고' + 채널(바코드 유무)
// ══════════════════════════════════════════════════════════════════

const EXCEL_HEADER_ROWS = 3
const EXCEL_BATCH = 100

export interface ExcelUploadResult {
  total: number
  success: number
  failedBatches: number
}

function excelInt(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = parseInt(String(v).replace(/,/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

export async function uploadPriceInventoryExcel(
  file: File,
  userId: string,
  onProgress?: (percent: number, status: string) => void,
): Promise<ExcelUploadResult> {
  onProgress?.(0, '파일을 읽는 중…')
  const workbook = XLSX.read(await file.arrayBuffer())
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][]
  const dataRows = allRows.slice(EXCEL_HEADER_ROWS).filter((row) => row[2] != null && row[2] !== '')
  const now = new Date().toISOString()

  let success = 0
  let failedBatches = 0
  const batches = chunk(dataRows, EXCEL_BATCH)
  for (let b = 0; b < batches.length; b++) {
    const items = batches[b].map((row) => ({
      option_id: String(row[2]).trim(),
      user_id: userId,
      item_id: textOrNull(row[0] != null ? String(row[0]) : null),
      product_id: textOrNull(row[1] != null ? String(row[1]) : null),
      item_status: textOrNull(row[3] != null ? String(row[3]) : null),
      barcode: textOrNull(row[4] != null ? String(row[4]) : null),
      item_code: textOrNull(row[5] != null ? String(row[5]) : null),
      product_name: textOrNull(row[6] != null ? String(row[6]) : null),
      item_name: textOrNull(row[7] != null ? String(row[7]) : null),
      option_name: textOrNull(row[8] != null ? String(row[8]) : null),
      price: excelInt(row[9]),
      regular_price: excelInt(row[10]),
      sales_status: textOrNull(row[11] != null ? String(row[11]) : null),
      stock: excelInt(row[12]),
      sales_data: excelInt(row[13]),
      coupang_approval: textOrNull(row[14] != null ? String(row[14]) : null),
      excel_synced_at: now,
    }))

    // 기존/신규를 나눠 보낸다 — 새 행만 분류 기본값·채널을 받는다
    const { data: existingRows, error: existingError } = await supabase
      .from(TABLE)
      .select('option_id')
      .in('option_id', items.map((it) => it.option_id))
    if (existingError) {
      console.error('[uploadPriceInventoryExcel] 기존 행 확인 오류:', existingError)
      failedBatches++
    } else {
      const existingIds = new Set((existingRows ?? []).map((r) => String(r.option_id)))
      const updates = items.filter((it) => existingIds.has(it.option_id))
      const inserts = items
        .filter((it) => !existingIds.has(it.option_id))
        .map((it) => ({ ...it, package_type: '출고', channel: (it.barcode ? 'RG' : 'MP') as CoupangChannel }))
      let failed = false
      for (const rows of [updates, inserts]) {
        if (rows.length === 0) continue
        const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: 'option_id', defaultToNull: false })
        if (error) {
          console.error('[uploadPriceInventoryExcel] upsert 오류:', error)
          failed = true
        }
      }
      if (failed) failedBatches++
      else success += items.length
    }

    const processed = Math.min((b + 1) * EXCEL_BATCH, dataRows.length)
    onProgress?.(Math.round((processed / dataRows.length) * 100), `처리 중… ${processed} / ${dataRows.length} (성공 ${success})`)
  }

  return { total: dataRows.length, success, failedBatches }
}

// ══════════════════════════════════════════════════════════════════
// 엑셀 2 — 분류 엑셀 업로드 (A 바코드 · B 분류 · C 비고, 1행 머리글)
// ══════════════════════════════════════════════════════════════════

export interface ClassifyExcelResult {
  successCount: number
  notFoundBarcodes: string[]
  invalidTypeBarcodes: { barcode: string; inputType: string }[]
}

export async function uploadClassifyExcel(file: File, userId: string): Promise<ClassifyExcelResult> {
  const workbook = XLSX.read(await file.arrayBuffer())
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][]
  const dataRows = allRows.slice(1).filter((row) => row[0] != null && row[0] !== '')
  const validTypes = new Set<string>(PACKAGE_TYPE_OPTIONS)

  const parsed: { barcode: string; packageType: string | null; note: string | null }[] = []
  const invalidTypeBarcodes: ClassifyExcelResult['invalidTypeBarcodes'] = []
  for (const row of dataRows) {
    const barcode = String(row[0]).trim()
    const rawType = row[1] != null && row[1] !== '' ? String(row[1]).trim() : null
    const note = row[2] != null && row[2] !== '' ? String(row[2]).trim() : null
    if (rawType && !validTypes.has(rawType)) { invalidTypeBarcodes.push({ barcode, inputType: rawType }); continue }
    parsed.push({ barcode, packageType: rawType, note })
  }

  const notFoundBarcodes: string[] = []
  if (parsed.length === 0) return { successCount: 0, notFoundBarcodes, invalidTypeBarcodes }

  const found = new Set<string>()
  for (const codes of chunk(parsed.map((r) => r.barcode), IN_CHUNK)) {
    const { data } = await supabase.from(TABLE).select('barcode').eq('user_id', userId).in('barcode', codes)
    for (const r of data ?? []) if (r.barcode) found.add(String(r.barcode))
  }

  let successCount = 0
  for (const row of parsed) {
    if (!found.has(row.barcode)) { notFoundBarcodes.push(row.barcode); continue }
    const payload: { package_type?: string; note?: string } = {}
    if (row.packageType) payload.package_type = row.packageType
    if (row.note) payload.note = row.note
    if (Object.keys(payload).length === 0) { successCount++; continue }
    const { error } = await supabase.from(TABLE).update(payload).eq('barcode', row.barcode).eq('user_id', userId)
    if (!error) successCount++
  }
  return { successCount, notFoundBarcodes, invalidTypeBarcodes }
}

// ══════════════════════════════════════════════════════════════════
// 엑셀 3 — 내보내기 (계정 전체)
// ══════════════════════════════════════════════════════════════════

export async function exportProductsToExcel(userId: string, onProgress?: (done: number, total: number) => void): Promise<number> {
  const rows = await fetchAllRows<CoupangProductRow>(userId, ROW_COLUMNS, onProgress)
  if (rows.length === 0) return 0

  const sheetRows = rows.map((r) => ({
    '등록상품 ID': r.item_id,
    '노출상품 ID': r.product_id,
    '옵션 ID': r.option_id,
    '구분': (r.channel ?? (r.barcode ? 'RG' : 'MP')) === 'RG' ? '로켓그로스' : '일반',
    '바코드': r.barcode,
    '업체상품코드': r.item_code,
    '노출상품명': r.product_name,
    '등록상품명': r.item_name,
    '옵션명': r.option_name,
    '판매가': r.price,
    '할인율기준가': r.regular_price,
    '판매상태': r.sales_status,
    '재고': r.stock,
    '승인상태': r.coupang_approval,
    '혼용률': r.composition,
    '분류': r.package_type,
    '비고': r.note,
    '시즌': r.season,
  }))
  const sheet = XLSX.utils.json_to_sheet(sheetRows)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, '상품관리')
  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(book, `상품관리_${stamp}.xlsx`)
  return rows.length
}
