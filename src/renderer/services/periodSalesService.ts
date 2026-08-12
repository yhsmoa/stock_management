/* ================================================================
   기간판매량 서비스 (SELLER_INSIGHTS_VENDOR_ITEM_METRICS 엑셀)
   - 엑셀의 판매량을 로켓그로스 상품(si_rg_items) 행에 매칭해 집계한다.
   - 판매방식 두 종류를 다르게 매칭한다:
       · 로켓그로스   → 옵션 ID = vendor_item_id 직접 매칭
       · 판매자배송   → '바코드 연결' 과 동일한 6단계 규칙으로 매칭
                        (판매자배송 상품은 옵션 ID 가 달라 직접 매칭 불가)
   - 매칭 실패한 판매자배송(판매량 ≥ 1)은 엑셀로 되돌려준다.
   ================================================================ */

import * as XLSX from 'xlsx'
import { supabase } from './supabase'
import type { RgItem } from '../types/purchase'
import { buildRgMatchIndex, findRgItem } from './barcodeMatchingService'
import { downloadStyledWorkbook } from './inboundExcelService'

// ── 엑셀 컬럼 (0-based, A~S 전체) ──────────────────────────────────
const COL = {
  optionId: 0,          // A 옵션 ID
  optionName: 1,        // B 옵션명
  itemName: 2,          // C 상품명
  sellerProductId: 3,   // D 등록상품ID
  category: 4,          // E 카테고리
  channel: 5,           // F 판매방식
  revenue: 6,           // G 매출(원)
  orderCount: 7,        // H 주문
  qty: 8,               // I 판매량
  visitors: 9,          // J 방문자
  viewCount: 10,        // K 조회
  cartCount: 11,        // L 장바구니
  conversionRate: 12,   // M 구매전환율 ('11.11%')
  itemWinnerRate: 13,   // N 아이템위너 비율(%)
  totalRevenue: 14,     // O 총 매출(원)
  totalSalesQty: 15,    // P 총 판매수
  totalCancelAmount: 16,// Q 총 취소 금액(원)
  totalCancelQty: 17,   // R 총 취소된 상품수
  instantCancelQty: 18, // S 즉시 취소된 상품수
} as const

/** 판매방식 값 */
export const CHANNEL_ROCKET = '로켓그로스'
export const CHANNEL_SELLER = '판매자배송'

/** 매칭 실패 판매자배송 엑셀 파일명 */
const UNMATCHED_FILE_NAME = '미매칭 판매자배송.xlsx'

// ── 타입 ──────────────────────────────────────────────────────────
/** 엑셀 한 행 (A~S 전체 보관) */
export interface PeriodSalesRow {
  optionId: string
  optionName: string
  itemName: string
  sellerProductId: string
  category: string
  channel: string
  revenue: number | null
  orderCount: number | null
  qty: number
  visitors: number | null
  viewCount: number | null
  cartCount: number | null
  conversionRate: string        // '11.11%' 형태 그대로
  itemWinnerRate: number | null
  totalRevenue: number | null
  totalSalesQty: number | null
  totalCancelAmount: number | null
  totalCancelQty: number | null
  instantCancelQty: number | null
  /** 매칭된 로켓그로스 옵션 ID (집계 단계에서 채워짐, 미매칭이면 null) */
  matchedVendorItemId?: string | null
}

/** vendor_item_id 별 판매량 (판매방식 분리 보관 → 툴팁 표시용) */
export interface PeriodSalesAgg {
  rocket: number
  seller: number
}

export interface PeriodSalesResult {
  aggMap: Map<string, PeriodSalesAgg>
  totalRows: number
  rocketMatched: number
  rocketUnmatched: number
  sellerMatched: number
  sellerUnmatched: number
  /** 판매량 ≥ 1 인데 매칭 실패한 판매자배송 행 */
  unmatchedSellerRows: PeriodSalesRow[]
}

// ── 파싱 ──────────────────────────────────────────────────────────

const str = (v: any): string => (v == null ? '' : String(v).trim())
const num = (v: any): number => {
  const n = Number(str(v).replace(/,/g, ''))
  return isNaN(n) ? 0 : n
}
/** 빈 값은 null 로 (DB 에 0 과 미입력을 구분해 저장) */
const numOrNull = (v: any): number | null => {
  const s = str(v).replace(/,/g, '')
  if (s === '') return null
  const n = Number(s)
  return isNaN(n) ? null : n
}
/** 정수 컬럼 — 소수가 섞여 와도 안전하게 반올림 */
const intOrNull = (v: any): number | null => {
  const n = numOrNull(v)
  return n == null ? null : Math.round(n)
}

/** 헤더 검증 — A/F/I 열이 기대한 항목인지 확인 */
export function validatePeriodSalesHeader(header: any[]): boolean {
  if (!header) return false
  return (
    str(header[COL.optionId]).includes('옵션')
    && str(header[COL.channel]).includes('판매방식')
    && str(header[COL.qty]).includes('판매량')
  )
}

