/* ================================================================
   상품관리 — 옵션 칸 바로 수정 가능 여부 (즉시 반영 묶음: 판매가 · 기준가 · 재고 · 판매상태)
   - 쿠팡 옵션별 API 는 승인완료 후 발급된 옵션 ID 에만 쓸 수 있다
   - 로켓그로스 옵션: 쿠팡 문서에는 언급이 없어 운영에서 시험했다 (2026-10-20, hilili 하이브리드 상품의
     로켓 옵션 90361189025) — 판매가 · 기준가 · 판매 중지/재개 모두 성공 → RG_OPTION_DIRECT_EDIT 켬.
     재고는 로켓창고 수량이라 계속 막는다.
   ================================================================ */

import type { CoupangProductRow } from '../../types/coupangProduct'
import { rowChannel } from '../../types/coupangProduct'

export type InlineField = 'price' | 'originalPrice' | 'quantity' | 'status'

/** 로켓그로스 옵션의 판매가 · 기준가 · 판매상태 바로 수정 — 운영 시험 통과 (2026-10-20) */
export const RG_OPTION_DIRECT_EDIT = true

const APPROVED = '승인완료'

/** 이 칸을 바로 수정할 수 없으면 이유, 수정할 수 있으면 null */
export function inlineEditBlock(row: CoupangProductRow, field: InlineField): string | null {
  // 승인상태를 모르는 예전 행(null)은 막지 않는다 — 쿠팡이 거절하면 그 사유가 칸에 뜬다
  if (row.coupang_approval && row.coupang_approval !== APPROVED) {
    return `승인완료 상품만 바로 바꿀 수 있습니다 (지금: ${row.coupang_approval})`
  }
  if (rowChannel(row) === 'RG') {
    if (field === 'quantity') return '로켓그로스 재고는 로켓창고 수량이라 여기서 바꿀 수 없습니다'
    if (!RG_OPTION_DIRECT_EDIT) return '로켓그로스 옵션은 쿠팡 API 지원 여부를 확인하는 중이라 아직 바꿀 수 없습니다'
  }
  return null
}
