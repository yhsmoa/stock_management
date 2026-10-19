/* ================================================================
   상품관리 — 선택 작업 막대 (옵션을 체크하면 나타난다)
   ================================================================ */

import React from 'react'
import type { ChangeKind } from '../../services/coupangProductService'
import { num } from './format'

interface Props {
  count: number
  busy: boolean
  onChange: (kind: ChangeKind) => void
  onStatusCheck: () => void
  onClassify: () => void
  onLabel: () => void
  onClear: () => void
}

const CoupangSelectionBar: React.FC<Props> = ({ count, busy, onChange, onStatusCheck, onClassify, onLabel, onClear }) => (
  <div className="cp-selection-bar" role="region" aria-label="선택 작업">
    <div className="cp-selection-count">옵션 <span className="cp-num">{num(count)}</span>개 선택</div>
    <button type="button" className="cp-btn cp-btn-sm cp-btn-primary" disabled={busy} onClick={() => onChange('price')}>판매가 변경</button>
    <button type="button" className="cp-btn cp-btn-sm" disabled={busy} onClick={() => onChange('quantity')}>재고 변경</button>
    <button type="button" className="cp-btn cp-btn-sm" disabled={busy} onClick={() => onChange('originalPrice')}>할인율 기준가</button>
    <button type="button" className="cp-btn cp-btn-sm" disabled={busy} onClick={() => onChange('resume')}>판매 재개</button>
    <button type="button" className="cp-btn cp-btn-sm" disabled={busy} onClick={() => onChange('stop')}>판매 중지</button>
    <button type="button" className="cp-btn cp-btn-sm" disabled={busy} onClick={onStatusCheck}>판매상태 확인</button>
    <button type="button" className="cp-btn cp-btn-sm" onClick={onClassify}>분류 · 비고</button>
    <button type="button" className="cp-btn cp-btn-sm" onClick={onLabel}>라벨출력</button>
    <button type="button" className="cp-btn cp-btn-sm cp-btn-link" onClick={onClear}>선택 해제</button>
  </div>
)

export default CoupangSelectionBar
