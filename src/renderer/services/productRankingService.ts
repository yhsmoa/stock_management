/* ================================================================
   상품 랭킹 서비스 (홈 화면)
   - 로켓그로스 사입(사입관리) 화면과 **같은 원천·같은 계산**으로
     상품(seller_product_id) 단위 합계를 만들어 순위를 매긴다.
   - 사입관리는 행을 통째로(select *) 받지만, 홈은 랭킹에 필요한 열만 받는다.
     (si_rg_items·si_rg_item_data 가 계정당 1~2만 행이라 홈 진입마다 전부 받으면 무겁다)
   - 집계 규칙은 사입관리의 [상품기준] 정렬과 맞춘다:
       · 비활성(item_status = 'NOT_AVAILABLE') 옵션은 제외 — 사입관리 기본 필터(활성)와 동일
       · 기준 값이 0 인 상품은 순위에서 제외
   - 상품 이미지는 순위에 든 상품만: 저장된 img_url 우선, 없으면 쿠팡 상품 상세 API.
   ================================================================ */

import { supabase } from './supabase'
import { fetchPeriodSalesAgg, type PeriodSalesAgg } from './periodSalesService'
import { fetchPersonalOrderQtyByBarcode } from './personalOrderService'
import { fetchRgProductDetail, getRepresentativeImageUrl } from './purchaseService'

// ══════════════════════════════════════════════════════════════════
// 타입 · 상수
// ══════════════════════════════════════════════════════════════════

/** Supabase PostgREST 한 번에 받는 최대 행 수 — 전량 조회는 이 크기로 페이지를 돈다 */
const BATCH_SIZE = 1000

/** 홈에 처음 보여 줄 순위 수 — [더보기] 를 누르면 같은 수만큼 더 보여 준다 */
export const RANKING_SIZE = 10

/** [더보기] 까지 포함해 보여 주는 최대 순위 (1~10위 + 11~20위) */
export const RANKING_MAX_SIZE = RANKING_SIZE * 2

/** 순위 기준 — 표의 판매량 네 열 중 하나 */
export type RankingBasis = 'personal' | 'period' | 'd7' | 'd30'

export const RANKING_BASES: { key: RankingBasis; label: string; hint: string }[] = [
  { key: 'personal', label: '개인', hint: '개인주문 결제완료·상품준비중 출고 예정 수량' },
  { key: 'period',   label: '기간', hint: '업로드한 기간판매량 (판매자배송 + 로켓그로스)' },
  { key: 'd7',       label: '7일',  hint: '최근 7일 판매량 (재고 SKU 엑셀)' },
  { key: 'd30',      label: '30일', hint: '최근 30일 판매량 (재고 SKU 엑셀)' },
]

/** 랭킹에 필요한 si_rg_items 열만 */
interface RankingItemRow {
  id: string
  seller_product_id: string | null
  seller_product_name: string | null
  vendor_item_id: string | null
  barcode: string | null
  order_qty: number | null
  cart_qty: number | null
  item_status: string | null
}

/** 랭킹에 필요한 si_rg_item_data 열만 (옵션 ID 기준) */
interface RankingItemData {
  pendingInbounds: number
  sales7d: number
  sales30d: number
}

/** 집계 원천 — 한 번 받아 두고 기준만 바꿔 다시 순위를 매긴다 */
export interface ProductRankingSource {
  items: RankingItemRow[]
  itemDataMap: Map<string, RankingItemData>      // option_id → 판매량·입고예정
  periodSalesMap: Map<string, PeriodSalesAgg>    // vendor_item_id → 기간판매량
  personalQtyMap: Map<string, number>            // barcode → 개인주문 출고 예정 수량
  warehouseQtyMap: Map<string, number>           // barcode → 창고 재고 합
}

