/* ================================================================
   상품관리 — 분류 엑셀 업로드 결과 모달
   - 정상처리 건수 · 바코드 미조회 목록 · 허용되지 않은 분류값 목록
   ================================================================ */

import React from 'react'
import type { ClassifyExcelResult } from '../../services/coupangProductService'
import { num } from './format'

interface Props {
  result: ClassifyExcelResult
  onClose: () => void
}

const CoupangExcelResultModal: React.FC<Props> = ({ result, onClose }) => (
  <div className="cp-overlay" role="dialog" aria-modal="true" aria-labelledby="cp-excel-result-title">
    <div className="cp-modal" style={{ width: 480 }}>
      <h2 id="cp-excel-result-title" className="cp-modal-title">분류 엑셀 업로드 결과</h2>
      <div className="cp-result-box">정상처리 <strong className="cp-num">{num(result.successCount)}</strong>건</div>

      {result.notFoundBarcodes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="cp-section-label">바코드가 조회되지 않음 · {num(result.notFoundBarcodes.length)}건</div>
          <ul className="cp-error-list">
            {result.notFoundBarcodes.map((b, i) => <li key={i} className="cp-mono">{b}</li>)}
          </ul>
        </div>
      )}

      {result.invalidTypeBarcodes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="cp-section-label">허용되지 않은 분류값 · {num(result.invalidTypeBarcodes.length)}건</div>
          <ul className="cp-error-list">
            {result.invalidTypeBarcodes.map(({ barcode, inputType }, i) => (
              <li key={i}><span className="cp-mono">{barcode}</span> — <span style={{ color: '#B91C1C' }}>{inputType}</span></li>
            ))}
          </ul>
        </div>
      )}

      <div className="cp-modal-actions">
        <button type="button" className="cp-btn cp-btn-primary" onClick={onClose}>확인</button>
      </div>
    </div>
  </div>
)

export default CoupangExcelResultModal
