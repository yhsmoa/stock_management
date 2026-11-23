/* ================================================================
   개인주문 [출고중지] — 선택한 상품준비중 주문의 출고를 쿠팡에서 멈춘다 (상태·흐름 훅)
   - 대상: 판매자 취소(선택한 줄을 취소) + 고객 취소 요청(고객이 먼저 요청한 건을 출고중지완료 처리)
   - 모달 단계: confirm(대상 확인) → running(쿠팡 처리) → saving(DB 반영) → done(결과)
   - 고객 요청 줄이 있으면 모달을 열 때 쿠팡 출고중지요청 목록을 받아 접수 건을 찾는다 (받는 동안 실행 버튼을 막는다)
   - 사전 검사·쿠팡 호출·반영값은 services/shipmentStopService.ts 가 맡고,
     이 훅은 단계 상태와 중복 실행 방지·중단·확인 체크·WING ID 조회만 다룬다.
   - 취소는 되돌릴 수 없고 판매자 사유(품절)로 기록되므로 실행 전에 확인(acknowledged)을 받는다.
   - 쿠팡 WING 로그인 ID(si_users.coupang_user_name)는 모달을 열 때마다 DB 에서 읽는다
     (로그인 뒤에 채워질 수 있는 값 — fetchCoupangUserName). 판매자 취소에만 필요하다.
   - usePersonalOrder 와 분리 — 그 훅이 주는 items(계정 전체 주문) · 선택한 줄 · 사용자 ID ·
     화면 반영 콜백 · 주문 업데이트(handleUpdate)만 쓴다.
   ================================================================ */

import { useCallback, useMemo, useRef, useState } from 'react'
import { fetchCoupangUserName } from '../../services/supabase'
import {
  fetchReturnRequests,
  RETURN_REQUEST_STATUS,
  type OrderRowPatch,
  type PersonalOrderRow,
} from '../../services/personalOrderService'
import {
  buildShipmentStopPlan,
  needsRequestLookup,
  parseStopRequestReceipts,
  runShipmentStop,
  saveShipmentStopped,
  toStoppedRowPatches,
  type RequestLookup,
  type ShipmentStopPlan,
  type StopResult,
} from '../../services/shipmentStopService'

// ══════════════════════════════════════════════════════════════════
// 타입
// ══════════════════════════════════════════════════════════════════

export type ShipmentStopPhase = 'confirm' | 'running' | 'saving' | 'done'

/** 쿠팡 WING 로그인 ID 조회 상태 — missing 은 계정에 등록되지 않음 */
export type WingIdState =
  | { status: 'loading' }
  | { status: 'ready'; userId: string }
  | { status: 'missing' }
  | { status: 'error'; message: string }

export interface ShipmentStop {
  open: boolean
  phase: ShipmentStopPhase
  plan: ShipmentStopPlan | null
  wingId: WingIdState
  /** 되돌릴 수 없음 · 판매자 사유 기록을 확인했는지 */
  acknowledged: boolean
  /** 지금 [출고중지] 를 누를 수 있는지 */
  canSubmit: boolean
  /** 실행 시작 전 실패 문구 (키 없음 등 — 아무것도 보내지 않음) */
  startError: string | null
  progress: { done: number; total: number }
  /** 대상별 결과 (판매자 취소 → 고객 요청 순서) */
  results: StopResult[] | null
  /** 쿠팡에는 접수됐지만 DB 반영에 실패한 묶음배송번호 */
  saveFailedBoxIds: string[]
  /** 사람이 확인할 결과가 있어 [주문 업데이트] 를 권하는지 */
  needsOrderUpdate: boolean
  /** 처리·반영 중 (닫기 막음) */
  busy: boolean
  openModal: () => void
  closeModal: () => void
  setAcknowledged: (value: boolean) => void
  submit: () => Promise<void>
  abort: () => void
  /** 모달을 닫고 [주문 업데이트] 실행 */
  closeAndUpdateOrders: () => void
}

// ══════════════════════════════════════════════════════════════════
// 훅
// ══════════════════════════════════════════════════════════════════

