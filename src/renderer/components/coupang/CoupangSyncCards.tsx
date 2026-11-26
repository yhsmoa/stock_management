/* ================================================================
   상품관리 — 동기화 3단계 카드 (목록 · 상세 · 판매상태)
   - 카드 한 장 = 한 줄 (2026-11-26 — 아래 목록을 넓게 쓰려고 높이를 줄였다)
       단계 · 현재 값 · 상태 문구(넘치면 '…') · 버튼
   - 상태 문구 = (상세 카드만) 받은 비율 + 마지막 실행 (si_coupang_sync_runs).
     줄인 내용(단계가 받는 값 · 끊겼을 때 이어 받는 방법 · 옵션 수)은 마우스를 올리면 보인다
   - 진행 중이면 카드 아래 가장자리에 진행 막대
   - 다른 창 · 화면에서 진행 중이면 버튼을 잠근다 (locked)
   ================================================================ */

import React from 'react'
import type { CoupangSyncSummary } from '../../types/coupangProduct'
import { runViewStatus, type SyncRun, type SyncRunKind } from '../../services/coupangSyncRunService'
import { num, shortDateTime } from './format'

interface Props {
  summary: CoupangSyncSummary | null
  latestRuns: Partial<Record<SyncRunKind, SyncRun>>
  /** 이 화면에서 진행 중 (버튼 잠금) */
  busy: boolean
  /** 다른 곳에서 진행 중인 것까지 포함한 잠금 */
  locked: boolean
  onListSync: () => void
  onDetailSync: () => void
  onStatusCheck: () => void
}

/** 끊긴 실행을 다시 누르면 어떻게 이어지는지 */
const RESUME_HINT: Record<SyncRunKind, string> = {
  list: '다시 누르면 목록을 처음부터 다시 받고(1~2분), 바뀐 행만 저장합니다. 끊긴 새 상품 상세는 [상세 받기] › 미수신으로 이어집니다.',
  detail: '받은 상품은 저장돼 있습니다. [상세 받기] 를 다시 누르면 남은 상품만 받습니다.',
  status: '확인한 옵션은 저장돼 있습니다. 다시 누르면 오래된 순으로 이어서 확인합니다.',
}

/** 내림 — 하나라도 남았으면 100% 로 보이지 않게 (87,884 / 87,886 = 99%) */
function percent(done: number, total: number): number {
  return total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0
}

// ══════════════════════════════════════════════════════════════════
// 마지막 실행 → 한 줄 문구
// ══════════════════════════════════════════════════════════════════

interface RunLineView {
  /** 카드에 보이는 짧은 문구 */
  text: string
  /** 마우스를 올렸을 때 보이는 전체 문구 */
  full: string
  tone: '' | 'is-running' | 'is-warn'
}