/**
 * 엑셀 옵션명 정규화.
 * 이 엑셀의 B열은 '상품명, 옵션1, 옵션2' 형태라 si_rg_items.option_name
 * ('M 오리지널 블루') 과 형식이 다르다. 상품명 접두어를 떼고 콤마를 공백으로
 * 바꿔 옵션값만 남긴다.
 *   '…슬릿 스커트, 오리지널 블루, M'  →  '오리지널 블루 M'
 * (순서가 달라도 매칭 규칙 3의 토큰정렬에서 일치한다)
 */
export function deriveOptionName(optionName: string, itemName: string): string {
  let s = optionName
  if (itemName && s.startsWith(itemName)) s = s.slice(itemName.length)
  return s
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ')
}

/** Row 0 = 헤더, Row 1~ = 데이터 */
export function parsePeriodSalesRows(rows: any[][]): PeriodSalesRow[] {
  const out: PeriodSalesRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length === 0) continue
    const optionId = str(r[COL.optionId])
    const channel = str(r[COL.channel])
    if (!optionId && !channel) continue
    out.push({
      optionId,
      optionName: str(r[COL.optionName]),
      itemName: str(r[COL.itemName]),
      sellerProductId: str(r[COL.sellerProductId]),
      category: str(r[COL.category]),
      channel,
      revenue: numOrNull(r[COL.revenue]),
      orderCount: intOrNull(r[COL.orderCount]),
      qty: num(r[COL.qty]),
      visitors: intOrNull(r[COL.visitors]),
      viewCount: intOrNull(r[COL.viewCount]),
      cartCount: intOrNull(r[COL.cartCount]),
      conversionRate: str(r[COL.conversionRate]),
      itemWinnerRate: numOrNull(r[COL.itemWinnerRate]),
      totalRevenue: numOrNull(r[COL.totalRevenue]),
      totalSalesQty: intOrNull(r[COL.totalSalesQty]),
      totalCancelAmount: numOrNull(r[COL.totalCancelAmount]),
      totalCancelQty: intOrNull(r[COL.totalCancelQty]),
      instantCancelQty: intOrNull(r[COL.instantCancelQty]),
      matchedVendorItemId: null,
    })
  }
  return out
}

// ── 집계 ──────────────────────────────────────────────────────────

/**
 * 엑셀 행을 si_rg_items 에 매칭해 vendor_item_id 별로 합산한다.
 * - 로켓그로스: 옵션 ID = vendor_item_id
 * - 판매자배송: 6단계 규칙(findRgItem)으로 대응 상품을 찾은 뒤 그 vendor_item_id 사용
 */
export function aggregatePeriodSales(
  rows: PeriodSalesRow[],
  rgItems: RgItem[],
): PeriodSalesResult {
  // 판매자배송 매칭용 인덱스 — 바코드 유무와 무관하게 전체 상품을 후보로 삼는다
  const idx = buildRgMatchIndex(rgItems, false)
  const rocketIds = new Set(
    rgItems.map((r) => r.vendor_item_id).filter(Boolean) as string[],
  )

  const aggMap = new Map<string, PeriodSalesAgg>()
  const bump = (vid: string, key: keyof PeriodSalesAgg, qty: number) => {
    const e = aggMap.get(vid) ?? { rocket: 0, seller: 0 }
    e[key] += qty
    aggMap.set(vid, e)
  }

  let rocketMatched = 0
  let rocketUnmatched = 0
  let sellerMatched = 0
  let sellerUnmatched = 0
  const unmatchedSellerRows: PeriodSalesRow[] = []

  for (const row of rows) {
    row.matchedVendorItemId = null

    if (row.channel === CHANNEL_ROCKET) {
      if (row.optionId && rocketIds.has(row.optionId)) {
        bump(row.optionId, 'rocket', row.qty)
        row.matchedVendorItemId = row.optionId
        rocketMatched++
      } else {
        rocketUnmatched++
      }
      continue
    }

    if (row.channel === CHANNEL_SELLER) {
      const hit = findRgItem(
        {
          vendorItemId: row.optionId,
          sellerProductId: row.sellerProductId,
          // 엑셀 옵션명은 '상품명, 옵션…' 형태라 옵션값만 남겨 비교한다
          optionName: deriveOptionName(row.optionName, row.itemName),
          itemName: row.itemName,
        },
        idx,
      )
      if (hit?.vendor_item_id) {
        bump(hit.vendor_item_id, 'seller', row.qty)
        row.matchedVendorItemId = hit.vendor_item_id
        sellerMatched++
      } else {
        sellerUnmatched++
        // 판매량이 있는 건만 되돌려준다 (0 건은 확인할 필요가 없음)
        if (row.qty >= 1) unmatchedSellerRows.push(row)
      }
      continue
    }

    // 그 외 판매방식은 집계 대상 아님
  }

  return {
    aggMap,
    totalRows: rows.length,
    rocketMatched,
    rocketUnmatched,
    sellerMatched,
    sellerUnmatched,
    unmatchedSellerRows,
  }
}

