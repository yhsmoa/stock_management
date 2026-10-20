/* ================================================================
   상품관리 — 쿠팡 가격 변경 규칙 (옵션별 가격 · 할인율 기준가 API)
   - 선택 작업 모달(CoupangChangeModal)과 목록 칸 편집(CoupangInlineCell)이 같은 규칙을 쓴다
   - 출처: 쿠팡 "상품 아이템별 가격 변경" 문서 — 10원 단위, 기본 한도 최대 50% 인하 · 100% 인상,
     forceSalePriceUpdate=true 면 한도 없이
   ================================================================ */

export const PRICE_UNIT = 10          // 10원 단위 (1원 단위 불가)
export const PRICE_DOWN_LIMIT = 0.5   // 변경 전 가격 대비 50% 까지 인하
export const PRICE_UP_LIMIT = 1.0     // 변경 전 가격 대비 100% 까지 인상

/** 판매가 변경이 쿠팡 기본 한도를 넘는지 — 넘으면 '강제 적용'(forceSalePriceUpdate) 이 있어야 간다 */
export function priceLimitViolation(before: number | null | undefined, after: number): 'down' | 'up' | null {
  if (before == null || before <= 0) return null
  if (after < before * (1 - PRICE_DOWN_LIMIT)) return 'down'
  if (after > before * (1 + PRICE_UP_LIMIT)) return 'up'
  return null
}

/** 가격 입력 검증 — 문제가 있으면 사유 문구, 없으면 null */
export function priceInputProblem(value: number, opts: { allowZero: boolean }): string | null {
  if (!Number.isInteger(value) || value < 0) return '0 이상의 정수로 입력하세요.'
  if (!opts.allowZero && value === 0) return '0원은 입력할 수 없습니다.'
  if (value % PRICE_UNIT !== 0) return `${PRICE_UNIT}원 단위로 입력하세요.`
  return null
}
