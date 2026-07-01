/* ================================================================
   분석관리 (AnalysisManagement) — 데이터 집계 서비스
   - 사입관리(purchase-management) 페이지의 원본 데이터를 그대로 재사용해
     화면 컬럼별 총합을 계산한다.
   - 데이터 소스:
       si_rg_items       → 주문(order_qty)
       si_rg_item_data   → C.in, C.재고, 7d/30d 판매량, 보관료
       si_rg_views       → 조회수 V1~V5
       si_stocks         → 창고 재고(qty)
   - 모든 조회는 1000-row 배치 루프로 전체를 처리한다.
   ================================================================ */

import { supabase } from './supabase'
import {
  fetchRgItems,
  fetchRgItemData,
  fetchViewsData,
  getRecentViewDates,
} from './purchaseService'

// ── V1~V5 개별 집계 항목 ──────────────────────────────────────────
export interface ViewDateTotal {
  date: string   // 조회 날짜 (YYYY-MM-DD)
  total: number  // 해당 날짜 전체 아이템 조회수 합
}

// ── 분석 요약 결과 ────────────────────────────────────────────────
export interface AnalysisSummary {
  orderQtyTotal: number       // 1. 현재 주문개수 (Σ si_rg_items.order_qty)
  cInTotal: number            // 2. C.in 총합 (Σ pending_inbounds)
  cStockTotal: number         // 3. C.재고 총합 (Σ orderable_qty)
  warehouseTotal: number      // 4. 창고 재고 총합 (Σ si_stocks.qty)
  sales7dTotal: number        // 5-1. 7일 판매량 총합 (Σ recent_sales_qty_7d)
  sales30dTotal: number       // 5-2. 30일 판매량 총합 (Σ recent_sales_qty_30d)
  viewDateTotals: ViewDateTotal[]  // 6. V1~V5 날짜별 총합 (오래된순, 최대 5개)
  viewGrandTotal: number      // 6. V1~V5 전체 합
  storageFeeTotal: number     // 7. 보관료 총 금액 (Σ monthly_storage_fee)
  itemCount: number           // 참고: 집계 대상 아이템 수 (si_rg_items)
}

// ── 창고 재고 총합 (barcode 무관, si_stocks.qty 전체 합, 1000행 배치) ──
async function fetchWarehouseQtyTotal(userId: string): Promise<number> {
  let total = 0
  let from = 0
  const batchSize = 1000
  while (true) {
    const { data, error } = await supabase
      .from('si_stocks')
      .select('qty')
      .eq('user_id', userId)
      .range(from, from + batchSize - 1)
    if (error) {
      console.error('[분석관리] 창고 재고 조회 오류:', error)
      break
    }
    if (!data || data.length === 0) break
    for (const row of data) total += row.qty || 0
    if (data.length < batchSize) break
    from += batchSize
  }
  return total
}

/**
 * 사입관리 데이터를 통합 집계해 요약 반환.
 * - 4개 소스를 병렬 조회 후 각 컬럼 총합을 계산한다.
 */
export async function fetchAnalysisSummary(userId: string): Promise<AnalysisSummary> {
  const [rgItems, rgItemData, viewsData, warehouseTotal] = await Promise.all([
    fetchRgItems(userId),
    fetchRgItemData(userId),
    fetchViewsData(userId),
    fetchWarehouseQtyTotal(userId),
  ])

  // ── 1. 주문개수: si_rg_items.order_qty 합 ──
  const orderQtyTotal = rgItems.reduce((sum, it) => sum + (it.order_qty ?? 0), 0)

  // ── 2·3·5·7. si_rg_item_data 필드 합 ──
  let cInTotal = 0
  let cStockTotal = 0
  let sales7dTotal = 0
  let sales30dTotal = 0
  let storageFeeTotal = 0
  for (const d of rgItemData) {
    cInTotal += d.pending_inbounds ?? 0
    cStockTotal += d.orderable_qty ?? 0
    sales7dTotal += d.recent_sales_qty_7d ?? 0
    sales30dTotal += d.recent_sales_qty_30d ?? 0
    storageFeeTotal += d.monthly_storage_fee ?? 0
  }

  // ── 6. 조회수 V1~V5: 최근 5개 날짜별 전체 아이템 합 ──
  const recentDates = getRecentViewDates(viewsData)  // [V1(오래된)…V5(최근)]
  const dateSum = new Map<string, number>()
  for (const v of viewsData) {
    if (!dateSum.has(v.date)) dateSum.set(v.date, 0)
    dateSum.set(v.date, dateSum.get(v.date)! + (v.view ?? 0))
  }
  const viewDateTotals: ViewDateTotal[] = recentDates.map((date) => ({
    date,
    total: dateSum.get(date) ?? 0,
  }))
  const viewGrandTotal = viewDateTotals.reduce((sum, v) => sum + v.total, 0)

  return {
    orderQtyTotal,
    cInTotal,
    cStockTotal,
    warehouseTotal,
    sales7dTotal,
    sales30dTotal,
    viewDateTotals,
    viewGrandTotal,
    storageFeeTotal,
    itemCount: rgItems.length,
  }
}
