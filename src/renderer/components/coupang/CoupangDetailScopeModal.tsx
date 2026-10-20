/* ================================================================
   상품관리 — 상세 받기 범위 선택
   - 상세 미수신: 판매중 상품만 / 전체
   - 고시정보 받기: 상세는 받았지만 고시정보가 없는 상품 (고시정보 저장 2026-10-20 전에 받은 상품)
     — 같은 상세 API 를 다시 불러 고시정보 · 혼용률까지 저장한다
   ================================================================ */

import React, { useState } from 'react'
import type { DetailScopeCounts, DetailSyncScope } from '../../pages/useCoupangManagement'
import { num, estimateDuration } from './format'

interface Props {
  counts: DetailScopeCounts | null   // null = 세는 중
  onConfirm: (scope: DetailSyncScope) => void
  onClose: () => void
}

/** 범위별 대상 상품 수 */
function scopeCount(counts: DetailScopeCounts | null, scope: DetailSyncScope): number {
  if (!counts) return 0
  switch (scope) {
    case 'missingOnSale': return counts.missing.onSale.length
    case 'missingAll': return counts.missing.all.length
    case 'noticesOnSale': return counts.notices.onSale.length
    case 'noticesAll': return counts.notices.all.length
  }
}

const SCOPES: { key: DetailSyncScope; title: string; group: '상세 미수신' | '고시정보 받기' }[] = [
  { key: 'missingOnSale', title: '미수신 · 판매중 상품만', group: '상세 미수신' },
  { key: 'missingAll', title: '미수신 전체 (판매중지 포함)', group: '상세 미수신' },
  { key: 'noticesOnSale', title: '고시정보 없는 판매중 상품', group: '고시정보 받기' },
  { key: 'noticesAll', title: '고시정보 없는 상품 전체', group: '고시정보 받기' },
]

const CoupangDetailScopeModal: React.FC<Props> = ({ counts, onConfirm, onClose }) => {
  const [scope, setScope] = useState<DetailSyncScope>('missingOnSale')
  const chosen = scopeCount(counts, scope)

  return (
    <div className="cp-overlay" role="dialog" aria-modal="true" aria-labelledby="cp-scope-title">
      <div className="cp-modal">
        <div>
          <h2 id="cp-scope-title" className="cp-modal-title">상세 받기</h2>
          <div className="cp-modal-desc">상품 조회 API 로 옵션 · 가격 · 재고 · 이미지 · 업체상품코드 · 고시정보(혼용률)를 받습니다. 상품당 1회 호출, 초당 5회.</div>
        </div>

        <fieldset className="cp-scope-grid" style={{ margin: 0, padding: 0, border: 0 }}>
          <legend style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>받을 범위</legend>
          {SCOPES.map((s) => {
            const n = scopeCount(counts, s.key)
            return (
              <label key={s.key} className={`cp-scope${scope === s.key ? ' is-active' : ''}`}>
                <input type="radio" name="cp-scope" checked={scope === s.key} onChange={() => setScope(s.key)} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="cp-scope-meta">{s.group}</span>
                  <span className="cp-scope-title">{s.title}</span>
                  <span className="cp-scope-meta cp-num">{counts ? `${num(n)}개 · ${estimateDuration(n)}` : '세는 중…'}</span>
                </span>
              </label>
            )
          })}
        </fieldset>

        <div style={{ fontSize: 12, color: '#4B5563' }}>
          이미 받은 상품은 다시 받지 않습니다. 고시정보 받기는 고시정보 저장 기능(2026-10-20)이 생기기 전에 상세를 받은 상품을 한 번 더 받아
          고시정보 · 혼용률을 채웁니다. 특정 상품만 다시 받으려면 상세 패널의 [이 상품 다시 받기]를 쓰세요.
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