/** 순위 한 줄 — 상품 단위 합계 */
export interface ProductRankingRow {
  rank: number
  productId: string
  name: string
  optionCount: number
  personal: number   // 개인
  period: number     // 기간
  d7: number         // 7일
  d30: number        // 30일
  cart: number       // 🛒
  order: number      // 주문
  cIn: number        // C.in
  warehouse: number  // 창고
}

// ══════════════════════════════════════════════════════════════════
// 조회 (전부 1000행 페이지 루프)
// ══════════════════════════════════════════════════════════════════

// ── si_rg_items — 랭킹에 필요한 열만 ────────────────────────────────
async function fetchRankingItems(userId: string): Promise<RankingItemRow[]> {
  const rows: RankingItemRow[] = []
  for (let from = 0; ; from += BATCH_SIZE) {
    const { data, error } = await supabase
      .from('si_rg_items')
      .select('id, seller_product_id, seller_product_name, vendor_item_id, barcode, order_qty, cart_qty, item_status')
      .eq('user_id', userId)
      .order('id')                       // 페이지 사이에 순서가 흔들리면 행이 빠지거나 겹친다
      .range(from, from + BATCH_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...(data as RankingItemRow[]))
    if (data.length < BATCH_SIZE) break
  }
  return rows
}

// ── si_rg_item_data — 옵션 ID → 판매량·입고예정 ─────────────────────
async function fetchRankingItemData(userId: string): Promise<Map<string, RankingItemData>> {
  const map = new Map<string, RankingItemData>()
  for (let from = 0; ; from += BATCH_SIZE) {
    const { data, error } = await supabase
      .from('si_rg_item_data')
      .select('id, option_id, pending_inbounds, recent_sales_qty_7d, recent_sales_qty_30d')
      .eq('user_id', userId)
      .order('id')
      .range(from, from + BATCH_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const d of data) {
      if (d.option_id == null) continue
      // 사입관리의 itemDataMap 과 같은 규칙 — 같은 옵션 ID 가 여러 번 나오면 뒤의 것이 남는다
      map.set(String(d.option_id), {
        pendingInbounds: d.pending_inbounds ?? 0,
        sales7d: d.recent_sales_qty_7d ?? 0,
        sales30d: d.recent_sales_qty_30d ?? 0,
      })
    }
    if (data.length < BATCH_SIZE) break
  }
  return map
}

// ── si_stocks — 바코드별 창고 재고 합 ───────────────────────────────
async function fetchWarehouseQtyByBarcode(userId: string): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  for (let from = 0; ; from += BATCH_SIZE) {
    const { data, error } = await supabase
      .from('si_stocks')
      .select('id, barcode, qty')
      .eq('user_id', userId)
      .order('id')
      .range(from, from + BATCH_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) {
      if (row.barcode) map.set(row.barcode, (map.get(row.barcode) ?? 0) + (row.qty ?? 0))
    }
    if (data.length < BATCH_SIZE) break
  }
  return map
}

/**
 * 랭킹 원천을 한꺼번에 받는다.
 * 상품 목록·판매량(재고 SKU)은 랭킹의 뼈대라 실패하면 그대로 던지고,
 * 기간판매량·개인주문·창고는 곁들이는 값이라 실패해도 빈 값으로 두고 나머지를 보여 준다
 * (사입관리의 로드 규칙과 같다).
 */
export async function loadProductRankingSource(userId: string): Promise<ProductRankingSource> {
  const [items, itemDataMap, periodSalesMap, personalQtyMap, warehouseQtyMap] = await Promise.all([
    fetchRankingItems(userId),
    fetchRankingItemData(userId),
    fetchPeriodSalesAgg(userId).catch((e) => {
      console.error('[상품 랭킹] 기간판매량 조회 실패:', e)
      return new Map<string, PeriodSalesAgg>()
    }),
    fetchPersonalOrderQtyByBarcode(userId).catch((e) => {
      console.error('[상품 랭킹] 개인주문 수량 조회 실패:', e)
      return new Map<string, number>()
    }),
    fetchWarehouseQtyByBarcode(userId).catch((e) => {
      console.error('[상품 랭킹] 창고 재고 조회 실패:', e)
      return new Map<string, number>()
    }),
  ])
  return { items, itemDataMap, periodSalesMap, personalQtyMap, warehouseQtyMap }
}

