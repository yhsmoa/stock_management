/* ================================================================
   상품관리 — 동기화 · 변경 진행 모달 (진행률 · 결과 · 실패 목록 · 중단)
   ================================================================ */

import React from 'react'
import type { SyncProgress } from '../../types/coupangProduct'
import { num } from './format'

interface Props {
  progress: SyncProgress
  onAbort: () => void
  onClose: () => void
}

const CoupangSyncModal: React.FC<Props> = ({ progress, onAbort, onClose }) => {
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : (progress.running ? 0 : 100)
  const unit = progress.kind === 'detail' || progress.kind === 'list' ? '상품' : progress.kind === 'excel' ? '행' : '옵션'
  return (
    <div className="cp-overlay" role="dialog" aria-modal="true" aria-labelledby="cp-sync-title">
      <div className="cp-modal">
        <div>
          <h2 id="cp-sync-title" className="cp-modal-title">{progress.title}</h2>
          <div className="cp-modal-desc">쿠팡 Open API · 판매자당 초당 5회 제한에 맞춰 순서대로 처리합니다.</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="cp-progress-head cp-num">
            <div>
              {progress.total > 0
                ? <><span className="cp-progress-big">{num(progress.done)}</span> <span style={{ color: '#4B5563' }}>/ {num(progress.total)} {unit}</span></>
                : <span className="cp-progress-big">{progress.running ? '…' : '완료'}</span>}
            </div>
            {progress.running && progress.total > 0 && (
              <div style={{ color: '#4B5563' }}>남은 시간 약 {Math.max(1, Math.ceil((progress.total - progress.done) / 5 / 60))}분</div>
            )}
          </div>
          <div className="cp-progress-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className={`cp-progress-fill${!progress.running ? ' is-done' : ''}`} style={{ width: `${percent}%` }} />
          </div>
          <div className="cp-progress-msg">{progress.message}</div>
        </div>

        {progress.result && <div className="cp-result-box">{progress.result}</div>}

        {progress.errors.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="cp-section-label">실패 {num(progress.errors.length)}건</div>
            <ul className="cp-error-list">
              {progress.errors.slice(0, 200).map((e, i) => <li key={i}>{e}</li>)}
              {progress.errors.length > 200 && <li>… 외 {num(progress.errors.length - 200)}건</li>}
            </ul>
          </div>
        )}

        <div className="cp-modal-foot">
          <div style={{ fontSize: 12, color: '#4B5563' }}>
            {!progress.running
              ? '닫으면 목록을 다시 불러옵니다.'
              // 목록 받기의 첫 단계(쿠팡 목록 전체를 받는 중)는 total 이 0 — 아직 저장 전이다
              : progress.kind === 'list' && progress.total === 0
                ? '중단하면 바로 멈춥니다. 쿠팡 목록을 받는 중이라 아직 저장한 것은 없습니다.'
                : '중단해도 지금까지 저장한 것은 남습니다.'}
          </div>
          <div className="cp-modal-actions">
            {progress.running
              ? <button type="button" className="cp-btn" onClick={onAbort}>중단</button>
              : <button type="button" className="cp-btn cp-btn-primary" onClick={onClose}>닫기</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

export default CoupangSyncModal
