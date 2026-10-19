/* ================================================================
   상품관리 — 분류 · 비고 일괄 변경 모달 (선택 옵션)
   - 비고는 입력했을 때만 바꾸고, 비워 두면 기존 비고를 유지한다
   ================================================================ */

import React, { useState } from 'react'
import { PACKAGE_TYPE_OPTIONS } from '../../types/coupangProduct'
import { num } from './format'

interface Props {
  count: number
  onSubmit: (packageType: string, note: string) => void
  onClose: () => void
}

const CoupangClassifyModal: React.FC<Props> = ({ count, onSubmit, onClose }) => {
  const [packageType, setPackageType] = useState<string>(PACKAGE_TYPE_OPTIONS[0])
  const [note, setNote] = useState('')
  return (
    <div className="cp-overlay" role="dialog" aria-modal="true" aria-labelledby="cp-classify-title">
      <div className="cp-modal" style={{ width: 440 }}>
        <div>
          <h2 id="cp-classify-title" className="cp-modal-title">분류 · 비고 일괄 변경</h2>
          <div className="cp-modal-desc cp-num">옵션 {num(count)}개</div>
        </div>
        <div className="cp-field">
          <label htmlFor="cp-classify-type">분류</label>
          <select id="cp-classify-type" className="cp-input" style={{ width: 180 }} value={packageType} onChange={(e) => setPackageType(e.target.value)}>
            {PACKAGE_TYPE_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
        <div className="cp-field">
          <label htmlFor="cp-classify-note">비고 <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(비워 두면 기존 비고 유지)</span></label>
          <textarea id="cp-classify-note" className="cp-textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="비고" />
        </div>
        <div className="cp-modal-actions">
          <button type="button" className="cp-btn" onClick={onClose}>취소</button>
          <button type="button" className="cp-btn cp-btn-primary" onClick={() => onSubmit(packageType, note)}>저장</button>
        </div>
      </div>
    </div>
  )
}

export default CoupangClassifyModal
