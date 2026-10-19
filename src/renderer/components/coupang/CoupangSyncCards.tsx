/* ================================================================
   상품관리 — 동기화 3단계 카드 (목록 · 상세 · 판매상태)
   ================================================================ */

import React from 'react'
import type { CoupangSyncSummary } from '../../types/coupangProduct'
import { num, shortDateTime } from './format'

interface Props {
  summary: CoupangSyncSummary | null
  busy: boolean
  onListSync: () => void
  onDetailSync: () => void
  onStatusCheck: () => void
}

const CoupangSyncCards: React.FC<Props> = ({ summary, busy, onListSync, onDetailSync, onStatusCheck }) => {
  const checked = summary ? summary.totalRows - summary.statusUnchecked : 0
  return (
    <section className="cp-sync-cards" aria-label="쿠팡 동기화">
      {/* ── 1 · 목록 ── */}
      <div className="cp-sync-card">
        <div className="cp-sync-card-body">
          <div className="cp-sync-card-step">1 · 목록 (상품 · 옵션 ID · 승인상태)</div>
          <div className="cp-sync-card-value cp-num">{summary ? `옵션 ${num(summary.totalRows)}개` : '—'}</div>
          <div className="cp-sync-card-meta">일반 + 로켓그로스 목록을 받아 새 상품은 상세까지 이어서 받습니다</div>
        </div>
        <div className="cp-sync-card-actions">
          <button type="button" className="cp-btn" disabled={busy} onClick={onListSync}>목록 받기</button>
        </div>
      </div>

      {/* ── 2 · 상세 ── */}
      <div className="cp-sync-card">
        <div className="cp-sync-card-body">
          <div className="cp-sync-card-step">2 · 상세 (옵션 · 가격 · 재고 · 이미지)</div>
          <div className="cp-sync-card-value cp-num">
            {summary ? (summary.detailMissing > 0 ? `옵션 ${num(summary.detailMissing)}개 미수신` : '모두 받음') : '—'}
          </div>
          <div className={`cp-sync-card-meta${summary?.detailMissing ? ' is-warn' : ''}`}>
            {summary?.lastDetailAt ? `마지막 ${shortDateTime(summary.lastDetailAt)} · ` : ''}상품당 1회 호출 (초당 5회)
          </div>
        </div>
        <div className="cp-sync-card-actions">
          <button type="button" className="cp-btn cp-btn-primary" disabled={busy} onClick={onDetailSync}>상세 받기</button>
        </div>
      </div>

      {/* ── 3 · 판매상태 ── */}
      <div className="cp-sync-card">
        <div className="cp-sync-card-body">
          <div className="cp-sync-card-step">3 · 판매상태 (판매중 · 재고 · 판매가)</div>
          <div className="cp-sync-card-value cp-num">{summary ? `옵션 ${num(checked)} / ${num(summary.totalRows)} 확인` : '—'}</div>
          <div className="cp-sync-card-meta">
            {summary?.lastStatusAt ? `마지막 ${shortDateTime(summary.lastStatusAt)} · ` : ''}옵션당 1회 호출 — 전체는 엑셀이 빠릅니다
          </div>
        </div>
        <div className="cp-sync-card-actions">
          <button type="button" className="cp-btn" disabled={busy} onClick={onStatusCheck}>오래된 순 500개 확인</button>
        </div>
      </div>
    </section>
  )
}

export default CoupangSyncCards
