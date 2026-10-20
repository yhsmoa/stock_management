/* ================================================================
   상품관리 — 동기화 3단계 카드 (목록 · 상세 · 판매상태)
   - 카드 맨 아래: 지금 어디까지 받았는지
     · 목록 — 마지막 [목록 받기] 실행 (si_coupang_sync_runs)
     · 상세 — 상세 · 고시정보를 받은 옵션 비율 막대 + 마지막 [상세 받기] 실행
     · 판매상태 — 마지막 확인 실행
   - 실행이 창 닫힘 등으로 끊겼으면 어디서 끊겼는지와, 다시 누르면 어떻게 이어지는지 알려 준다
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

function percent(done: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
}

/** 실행 기록 한 줄 */
function RunLine({ run, kind }: { run: SyncRun | undefined; kind: SyncRunKind }) {
  if (!run) return <div className="cp-sync-run">아직 실행 기록이 없습니다</div>
  const view = runViewStatus(run)
  const progress = run.total > 0 ? `${num(run.done)} / ${num(run.total)} (${percent(run.done, run.total)}%)` : ''
  const when = shortDateTime(run.finished_at ?? run.updated_at)
  switch (view) {
    case 'running':
      return (
        <div className="cp-sync-run is-running">
          진행 중{progress && ` · ${progress}`} — {run.title ?? ''}
          {run.total > 0 && <RunBar done={run.done} total={run.total} />}
        </div>
      )
    case 'interrupted':
      return (
        <div className="cp-sync-run is-warn">
          {when} · {progress ? `${progress} 에서 ` : ''}끊김 (창을 닫았거나 연결이 끊김). {RESUME_HINT[kind]}
        </div>
      )
    case 'aborted':
      return (
        <div className="cp-sync-run is-warn">
          {when} · {progress ? `${progress} 에서 ` : ''}중단함. {RESUME_HINT[kind]}
        </div>
      )
    case 'failed':
      return <div className="cp-sync-run is-warn">{when} · 실패 — {run.message ?? ''}</div>
    case 'done':
      return <div className="cp-sync-run">마지막 {when} 완료{run.message ? ` · ${run.message}` : ''}</div>
  }
}

function RunBar({ done, total }: { done: number; total: number }) {
  const p = percent(done, total)
  return (
    <div className="cp-sync-bar" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
      <div className="cp-sync-bar-fill" style={{ width: `${p}%` }} />
    </div>
  )
}

/** 받은 비율 막대 + 숫자 */
function Coverage({ label, done, total }: { label: string; done: number; total: number }) {
  return (
    <div className="cp-sync-coverage">
      <div className="cp-sync-coverage-head cp-num">
        <span>{label}</span>
        <span>{num(done)} / {num(total)} 옵션 · {percent(done, total)}%</span>
      </div>
      <RunBar done={done} total={total} />
    </div>
  )
}

const CoupangSyncCards: React.FC<Props> = ({ summary, latestRuns, busy, locked, onListSync, onDetailSync, onStatusCheck }) => {
  const checked = summary ? summary.totalRows - summary.statusUnchecked : 0
  const detailReceived = summary ? summary.totalRows - summary.detailMissing : 0
  const lockTitle = locked && !busy ? '다른 창 · 화면에서 동기화가 진행 중입니다 — 끝나면 다시 누를 수 있습니다' : undefined

  return (
    <section className="cp-sync-cards" aria-label="쿠팡 동기화">
      {/* ── 1 · 목록 ── */}
      <div className="cp-sync-card">
        <div className="cp-sync-card-main">
          <div className="cp-sync-card-body">
            <div className="cp-sync-card-step">1 · 목록 (상품 · 옵션 ID · 승인상태)</div>
            <div className="cp-sync-card-value cp-num">{summary ? `옵션 ${num(summary.totalRows)}개` : '—'}</div>
            <div className="cp-sync-card-meta">일반 + 로켓그로스 목록을 받아 새 상품은 상세까지 이어서 받습니다</div>
          </div>
          <div className="cp-sync-card-actions">
            <button type="button" className="cp-btn" disabled={locked} title={lockTitle} onClick={onListSync}>목록 받기</button>
          </div>
        </div>
        <div className="cp-sync-card-foot">
          <RunLine run={latestRuns.list} kind="list" />
        </div>
      </div>

      {/* ── 2 · 상세 ── */}
      <div className="cp-sync-card">
        <div className="cp-sync-card-main">
          <div className="cp-sync-card-body">
            <div className="cp-sync-card-step">2 · 상세 (옵션 · 가격 · 재고 · 이미지 · 고시정보)</div>
            <div className="cp-sync-card-value cp-num">
              {summary ? (summary.detailMissing > 0 ? `옵션 ${num(summary.detailMissing)}개 미수신` : '모두 받음') : '—'}
            </div>
            <div className={`cp-sync-card-meta${summary?.detailMissing ? ' is-warn' : ''}`}>
              {summary?.lastDetailAt ? `마지막 ${shortDateTime(summary.lastDetailAt)} · ` : ''}상품당 1회 호출 (초당 5회)
            </div>
          </div>
          <div className="cp-sync-card-actions">
            <button type="button" className="cp-btn cp-btn-primary" disabled={locked} title={lockTitle} onClick={onDetailSync}>상세 받기</button>
          </div>
        </div>
        <div className="cp-sync-card-foot">
          {summary && summary.totalRows > 0 && (
            <>
              <Coverage label="상세" done={detailReceived} total={summary.totalRows} />
              <Coverage label="고시정보" done={summary.noticesReceived} total={summary.totalRows} />
            </>
          )}
          <RunLine run={latestRuns.detail} kind="detail" />
        </div>
      </div>

      {/* ── 3 · 판매상태 ── */}
      <div className="cp-sync-card">
        <div className="cp-sync-card-main">
          <div className="cp-sync-card-body">
            <div className="cp-sync-card-step">3 · 판매상태 (판매중 · 재고 · 판매가)</div>
            <div className="cp-sync-card-value cp-num">{summary ? `옵션 ${num(checked)} / ${num(summary.totalRows)} 확인` : '—'}</div>
            <div className="cp-sync-card-meta">
              {summary?.lastStatusAt ? `마지막 ${shortDateTime(summary.lastStatusAt)} · ` : ''}옵션당 1회 호출 — 전체는 엑셀이 빠릅니다
            </div>
          </div>
          <div className="cp-sync-card-actions">
            <button type="button" className="cp-btn" disabled={locked} title={lockTitle} onClick={onStatusCheck}>오래된 순 500개 확인</button>
          </div>
        </div>
        <div className="cp-sync-card-foot">
          <RunLine run={latestRuns.status} kind="status" />
        </div>
      </div>
    </section>
  )
}

export default CoupangSyncCards