// ── 미매칭 판매자배송 엑셀 다운로드 ────────────────────────────────

const UNMATCHED_HEADERS = [
  '옵션 ID', '옵션명', '상품명', '등록상품ID', '판매방식', '판매량',
]

/** 매칭 실패한 판매자배송 행을 엑셀로 내려받는다 */
export async function downloadUnmatchedSellerExcel(
  rows: PeriodSalesRow[],
): Promise<void> {
  const aoa = [
    UNMATCHED_HEADERS,
    ...rows.map((r) => [
      r.optionId, r.optionName, r.itemName, r.sellerProductId, r.channel, r.qty,
    ]),
  ]
  await downloadStyledWorkbook(
    [{ name: '미매칭 판매자배송', aoa, headerFill: true }],
    UNMATCHED_FILE_NAME,
  )
}

// ══════════════════════════════════════════════════════════════════
// DB 저장 / 조회 (si_rg_period_sales)
//   엑셀 원본 A~S 전체 + 매칭 결과를 그대로 보관한다.
//   업로드 = 해당 user_id 전체 삭제 → 재삽입 (saveRgItemData 와 동일 패턴)
// ══════════════════════════════════════════════════════════════════

const DB_CHUNK = 500

/** DB 행 → 엑셀 행 컬럼 매핑 */
const toDbRow = (r: PeriodSalesRow, userId: string) => ({
  user_id: userId,
  option_id: r.optionId || null,
  option_name: r.optionName || null,
  item_name: r.itemName || null,
  seller_product_id: r.sellerProductId || null,
  category: r.category || null,
  channel: r.channel || null,
  revenue: r.revenue,
  order_count: r.orderCount,
  sales_qty: r.qty,
  visitors: r.visitors,
  view_count: r.viewCount,
  cart_count: r.cartCount,
  conversion_rate: r.conversionRate || null,
  item_winner_rate: r.itemWinnerRate,
  total_revenue: r.totalRevenue,
  total_sales_qty: r.totalSalesQty,
  total_cancel_amount: r.totalCancelAmount,
  total_cancel_qty: r.totalCancelQty,
  instant_cancel_qty: r.instantCancelQty,
  matched_vendor_item_id: r.matchedVendorItemId ?? null,
})

/** 기간판매량 저장 — 기존 데이터 삭제 후 500건씩 삽입 */
export async function savePeriodSales(
  rows: PeriodSalesRow[],
  userId: string,
): Promise<{ success: number; errors: number }> {
  const { error: delError } = await supabase
    .from('si_rg_period_sales')
    .delete()
    .eq('user_id', userId)
  if (delError) {
    console.error('[periodSales] 기존 데이터 삭제 오류:', delError)
    throw delError
  }

  let success = 0
  let errors = 0
  for (let i = 0; i < rows.length; i += DB_CHUNK) {
    const chunk = rows.slice(i, i + DB_CHUNK).map((r) => toDbRow(r, userId))
    const { error } = await supabase.from('si_rg_period_sales').insert(chunk)
    if (error) {
      console.error(`[periodSales] insert 오류 (batch ${i / DB_CHUNK + 1}):`, error)
      errors += chunk.length
    } else {
      success += chunk.length
    }
  }
  return { success, errors }
}

/**
 * 저장된 기간판매량을 vendor_item_id 별 집계로 읽어온다 (화면 '기간' 열용).
 * PostgREST 기본 1000행 제한 → range 루프 (CLAUDE.md 룰 5)
 */
export async function fetchPeriodSalesAgg(
  userId: string,
): Promise<Map<string, PeriodSalesAgg>> {
  const map = new Map<string, PeriodSalesAgg>()
  if (!userId) return map

  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('si_rg_period_sales')
      .select('channel, sales_qty, matched_vendor_item_id')
      .eq('user_id', userId)
      .not('matched_vendor_item_id', 'is', null)
      .range(from, from + 999)
    if (error) {
      console.error('[periodSales] 조회 오류:', error)
      throw error
    }
    const rows = data ?? []
    for (const d of rows as any[]) {
      const vid = d.matched_vendor_item_id as string
      if (!vid) continue
      const e = map.get(vid) ?? { rocket: 0, seller: 0 }
      const qty = Number(d.sales_qty ?? 0) || 0
      if (d.channel === CHANNEL_ROCKET) e.rocket += qty
      else if (d.channel === CHANNEL_SELLER) e.seller += qty
      map.set(vid, e)
    }
    if (rows.length < 1000) break
    from += 1000
  }
  return map
}

// ── 파일 읽기 ─────────────────────────────────────────────────────

/** xlsx File → aoa (첫 시트) */
export async function readPeriodSalesFile(file: File): Promise<any[][]> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][]
}
