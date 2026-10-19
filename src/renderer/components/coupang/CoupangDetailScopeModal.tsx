/* ================================================================
   상품관리 — 상세 받기 범위 선택 (미수신 · 판매중 상품만 / 미수신 전체)
   ================================================================ */

import React, { useState } from 'react'
import type { DetailMissingIds } from '../../services/coupangProductService'
import type { DetailSyncScope } from '../../pages/useCoupangManagement'
import { num, estimateDuration } from './format'

interface Props {
  counts: DetailMissingIds | null   // null = 세는 중
  onConfirm: (scope: DetailSyncScope) => void
  onClose: () => void
}

const CoupangDetailScopeModal: React.FC<Props> = ({ counts, onConfirm, onClose }) => {
  const [scope, setScope] = useState<DetailSyncScope>('missingOnSale')
  const onSale = counts?.onSale.length ?? 0
  const all = counts?.all.length ?? 0
  const chosen = scope === 'missingOnSale' ? onSale : all

  return (
    <div className="cp-overlay" role="dialog" aria-modal="true" aria-labelledby="cp-scope-title">
      <div className="cp-modal">
        <div>
          <h2 id="cp-scope-title" className="cp-modal-title">상세 받기</h2>
          <div className="cp-modal-desc">상품 조회 API 로 옵션 · 가격 · 재고 · 이미지 · 업체상품코드를 받습니다. 상품당 1회 호출, 초당 5회.</div>
        </div>

        <fieldset className="cp-scope-grid" style={{ margin: 0, padding: 0, border: 0 }}>
          <legend style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>받을 범위</legend>
          <label className={`cp-scope${scope === 'missingOnSale' ? ' is-active' : ''}`}>
            <input type="radio" name="cp-scope" checked={scope === 'missingOnSale'} onChange={() => setScope('missingOnSale')} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="cp-scope-title">미수신 · 판매중 상품만</span>
              <span className="cp-scope-meta cp-num">{counts ? `${num(onSale)}개 · ${estimateDuration(onSale)}` : '세는 중…'}</span>
            </span>
          </label>
          <label className={`cp-scope${scope === 'missingAll' ? ' is-active' : ''}`}>
            <input type="radio" name="cp-scope" checked={scope === 'missingAll'} onChange={() => setScope('missingAll')} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="cp-scope-title">미수신 전체 (판매중지 포함)</span>
              <span className="cp-scope-meta cp-num">{counts ? `${num(all)}개 · ${estimateDuration(all)}` : '세는 중…'}</span>
            </span>
          </label>
        </fieldset>

        <div style={{ fontSize: 12, color: '#4B5563' }}>
          이미 받은 상품은 다시 받지 않습니다. 특정 상품만 다시 받으려면 목록의 [이 상품만 받기] 또는 상세 패널의 [이 상품 다시 받기]를 쓰세요.
          중단해도 받은 상품은 저장되고, 다시 누르면 남은 상품부터 이어서 받습니다.
        </div>

        <div className="cp-modal-actions">
          <button type="button" className="cp-btn" onClick={onClose}>취소</button>
          <button type="button" className="cp-btn cp-btn-primary" disabled={!counts || chosen === 0} onClick={() => onConfirm(scope)}>
            {counts ? `받기 (${num(chosen)}개)` : '세는 중…'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CoupangDetailScopeModal
