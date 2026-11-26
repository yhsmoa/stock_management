/* ================================================================
   상품의 라벨 정보 (상세 패널 [라벨] 탭) — 조회 · 저장 (2026-11-26)
   - 라벨은 바코드 단위로 찍는다 → 상품의 바코드 있는 옵션을 바코드로 묶어 한 줄씩 보여 준다
   - 읽는 값: 쿠팡 쪽(si_coupang_items — 옵션명 · 고시 분류 · 쿠팡 혼용률)
              + 직접 입력(si_item_info — 혼용률 · 권장연령, 바코드 기준)
   - 저장: si_item_info 만 (쿠팡 값은 [상세 받기] 가 채운다). 판정 · 출력 조건은 labelInfoRules.ts
   ================================================================ */

import { supabase } from './supabase'
import { fetchItemInfosByBarcodes, upsertItemInfos, type ItemInfoUpsert } from './itemInfoService'

// ── 상수 ──────────────────────────────────────────────────────────
const PAGE_ROWS = 1000
/** 고시정보는 첫 항목의 분류만 읽는다 (JSON 전체를 받지 않는다) */
const LABEL_ROW_COLUMNS = 'option_id, option_name, barcode, composition, notice_category:notices->0->>category'

interface CoupangLabelInfoRow {
  option_id: string
  option_name: string | null
  barcode: string | null
  composition: string | null
  notice_category: string | null
}

/** [라벨] 탭의 한 줄 — 바코드 1개 */
export interface ProductLabelRow {
  barcode: string
  /** 이 바코드를 쓰는 옵션 이름 (보통 1개) */
  optionNames: string[]
  /** 쿠팡 고시정보 분류 (받은 적 없으면 null) */
  noticeCategory: string | null
  /** 쿠팡 고시정보 혼용률 */
  coupangComposition: string | null
  /** si_item_info 행 id (없으면 null — 저장하면 새로 만든다) */
  infoId: string | null
  /** 직접 입력 혼용률 */
  manualComposition: string
  /** 권장연령 */
  recommendedAge: string
}

/** 저장할 한 줄 (바뀐 줄만 보낸다) */
export interface ProductLabelEdit {
  barcode: string
  infoId: string | null
  manualComposition: string
  recommendedAge: string
}

// ══════════════════════════════════════════════════════════════════
// 조회
// ══════════════════════════════════════════════════════════════════

/** 상품의 바코드 있는 옵션 전부 (목록 필터와 무관) → 바코드별 라벨 정보. 옵션 ID 순 */
export async function fetchProductLabelRows(userId: string, itemId: string): Promise<ProductLabelRow[]> {
  const options: CoupangLabelInfoRow[] = []
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await supabase
      .from('si_coupang_items')
      .select(LABEL_ROW_COLUMNS)
      .eq('user_id', userId)
      .eq('item_id', itemId)
      .not('barcode', 'is', null)
      .order('option_id')
      .range(from, from + PAGE_ROWS - 1)
    if (error) {
      console.error('[fetchProductLabelRows]', error)
      throw error
    }
    options.push(...((data ?? []) as unknown as CoupangLabelInfoRow[]))
    if (!data || data.length < PAGE_ROWS) break
  }

  const byBarcode = new Map<string, ProductLabelRow>()
  for (const o of options) {
    const barcode = (o.barcode ?? '').trim()
    if (!barcode) continue
    const row = byBarcode.get(barcode)
    if (row) {
      if (o.option_name && !row.optionNames.includes(o.option_name)) row.optionNames.push(o.option_name)
      if (!row.noticeCategory && o.notice_category) row.noticeCategory = o.notice_category
      if (!row.coupangComposition && o.composition) row.coupangComposition = o.composition
      continue
    }
    byBarcode.set(barcode, {
      barcode,
      optionNames: o.option_name ? [o.option_name] : [],
      noticeCategory: o.notice_category,
      coupangComposition: o.composition,
      infoId: null,
      manualComposition: '',
      recommendedAge: '',
    })
  }

  const infos = await fetchItemInfosByBarcodes(userId, [...byBarcode.keys()])
  for (const [barcode, info] of infos) {
    const row = byBarcode.get(barcode.trim())
    if (!row) continue
    row.infoId = info.id
    row.manualComposition = (info.composition ?? '').trim()
    row.recommendedAge = (info.recommended_age ?? '').trim()
  }
  return [...byBarcode.values()]
}

// ══════════════════════════════════════════════════════════════════
// 저장 — si_item_info (빈 값은 null). 기존 행은 id, 새 행은 (user_id, barcode) 기준
// ══════════════════════════════════════════════════════════════════

export async function saveProductLabelInfo(userId: string, edits: ProductLabelEdit[]): Promise<void> {
  if (!userId) throw new Error('로그인 정보가 없습니다. 다시 로그인해 주세요.')
  const rows: ItemInfoUpsert[] = edits.map((e) => ({
    ...(e.infoId ? { id: e.infoId } : {}),
    user_id: userId,
    barcode: e.barcode,
    composition: e.manualComposition.trim() || null,
    recommended_age: e.recommendedAge.trim() || null,
  }))
  await upsertItemInfos(rows)
}