// ══════════════════════════════════════════════════════════════════
// 상품 이미지 (순위에 든 상품만)
// ══════════════════════════════════════════════════════════════════

// ── si_rg_items.img_url — 상품 ID → 대표 이미지 ─────────────────────
//   img_url 은 상품 동기화 때 쿠팡 상세 API 에서 받아 저장해 둔 값이다.
//   전체 행에서 받으면 URL 문자열만 수 MB 라, 순위에 든 상품의 행만 따로 조회한다.
//   한 상품의 옵션이 많으면 1000행을 넘을 수 있어 여기도 페이지를 돈다.
async function fetchStoredImageUrls(userId: string, productIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (let from = 0; ; from += BATCH_SIZE) {
    const { data, error } = await supabase
      .from('si_rg_items')
      .select('id, seller_product_id, img_url')
      .eq('user_id', userId)
      .in('seller_product_id', productIds)
      .not('img_url', 'is', null)
      .order('id')
      .range(from, from + BATCH_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) {
      // 상품당 첫 옵션(id 순)의 이미지를 대표로 쓴다
      if (row.seller_product_id && row.img_url && !map.has(row.seller_product_id)) {
        map.set(row.seller_product_id, row.img_url)
      }
    }
    if (data.length < BATCH_SIZE) break
  }
  return map
}

// ── 쿠팡 상품 상세 API — 저장된 이미지가 없는 상품만 ────────────────
//   초당 5회 제한이 있어 하나씩 차례로 부른다 (많아야 순위 수만큼).
//   실패한 상품은 이미지 없이 둔다 — 랭킹 자체는 이미지와 무관하게 보여야 한다.
async function fetchImageUrlsFromCoupang(productIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const productId of productIds) {
    const numericId = Number(productId)
    if (!Number.isFinite(numericId)) continue
    try {
      const detail = await fetchRgProductDetail(numericId)
      for (const item of detail.items ?? []) {
        const url = getRepresentativeImageUrl(item.images)
        if (url) {
          map.set(productId, url)
          break
        }
      }
    } catch (e) {
      console.error(`[상품 랭킹] 이미지 조회 실패 (${productId}):`, e)
    }
  }
  return map
}

/**
 * 상품 ID → 대표 이미지 URL. 이미지를 못 찾은 상품은 결과에 없다.
 *   1) si_rg_items 에 저장된 img_url (쿠팡 API 를 부르지 않아 바로 온다)
 *   2) 저장된 값이 없는 상품만 쿠팡 상품 상세 API 로 조회
 */
export async function fetchProductImageUrls(userId: string, productIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(productIds.filter(Boolean))]
  if (ids.length === 0) return new Map()

  const stored = await fetchStoredImageUrls(userId, ids).catch((e) => {
    console.error('[상품 랭킹] 저장된 이미지 조회 실패:', e)
    return new Map<string, string>()
  })

  const missing = ids.filter((id) => !stored.has(id))
  if (missing.length === 0) return stored

  const fromApi = await fetchImageUrlsFromCoupang(missing)
  return new Map([...stored, ...fromApi])
}

// ══════════════════════════════════════════════════════════════════
// 집계 · 순위
// ══════════════════════════════════════════════════════════════════

/** 상품별 누적 중간값 — 바코드·옵션 ID 는 한 번씩만 더하도록 본 것을 기억한다 */
interface ProductAcc extends Omit<ProductRankingRow, 'rank'> {
  seenBarcodes: Set<string>
  seenVendorItems: Set<string>
}

