/* ================================================================
   사입관리 라벨 — si_rg_items 행 → 라벨 인쇄 항목
   - 사입관리 [라벨] 버튼이 쓴다. 인쇄 자체는 LabelPrintModal(→ labelPrintService)
   - 라벨 값은 상품관리 [라벨출력]과 같은 변환(labelService.toLabelPrintItems)으로 만든다
     → 같은 상품이면 어느 화면에서 찍어도 같은 라벨이 나온다
   - 출고코드(item_code) 등은 si_rg_items 에 없어서 si_coupang_items 에서 가져온다
       연결 키: si_rg_items.vendor_item_id = si_coupang_items.option_id (같은 쿠팡 옵션 ID)
       상품관리에 없는 행은 사입관리 값(바코드·상품명·옵션명·판매가)만으로 채운다
   - 선택한 행의 옵션 ID 만 조회한다 (si_coupang_items 는 계정당 수만 건 — 전체 조회 안 함)
       · ID 를 OPTION_ID_CHUNK 개씩 나눠 in() 조회 (URL 길이 제한)
       · 각 묶음도 1000-row 페이지네이션 루프 (CLAUDE.md 룰 5)
   ================================================================ */

import { supabase } from './supabase'
import { toLabelPrintItems, type LabelSourceItem } from './labelService'
import type { LabelPrintItem } from './labelPrintService'
import type { RgItem } from '../types/purchase'

// ── 상수 ──────────────────────────────────────────────────────────
const PAGE_SIZE = 1000
/** in() 한 번에 넣는 옵션 ID 수 — ID 는 10~11자리, 100개면 URL 약 1.3KB */
const OPTION_ID_CHUNK = 100

/** toLabelPrintItems 가 읽는 si_coupang_items 컬럼 (LabelSourceItem 과 같게) */
const COUPANG_LABEL_COLUMNS =
  'option_id, barcode, item_name, option_name, product_name, item_code, item_id, product_id, price, regular_price, stock, season, note, package_type'

// ══════════════════════════════════════════════════════════════════
// 타입 정의
// ══════════════════════════════════════════════════════════════════

type CoupangLabelRow = LabelSourceItem & { option_id: string }

export interface PurchaseLabelItems {
  /** 인쇄 항목 — 사입관리 행 순서 그대로, 1장씩 (장수는 모달에서 고친다) */
  items: LabelPrintItem[]
  /** 바코드가 없어 뺀 행 수 */
  skipped: number
  /** 출고코드(item_code)가 비어 있는 항목 수 — 상품관리에 없거나 코드가 비어 있음 */
  missingCode: number
}

/**
 * 쿠팡 옵션 ID 로 쓸 수 있는 값 — 숫자만 (아니면 '')
 * si_rg_items.vendor_item_id 에 문자열 'null' 이 저장된 행이 있다. 그대로 조회 키로 쓰면
 * 같은 문자열을 가진 행과 잘못 연결될 수 있어 막는다 (si_coupang_items.option_id 는 전부 숫자).
 */
function validOptionId(value: string | null | undefined): string {
  const v = (value ?? '').trim()
  return /^[0-9]+$/.test(v) ? v : ''
}

// ══════════════════════════════════════════════════════════════════
// 조회 — 옵션 ID 목록의 si_coupang_items 라벨 컬럼
// ══════════════════════════════════════════════════════════════════

async function fetchCoupangLabelRows(
  userId: string,
  optionIds: string[],
): Promise<Map<string, CoupangLabelRow>> {
  const byOptionId = new Map<string, CoupangLabelRow>()
  for (let i = 0; i < optionIds.length; i += OPTION_ID_CHUNK) {
    const chunk = optionIds.slice(i, i + OPTION_ID_CHUNK)
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('si_coupang_items')
        .select(COUPANG_LABEL_COLUMNS)
        .eq('user_id', userId)
        .in('option_id', chunk)
        .range(from, from + PAGE_SIZE - 1)
      if (error) {
        console.error('[fetchCoupangLabelRows]', error)
        throw error
      }
      const rows = (data ?? []) as CoupangLabelRow[]
      for (const row of rows) byOptionId.set(String(row.option_id), row)
      if (rows.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }
  }
  return byOptionId
}

// ══════════════════════════════════════════════════════════════════
// 변환 — 사입관리 행 → 라벨 원천 값 → 인쇄 항목
// ══════════════════════════════════════════════════════════════════

/** 사입관리 행 하나의 라벨 원천 값 — 상품관리 값 우선, 바코드는 사입관리 화면에 보이는 값 우선 */
function toSourceItem(rg: RgItem, cp: CoupangLabelRow | undefined): LabelSourceItem {
  const rgBarcode = (rg.barcode ?? '').trim()
  if (cp) return { ...cp, barcode: rgBarcode || cp.barcode }
  return {
    barcode: rgBarcode,
    item_name: rg.seller_product_name,
    option_name: rg.option_name,
    option_id: validOptionId(rg.vendor_item_id),
    price: rg.sale_price,
  }
}

/** 체크한 사입관리 행 → 인쇄 항목 (행 순서 유지) */
export async function buildPurchaseLabelItems(rows: RgItem[], userId: string): Promise<PurchaseLabelItems> {
  if (!userId) throw new Error('로그인 정보가 없습니다. 다시 로그인해주세요.')

  const optionIds = Array.from(new Set(rows.map((r) => validOptionId(r.vendor_item_id)).filter(Boolean)))
  const coupangRows = optionIds.length > 0 ? await fetchCoupangLabelRows(userId, optionIds) : new Map()

  const sources = rows.map((rg) => {
    const optionId = validOptionId(rg.vendor_item_id)
    return toSourceItem(rg, optionId ? coupangRows.get(optionId) : undefined)
  })
  // 바코드 없는 행 제외 규칙은 상품관리와 같다 (toLabelPrintItems)
  const { items, skipped } = toLabelPrintItems(sources)
  const missingCode = items.filter((it) => !String(it.data.item_code ?? '').trim()).length
  return { items, skipped, missingCode }
}