export function useShipmentStop(
  items: PersonalOrderRow[],
  getSelectedRows: () => PersonalOrderRow[],
  getUserId: () => string,
  onApplied: (patches: OrderRowPatch[]) => void,
  onRequestOrderUpdate: () => void | Promise<void>,
): ShipmentStop {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<ShipmentStopPhase>('confirm')
  const [plan, setPlan] = useState<ShipmentStopPlan | null>(null)
  const [wingId, setWingId] = useState<WingIdState>({ status: 'loading' })
  const [acknowledged, setAcknowledged] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState<StopResult[] | null>(null)
  const [saveFailedBoxIds, setSaveFailedBoxIds] = useState<string[]>([])

  // ── 재진입 방지 · 중단 · 늦게 끝난 WING ID 조회 무시 ──
  const runningRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const openSeqRef = useRef(0)

  const busy = phase === 'running' || phase === 'saving'
  const needsOrderUpdate = useMemo(
    () => results?.some((r) => r.outcome === 'needsCheck' || r.outcome === 'unknown') ?? false,
    [results],
  )
  const canSubmit =
    phase === 'confirm' && plan != null &&
    plan.boxes.length + plan.requests.length > 0 &&
    plan.pendingRequestLines === 0 &&                          // 접수 건 조회가 끝나야 한다
    (plan.boxes.length === 0 || wingId.status === 'ready') &&  // WING ID 는 판매자 취소에만 필요
    acknowledged

  // ── WING ID 조회 — 모달을 연 시점의 것만 반영 ──
  const loadWingId = useCallback(async (seq: number) => {
    setWingId({ status: 'loading' })
    try {
      const userId = await fetchCoupangUserName()
      if (seq !== openSeqRef.current) return
      setWingId(userId ? { status: 'ready', userId } : { status: 'missing' })
    } catch (err) {
      if (seq !== openSeqRef.current) return
      console.error('[출고중지] 쿠팡 로그인 ID 조회 실패:', err)
      setWingId({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  // ── 고객 요청 접수 건 조회 — 끝나면 계획을 다시 만든다. 모달을 연 시점의 것만 반영 ──
  const loadRequestReceipts = useCallback(async (
    seq: number,
    selectedRows: PersonalOrderRow[],
    orders: PersonalOrderRow[],
  ) => {
    let lookup: RequestLookup
    try {
      const raw = await fetchReturnRequests([RETURN_REQUEST_STATUS.STOP_REQUESTED])
      lookup = { status: 'ready', receipts: parseStopRequestReceipts(raw) }
    } catch (err) {
      console.error('[출고중지] 출고중지요청 목록 조회 실패:', err)
      lookup = { status: 'error', message: err instanceof Error ? err.message : String(err) }
    }
    if (seq !== openSeqRef.current) return
    setPlan(buildShipmentStopPlan(selectedRows, orders, lookup))
    setAcknowledged(false) // 대상이 바뀌었으니 다시 확인받는다
  }, [])

  // ── 열기 — 지금 선택한 줄로 계획을 만든다 (검사 기준은 화면이 가진 items) ──
  const openModal = useCallback(() => {
    if (runningRef.current) return
    const seq = ++openSeqRef.current
    const selectedRows = getSelectedRows()
    const lookupNeeded = needsRequestLookup(selectedRows)
    setPlan(buildShipmentStopPlan(selectedRows, items, { status: lookupNeeded ? 'loading' : 'notNeeded' }))
    setAcknowledged(false)
    setStartError(null)
    setProgress({ done: 0, total: 0 })
    setResults(null)
    setSaveFailedBoxIds([])
    setPhase('confirm')
    setOpen(true)
    void loadWingId(seq)
    if (lookupNeeded) void loadRequestReceipts(seq, selectedRows, items)
  }, [getSelectedRows, items, loadWingId, loadRequestReceipts])

  const closeModal = useCallback(() => {
    if (runningRef.current) return // 처리 중에는 닫지 않는다 (중단 버튼을 쓴다)
    openSeqRef.current++
    setOpen(false)
  }, [])

  // ── [출고중지] → 쿠팡 처리 → 화면 반영 → DB 반영 ──
  const submit = useCallback(async () => {
    if (runningRef.current || !canSubmit || !plan) return
    // WING ID 는 판매자 취소에만 쓴다 (canSubmit 이 판매자 취소가 있으면 ready 를 요구)
    const wingUserId = wingId.status === 'ready' ? wingId.userId : ''
    const targets = [...plan.boxes, ...plan.requests]
    const userId = getUserId()
    if (!userId) {
      setStartError('로그인 정보를 확인해 주세요.')
      return
    }

    runningRef.current = true
    const controller = new AbortController()
    abortRef.current = controller
    setStartError(null)
    setProgress({ done: 0, total: targets.length })
    setPhase('running')
    try {
      let runResults: StopResult[]
      try {
        const run = await runShipmentStop(targets, wingUserId, {
          signal: controller.signal,
          onProgress: (done, total) => setProgress({ done, total }),
        })
        runResults = run.results
      } catch (err) {
        // 첫 요청 전에 막힌 경우 (쿠팡 키 없음 등) — 아무것도 보내지 않았다
        console.error('[출고중지] 실행 시작 실패:', err)
        setStartError(err instanceof Error ? err.message : String(err))
        setPhase('confirm')
        return
      }
      setResults(runResults)

      // 쿠팡이 처리한 줄은 화면에 바로 반영 (DB 반영 실패여도 쿠팡 상태가 기준)
      const patches = toStoppedRowPatches(runResults)
      onApplied(patches)

      setPhase('saving')
      if (patches.length > 0) {
        try {
          const { failedBoxIds } = await saveShipmentStopped(userId, patches)
          setSaveFailedBoxIds(failedBoxIds)
        } catch (err) {
          console.error('[출고중지] DB 반영 실패:', err)
          setSaveFailedBoxIds(Array.from(new Set(patches.map((p) => p.shipmentBoxId))))
        }
      }
      setPhase('done')
    } finally {
      runningRef.current = false
      abortRef.current = null
    }
  }, [canSubmit, plan, wingId, getUserId, onApplied])

  // ── 중단 — 처리 중인 대상은 확인까지 마치고 다음 대상부터 보내지 않는다 ──
  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  // ── 닫고 [주문 업데이트] — 확인이 필요한 건을 쿠팡 기준으로 다시 맞춘다 ──
  const closeAndUpdateOrders = useCallback(() => {
    if (runningRef.current) return
    openSeqRef.current++
    setOpen(false)
    void onRequestOrderUpdate()
  }, [onRequestOrderUpdate])

  return {
    open, phase, plan, wingId, acknowledged, canSubmit, startError, progress, results,
    saveFailedBoxIds, needsOrderUpdate, busy,
    openModal, closeModal, setAcknowledged, submit, abort, closeAndUpdateOrders,
  }
}