/**
 * 상품(seller_product_id) 단위로 합쳐 기준 값 내림차순 상위 `limit` 개를 돌려준다.
 *   · 개인·창고는 **바코드 기준** 값이라, 한 상품 안에서 같은 바코드가 두 옵션에 걸려 있으면 한 번만 더한다
 *   · 기간·7일·30일·C.in 은 **옵션 ID 기준** — 같은 이유로 옵션 ID 당 한 번만
 *   · 🛒·주문은 행(si_rg_items)에 저장된 값이라 행마다 더한다
 *   · seller_product_id 가 없는 행은 상품으로 묶을 수 없어 행 하나를 상품 하나로 친다
 *   · 동점이면 상품명(한글 오름차순) — 사입관리 정렬과 같은 2차 기준
 */
export function buildProductRanking(
  source: ProductRankingSource,
  basis: RankingBasis,
  limit: number = RANKING_SIZE,
): ProductRankingRow[] {
  const products = new Map<string, ProductAcc>()

  for (const item of source.items) {
    if (item.item_status === 'NOT_AVAILABLE') continue

    const key = item.seller_product_id || `row:${item.id}`
    let acc = products.get(key)
    if (!acc) {
      acc = {
        productId: item.seller_product_id ?? '',
        name: '',
        optionCount: 0,
        personal: 0, period: 0, d7: 0, d30: 0, cart: 0, order: 0, cIn: 0, warehouse: 0,
        seenBarcodes: new Set(),
        seenVendorItems: new Set(),
      }
      products.set(key, acc)
    }

    acc.optionCount += 1
    if (!acc.name && item.seller_product_name) acc.name = item.seller_product_name
    acc.cart += item.cart_qty ?? 0
    acc.order += item.order_qty ?? 0

    const barcode = item.barcode?.trim()
    if (barcode && !acc.seenBarcodes.has(barcode)) {
      acc.seenBarcodes.add(barcode)
      acc.personal += source.personalQtyMap.get(barcode) ?? 0
      acc.warehouse += source.warehouseQtyMap.get(barcode) ?? 0
    }

    const vendorItemId = item.vendor_item_id
    if (vendorItemId && !acc.seenVendorItems.has(vendorItemId)) {
      acc.seenVendorItems.add(vendorItemId)
      const ps = source.periodSalesMap.get(vendorItemId)
      if (ps) acc.period += ps.seller + ps.rocket
      const data = source.itemDataMap.get(vendorItemId)
      if (data) {
        acc.d7 += data.sales7d
        acc.d30 += data.sales30d
        acc.cIn += data.pendingInbounds
      }
    }
  }

  return [...products.values()]
    .filter((p) => p[basis] > 0)
    .sort((a, b) => (b[basis] - a[basis]) || a.name.localeCompare(b.name, 'ko'))
    .slice(0, limit)
    .map(({ seenBarcodes: _b, seenVendorItems: _v, ...row }, i) => ({ rank: i + 1, ...row }))
}

/** 기준별 순위표 묶음 — 화면과 이 브라우저 보관본(productRankingCache)이 함께 쓰는 모양 */
export type ProductRankings = Record<RankingBasis, ProductRankingRow[]>

/**
 * 네 기준의 순위를 한꺼번에(각각 [더보기] 포함 최대 순위까지) 매긴다.
 * 원천은 수만 행이라 보관할 수 없으므로, 기준을 바꿔도 다시 조회하지 않게 결과를 전부 만들어 둔다.
 */
export function buildAllProductRankings(source: ProductRankingSource): ProductRankings {
  return {
    personal: buildProductRanking(source, 'personal', RANKING_MAX_SIZE),
    period: buildProductRanking(source, 'period', RANKING_MAX_SIZE),
    d7: buildProductRanking(source, 'd7', RANKING_MAX_SIZE),
    d30: buildProductRanking(source, 'd30', RANKING_MAX_SIZE),
  }
}
