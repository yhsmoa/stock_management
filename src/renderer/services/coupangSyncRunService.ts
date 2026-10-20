/* ================================================================
   상품관리 — 동기화 실행 기록 (si_coupang_sync_runs)
   - [목록 받기] · [상세 받기] · [판매상태 확인] 실행마다 1행: 시작 → 진행(몇 초마다) → 끝
   - 동기화 카드 맨 아래 "어디까지 받았는지" · 다른 창에서 진행 중일 때 버튼 잠금에 쓴다
   - 기록 실패는 동기화를 멈추지 않는다 (모든 함수가 오류를 삼키고 콘솔에만 남긴다)
   - SQL: docs/sql/2026-10-20_si_coupang_sync_runs.sql
   ================================================================ */

import { supabase } from './supabase'

// ── 상수 ──────────────────────────────────────────────────────────
const TABLE = 'si_coupang_sync_runs'
/** 진행 중 기록을 이 간격보다 자주 쓰지 않는다 (상세 받기는 초당 5건 — 매건 쓰면 DB 호출이 배가 된다) */
export const RUN_WRITE_INTERVAL_MS = 3000
/** 'running' 인데 이만큼 갱신이 없으면 창이 닫혀 끊긴 것으로 본다 (쓰기 간격의 여러 배) */
export const RUN_STALE_MS = 2 * 60 * 1000

export type SyncRunKind = 'list' | 'detail' | 'status'
export type SyncRunStatus = 'running' | 'done' | 'aborted' | 'failed'

export interface SyncRun {
  id: string
  kind: SyncRunKind
  title: string | null
  status: SyncRunStatus
  done: number
  total: number
  message: string | null
  started_at: string
  updated_at: string
  finished_at: string | null
}

/** 화면에서 보는 상태 — 'running' 이 오래 멈췄으면 'interrupted' */
export type SyncRunView = SyncRunStatus | 'interrupted'

export function runViewStatus(run: SyncRun, now = Date.now()): SyncRunView {
  if (run.status !== 'running') return run.status
  return now - Date.parse(run.updated_at) > RUN_STALE_MS ? 'interrupted' : 'running'
}

// ══════════════════════════════════════════════════════════════════
// 쓰기 (실패해도 던지지 않는다)
// ══════════════════════════════════════════════════════════════════

/** 시작 기록 → id (실패하면 null — 이후 갱신은 건너뛴다) */
export async function startSyncRun(userId: string, kind: SyncRunKind, title: string, total = 0): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .insert({ user_id: userId, kind, title, status: 'running', done: 0, total })
      .select('id')
      .single()
    if (error) throw error
    return (data as { id: string }).id
  } catch (err) {
    console.error('[startSyncRun] 기록 실패 (동기화는 계속):', err)
    return null
  }
}

export async function updateSyncRun(
  id: string | null,
  patch: Partial<Pick<SyncRun, 'done' | 'total' | 'message' | 'title'>>,
): Promise<void> {
  if (!id) return
  try {
    const { error } = await supabase.from(TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
  } catch (err) {
    console.error('[updateSyncRun] 기록 실패 (동기화는 계속):', err)
  }
}

export async function finishSyncRun(
  id: string | null,
  status: Exclude<SyncRunStatus, 'running'>,
  patch: Partial<Pick<SyncRun, 'done' | 'total' | 'message'>>,
): Promise<void> {
  if (!id) return
  const now = new Date().toISOString()
  try {
    const { error } = await supabase.from(TABLE).update({ ...patch, status, updated_at: now, finished_at: now }).eq('id', id)
    if (error) throw error
  } catch (err) {
    console.error('[finishSyncRun] 기록 실패:', err)
  }
}

// ══════════════════════════════════════════════════════════════════
// 읽기 — 종류별 최신 기록
// ══════════════════════════════════════════════════════════════════

const RUN_KINDS: SyncRunKind[] = ['list', 'detail', 'status']

/** 종류마다 최신 1건 — 종류별로 따로 묻는다 (한 종류가 자주 돌아도 다른 종류 기록이 밀려나지 않게) */
export async function fetchLatestSyncRuns(userId: string): Promise<Partial<Record<SyncRunKind, SyncRun>>> {
  const out: Partial<Record<SyncRunKind, SyncRun>> = {}
  for (const kind of RUN_KINDS) {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select('id, kind, title, status, done, total, message, started_at, updated_at, finished_at')
        .eq('user_id', userId)
        .eq('kind', kind)
        .order('started_at', { ascending: false })
        .limit(1)
      if (error) throw error
      const run = (data ?? [])[0] as SyncRun | undefined
      if (run) out[kind] = run
    } catch (err) {
      console.error('[fetchLatestSyncRuns] 조회 실패:', kind, err)
    }
  }
  return out
}
