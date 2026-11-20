// ═══════════════════════════════════════════════════════════════════
// 재고입력 서비스 (/stock-input — 물류 › 재고관리 › 재고입력)
//   위치를 정하고 바코드를 스캔해 목록을 만든 뒤 [재고 추가] 로 si_stocks 에 더한다.
//   - 바코드 확인: 이 계정의 로켓그로스 옵션(si_rg_items.barcode)
//   - 목록 규칙(addScan · removeScan)은 순수 함수
//   - 저장은 [엑셀 추가] › 추가와 같은 경로를 쓴다
//       StockService.loadStockImportContext → planStockImport('add') → applyStockImport
//     그래서 규칙이 같다: 같은 (위치 + 바코드) 재고가 있으면 수량만 더하고,
//     없으면 새 행 (이름: ① 상품관리 si_coupang_items ② 다른 위치의 기존 재고 ③ 스캔한 로켓그로스 이름)
// ═══════════════════════════════════════════════════════════════════

import { supabase } from './supabase'
import { StockService } from './stockService'
import { planStockImport, stockKeyOf, type StockImportRow } from './stockImportService'

// ── 상수 ──────────────────────────────────────────────────────────
const PAGE_SIZE = 1000   // PostgREST 기본 반환 상한 — 조회 루프 단위

// ══════════════════════════════════════════════════════════════════
// 타입
// ══════════════════════════════════════════════════════════════════

/** 바코드로 찾은 로켓그로스 옵션 이름 */
export interface RgBarcodeProduct {
  item_name: string | null
  option_name: string | null
}

/** 바코드 → 로켓그로스 옵션 */
export type RgBarcodeIndex = ReadonlyMap<string, RgBarcodeProduct>

/** 스캔 목록의 한 줄 — (위치 + 바코드) 마다 하나 */
export interface StockInputRow {
  key: string            // stockKeyOf(location, barcode)
  location: string
  barcode: string
  item_name: string | null
  option_name: string | null
  qty: number
}

/** [재고 추가] 결과 */
export type StockInputSaveResult =
  | { kind: 'blocked'; reasons: string[] }                                    // 검사에서 걸림 — 아무것도 쓰지 않음
  | { kind: 'saved'; created: number; updated: number; failedKeys: string[] } // failedKeys 가 비면 전부 저장

// ══════════════════════════════════════════════════════════════════
// 조회: 로켓그로스 바코드 색인
// ══════════════════════════════════════════════════════════════════

/**
 * 이 계정의 로켓그로스 옵션 바코드 전체 (계정당 1천 ~ 1.7만 행 — 1000건 루프, id 순서 고정)
 * - 같은 바코드가 여러 옵션에 있으면 id 가 앞선 행의 이름을 쓴다 (늘 같은 결과)
 * - 실패하면 throw — 일부만 받은 색인으로 스캔하면 있는 바코드를 '없음'으로 거절한다
 */
export async function fetchRgBarcodeIndex(userId: string): Promise<Map<string, RgBarcodeProduct>> {
  const index = new Map<string, RgBarcodeProduct>()
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('si_rg_items')
      .select('id, barcode, seller_product_name, option_name')
      .eq('user_id', userId)
      .not('barcode', 'is', null)
      .neq('barcode', '')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const rows = (data ?? []) as { barcode: string | null; seller_product_name: string | null; option_name: string | null }[]
    for (const row of rows) {
      const barcode = (row.barcode ?? '').trim()
      if (!barcode || index.has(barcode)) continue
      index.set(barcode, { item_name: row.seller_product_name, option_name: row.option_name })
    }
    if (rows.length < PAGE_SIZE) break
  }
  return index
}

// ══════════════════════════════════════════════════════════════════
// 순수 함수: 스캔 목록
// ══════════════════════════════════════════════════════════════════

/**
 * 스캔 1회를 목록에 반영한다 — 최신이 맨 위
 * - 같은 (위치 + 바코드) 줄이 있으면 수량 +1 하고 맨 위로 올린다
 * - 없으면 수량 1 인 새 줄을 맨 위에 넣는다
 * location · barcode 는 앞뒤 공백을 뗀 값이어야 한다 (호출하는 쪽이 검사)
 */
export function addScan(
  rows: readonly StockInputRow[],
  location: string,
  barcode: string,
  product: RgBarcodeProduct,
): StockInputRow[] {
  const key = stockKeyOf(location, barcode)
  const found = rows.find(r => r.key === key)
  const top: StockInputRow = found
    ? { ...found, qty: found.qty + 1 }
    : { key, location, barcode, item_name: product.item_name, option_name: product.option_name, qty: 1 }
  return [top, ...rows.filter(r => r.key !== key)]
}

/** 목록에서 한 줄을 뺀다 (잘못 스캔한 줄) */
export const removeScan = (rows: readonly StockInputRow[], key: string): StockInputRow[] =>
  rows.filter(r => r.key !== key)

/** 목록의 수량 합 */
export const sumScanQty = (rows: readonly StockInputRow[]): number =>
  rows.reduce((sum, r) => sum + r.qty, 0)

// ══════════════════════════════════════════════════════════════════
// 저장: [재고 추가]
// ══════════════════════════════════════════════════════════════════

/**
 * 스캔 목록을 재고에 더한다
 * - 실행 직전에 재고 전체를 새로 읽어 계획을 만든다 (조회 실패 시 throw — 아무것도 쓰지 않음)
 * - 계획 검사에서 걸리면(수량 한도 초과 등) 아무것도 쓰지 않고 'blocked'
 * - 쓰기는 원자적이지 않다: 실패한 줄의 키를 failedKeys 로 돌려주고, 나머지는 저장돼 있다
 */
export async function saveStockInput(
  userId: string,
  rows: readonly StockInputRow[],
): Promise<StockInputSaveResult> {
  // rowNumber 는 화면 목록의 줄 번호(1부터) — 계획의 오류 문구에 쓰인다
  const importRows: StockImportRow[] = rows.map((r, i) => ({
    rowNumber: i + 1,
    location: r.location,
    barcode: r.barcode,
    qty: r.qty,
    item_name: r.item_name,
    option_name: r.option_name,
  }))

  const context = await StockService.loadStockImportContext(userId, importRows, 'add')
  const plan = planStockImport(
    { rows: importRows, errors: [], zeroQtyRows: [], blankRowCount: 0 },
    'add',
    context,
  )
  if (plan.errors.length > 0) {
    return { kind: 'blocked', reasons: plan.errors.map(e => `${e.value} — ${e.reason}`) }
  }

  const applied = await StockService.applyStockImport(userId, plan.ops)
  return { kind: 'saved', created: applied.created, updated: applied.updated, failedKeys: applied.failedKeys }
}