function runLineView(run: SyncRun | undefined, kind: SyncRunKind): RunLineView {
  if (!run) return { text: '실행 기록 없음', full: '아직 실행 기록이 없습니다', tone: '' }
  const progress = run.total > 0 ? `${num(run.done)} / ${num(run.total)} (${percent(run.done, run.total)}%)` : ''
  const when = shortDateTime(run.finished_at ?? run.updated_at)
  const at = progress ? ` · ${progress} 에서` : ''
  switch (runViewStatus(run)) {
    case 'running': {
      const text = `진행 중${progress && ` · ${progress}`}`
      return { text, full: `${text} — ${run.title ?? ''}`, tone: 'is-running' }
    }
    case 'interrupted': {
      const text = `${when}${at} 끊김`
      return { text, full: `${text} (창을 닫았거나 연결이 끊김). ${RESUME_HINT[kind]}`, tone: 'is-warn' }
    }
    case 'aborted': {
      const text = `${when}${at} 중단함`
      return { text, full: `${text}. ${RESUME_HINT[kind]}`, tone: 'is-warn' }
    }
    case 'failed': {
      const text = `${when} 실패 — ${run.message ?? ''}`
      return { text, full: text, tone: 'is-warn' }
    }
    case 'done': {
      const text = `${when} 완료`
      return { text, full: `마지막 ${text}${run.message ? ` · ${run.message}` : ''}`, tone: '' }
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// 카드 틀
// ══════════════════════════════════════════════════════════════════

interface CardProps {
  step: string
  /** 단계 설명 (마우스를 올리면) */
  stepHint: string
  value: string
  valueWarn?: boolean
  /** 상태 문구 앞에 붙는 값 (상세 카드의 받은 비율) */
  lead?: { text: string; full: string }
  run: SyncRun | undefined
  kind: SyncRunKind
  action: React.ReactNode
}

function SyncCard({ step, stepHint, value, valueWarn, lead, run, kind, action }: CardProps) {
  const view = runLineView(run, kind)
  const running = view.tone === 'is-running' && !!run && run.total > 0
  const p = running ? percent(run.done, run.total) : 0
  return (
    <div className="cp-sync-card">
      <span className="cp-sync-card-step" title={stepHint}>{step}</span>
      <span className={`cp-sync-card-value cp-num${valueWarn ? ' is-warn' : ''}`}>{value}</span>
      <span
        className={`cp-sync-card-info cp-num ${view.tone}`}
        title={[lead?.full, view.full].filter(Boolean).join('\n')}
      >
        {lead ? `${lead.text} · ${view.text}` : view.text}
      </span>
      {action}
      {running && (
        <div className="cp-sync-bar" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
          <div className="cp-sync-bar-fill" style={{ width: `${p}%` }} />
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// 카드 3장
// ══════════════════════════════════════════════════════════════════

const CoupangSyncCards: React.FC<Props> = ({ summary, latestRuns, busy, locked, onListSync, onDetailSync, onStatusCheck }) => {
  const total = summary?.totalRows ?? 0
  const checked = summary ? summary.totalRows - summary.statusUnchecked : 0
  const detailReceived = summary ? summary.totalRows - summary.detailMissing : 0
  const lockTitle = locked && !busy ? '다른 창 · 화면에서 동기화가 진행 중입니다 — 끝나면 다시 누를 수 있습니다' : undefined

  return (
    <section className="cp-sync-cards" aria-label="쿠팡 동기화">
      {/* ── 1 · 목록 ── */}
      <SyncCard
        step="1 · 목록"
        stepHint="상품 · 옵션 ID · 승인상태 — 일반 + 로켓그로스 목록을 받아 새 상품은 상세까지 이어서 받습니다"
        value={summary ? `옵션 ${num(summary.totalRows)}개` : '—'}
        run={latestRuns.list}
        kind="list"
        action={<button type="button" className="cp-btn cp-btn-xs" disabled={locked} title={lockTitle} onClick={onListSync}>목록 받기</button>}
      />

      {/* ── 2 · 상세 ── */}
      <SyncCard
        step="2 · 상세"
        stepHint={`옵션 · 가격 · 재고 · 이미지 · 고시정보 — 상품당 1회 호출 (초당 5회)${summary?.lastDetailAt ? ` · 마지막으로 받은 때 ${shortDateTime(summary.lastDetailAt)}` : ''}`}
        value={summary ? (summary.detailMissing > 0 ? `${num(summary.detailMissing)}개 미수신` : '모두 받음') : '—'}
        valueWarn={!!summary?.detailMissing}
        lead={summary && total > 0
          ? {
            text: `상세 ${percent(detailReceived, total)}% · 고시 ${percent(summary.noticesReceived, total)}%`,
            full: `상세 ${num(detailReceived)} / ${num(total)} 옵션 · 고시정보 ${num(summary.noticesReceived)} / ${num(total)} 옵션`,
          }
          : undefined}
        run={latestRuns.detail}
        kind="detail"
        action={<button type="button" className="cp-btn cp-btn-xs cp-btn-primary" disabled={locked} title={lockTitle} onClick={onDetailSync}>상세 받기</button>}
      />

      {/* ── 3 · 판매상태 ── */}
      <SyncCard
        step="3 · 판매상태"
        stepHint={`판매중 · 재고 · 판매가 — 옵션당 1회 호출이라 전체는 가격/재고 엑셀이 빠릅니다${summary?.lastStatusAt ? ` · 마지막으로 확인한 때 ${shortDateTime(summary.lastStatusAt)}` : ''}`}
        value={summary ? `${num(checked)} / ${num(summary.totalRows)} 확인` : '—'}
        run={latestRuns.status}
        kind="status"
        action={<button type="button" className="cp-btn cp-btn-xs" disabled={locked} title={lockTitle ?? '확인한 지 가장 오래된 옵션 500개의 판매상태를 쿠팡에서 확인합니다'} onClick={onStatusCheck}>오래된 500개 확인</button>}
      />
    </section>
  )
}

export default CoupangSyncCards
