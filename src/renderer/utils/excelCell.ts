/* ================================================================
   엑셀 셀 읽기 공용 규칙 (SheetJS raw 값 기준)
   - ID · 바코드 · 운송장처럼 "숫자로 보이지만 글자"인 칸을 읽는다
   - 쓰는 곳: services/deliveryInstructService.ts ([배송준비] 송장 엑셀)
              services/stockImportService.ts (재고관리 [엑셀 추가])
   ================================================================ */

// ── 상수 ──────────────────────────────────────────────────────────
/** 엑셀 숫자 셀이 정확히 담을 수 있는 최대 자릿수 (Excel 유효숫자 15자리) */
export const EXCEL_EXACT_DIGITS = 15

/** 숫자 셀 자릿수 손실 안내 */
export const EXCEL_NUMERIC_PRECISION_ERROR = '숫자 형식 셀의 자릿수가 손실되었습니다 — 텍스트 형식으로 저장해 주세요'

// ── ID 셀 → 문자열 ────────────────────────────────────────────────
/**
 * ID·바코드·운송장 셀 → 문자열.
 * 숫자 셀은 안전한 정수이고 Excel 이 정확히 담는 15자리 이내일 때만 받는다 —
 * 그 밖의 값은 이미 자릿수가 깎였을 수 있어 조용히 틀린 ID 로 쓰지 않도록 오류로 돌린다.
 * 빈 칸(null·undefined)은 빈 문자열, 글자는 앞뒤 공백을 뗀다.
 */
export function readExcelIdCell(v: unknown): { value: string; error: string | null } {
  if (v == null) return { value: '', error: null }
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v) || v < 0 || String(v).length > EXCEL_EXACT_DIGITS) {
      return { value: '', error: EXCEL_NUMERIC_PRECISION_ERROR }
    }
    return { value: String(v), error: null }
  }
  if (typeof v === 'string') return { value: v.trim(), error: null }
  return { value: '', error: `읽을 수 없는 셀 값입니다 (${typeof v})` }
}
