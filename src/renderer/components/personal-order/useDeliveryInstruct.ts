/* ================================================================
   개인주문 [배송준비] — 송장 엑셀로 쿠팡 배송지시 등록 (상태·흐름 훅)
   - 모달 단계: select(파일 선택) → analyzing → ready(사전 검사 결과) → submitting(전송) → saving(DB 반영) → done
   - 엑셀 파싱·사전 검사·전송·DB 반영은 services/deliveryInstructService.ts 가 맡고,
     이 훅은 단계 상태와 중복 실행 방지·중단·분리배송 확인만 다룬다.
   - 분리배송(부분출고)은 되돌릴 수 없어 등록 전에 확인(splitAcknowledged)을 받는다.
     등록 뒤에는 먼저 보낸 상품의 묶음배송번호가 쿠팡에서 바뀌므로 [주문 업데이트] 로 이어 준다.
   - usePersonalOrder 와 분리 — 그 훅이 주는 items(계정 전체 주문, 모든 상태) · 사용자 ID ·
     화면 반영 콜백(applyRowPatches) · 주문 업데이트(handleUpdate)만 쓴다.
   ================================================================ */

import { useCallback, useMemo, useRef, useState } from 'react'
import type { PersonalOrderRow } from '../../services/personalOrderService'
import {
  parseDeliveryExcel,
  buildDeliveryInstructPlan,
  submitDeliveryInstruct,
  saveDeliveryInstructed,
  toInstructedRows,
  isSplitBox,
  todayYmd,
  type DeliveryInstructPlan,
  type DeliveryInstructedRow,
  type InvoiceUploadResult,
} from '../../services/deliveryInstructService'

// ══════════════════════════════════════════════════════════════════
// 타입
// ══════════════════════════════════════════════════════════════════

export type DeliveryInstructPhase = 'select' | 'analyzing' | 'ready' | 'submitting' | 'saving' | 'done'

export interface DeliveryInstruct {
  open: boolean
  phase: DeliveryInstructPhase
  fileName: string | null
  /** 파일 읽기·검사 실패 문구 */
  analyzeError: string | null
  /** 전송 시작 전 실패 문구 (키 없음 등 — 아무것도 보내지 않음) */
  submitError: string | null
  plan: DeliveryInstructPlan | null
  /** 등록 대상 중 분리배송 묶음 수 */
  splitBoxCount: number
  /** 분리배송 묶음을 확인했는지 (분리배송이 있을 때만 필요) */
  splitAcknowledged: boolean
  /** 지금 [배송지시 등록] 을 누를 수 있는지 */
  canSubmit: boolean
  progress: { done: number; total: number }
  result: InvoiceUploadResult | null
  /** 쿠팡에는 등록됐지만 DB 반영에 실패한 묶음배송번호 */
  saveFailedBoxIds: string[]
  /** 분리배송이 등록돼 [주문 업데이트] 가 필요한지 (묶음배송번호가 바뀜) */
  needsOrderUpdate: boolean
  /** 전송·반영 중 (닫기·다시 선택 막음) */
  busy: boolean
  openModal: () => void
  closeModal: () => void
  analyze: (file: File) => Promise<void>
  setSplitAcknowledged: (value: boolean) => void
  submit: () => Promise<void>
  abort: () => void
  /** 모달을 닫고 [주문 업데이트] 실행 */
  closeAndUpdateOrders: () => void
}

// ══════════════════════════════════════════════════════════════════
// 훅
// ══════════════════════════════════════════════════════════════════

export function useDeliveryInstruct(
  items: PersonalOrderRow[],
  getUserId: () => string,
  onApplied: (rows: DeliveryInstructedRow[]) => void,
  onRequestOrderUpdate: () => void | Promise<void>,
): DeliveryInstruct {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<DeliveryInstructPhase>('select')
  const [fileName, setFileName] = useState<string | null>(null)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [plan, setPlan] = useState<DeliveryInstructPlan | null>(null)
  const [splitAcknowledged, setSplitAcknowledged] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<InvoiceUploadResult | null>(null)
  const [saveFailedBoxIds, setSaveFailedBoxIds] = useState<string[]>([])

  // ── 재진입 방지 · 중단 · 늦게 끝난 분석 무시 ──
  const submittingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const analyzeSeqRef = useRef(0)

  const busy = phase === 'submitting' || phase === 'saving'
  const splitBoxCount = useMemo(() => plan?.boxes.filter(isSplitBox).length ?? 0, [plan])
  const needsOrderUpdate = useMemo(() => result?.succeeded.some(isSplitBox) ?? false, [result])
  const canSubmit =
    phase === 'ready' && plan != null && plan.boxes.length > 0 && (splitBoxCount === 0 || splitAcknowledged)

  // ── 초기화 (열기 · 다른 파일) ──
  const resetRun = useCallback(() => {
    setAnalyzeError(null)
    setSubmitError(null)
    setPlan(null)
    setSplitAcknowledged(false)
    setProgress({ done: 0, total: 0 })
    setResult(null)
    setSaveFailedBoxIds([])
  }, [])

  const openModal = useCallback(() => {
    if (submittingRef.current) return
    analyzeSeqRef.current++
    resetRun()
    setFileName(null)
    setPhase('select')
    setOpen(true)
  }, [resetRun])

  const closeModal = useCallback(() => {
    if (submittingRef.current) return // 전송 중에는 닫지 않는다 (중단 버튼을 쓴다)
    analyzeSeqRef.current++
    setOpen(false)
  }, [])

  // ── 파일 선택 → 파싱 + 사전 검사 ──
  //   검사 기준은 지금 화면이 가진 items (계정 전체 주문) — 오래됐으면 [주문 업데이트] 후 다시 올린다.
  const analyze = useCallback(async (file: File) => {
    if (submittingRef.current) return
    const seq = ++analyzeSeqRef.current
    resetRun()
    setFileName(file.name)
    setPhase('analyzing')
    try {
      const parsed = await parseDeliveryExcel(file)
      if (seq !== analyzeSeqRef.current) return
      setPlan(buildDeliveryInstructPlan(parsed.rows, items, todayYmd()))
      setPhase('ready')
    } catch (err) {
      if (seq !== analyzeSeqRef.current) return
      console.error('[배송준비] 엑셀 분석 실패:', err)
      setAnalyzeError(err instanceof Error ? err.message : String(err))
      setPhase('select')
    }
  }, [items, resetRun])

  // ── [배송지시 등록] → 전송 → 화면 반영 → DB 반영 ──
  const submit = useCallback(async () => {
    if (submittingRef.current || !canSubmit || !plan) return
    const userId = getUserId()
    if (!userId) {
      setSubmitError('로그인 정보를 확인해 주세요.')
      return
    }

    submittingRef.current = true
    const controller = new AbortController()
    abortRef.current = controller
    setSubmitError(null)
    setProgress({ done: 0, total: plan.boxes.length })
    setPhase('submitting')
    try {
      let uploadResult: InvoiceUploadResult
      try {
        uploadResult = await submitDeliveryInstruct(plan.boxes, {
          signal: controller.signal,
          onProgress: (done, total) => setProgress({ done, total }),
        })
      } catch (err) {
        // 첫 요청 전에 막힌 경우 (쿠팡 키 없음 등) — 아무것도 보내지 않았다
        console.error('[배송준비] 전송 시작 실패:', err)
        setSubmitError(err instanceof Error ? err.message : String(err))
        setPhase('ready')
        return
      }
      setResult(uploadResult)

      // 쿠팡에 등록된 줄은 화면에 바로 반영 (DB 반영 실패여도 쿠팡 상태가 기준)
      const instructed = uploadResult.succeeded.flatMap(toInstructedRows)
      onApplied(instructed)

      setPhase('saving')
      if (instructed.length > 0) {
        try {
          const { failedBoxIds } = await saveDeliveryInstructed(userId, instructed)
          setSaveFailedBoxIds(failedBoxIds)
        } catch (err) {
          console.error('[배송준비] DB 반영 실패:', err)
          setSaveFailedBoxIds(Array.from(new Set(instructed.map((r) => r.shipmentBoxId))))
        }
      }
      setPhase('done')
    } finally {
      submittingRef.current = false
      abortRef.current = null
    }
  }, [canSubmit, plan, getUserId, onApplied])

  // ── 중단 — 보내는 중인 요청은 끝까지 기다리고 다음 요청부터 보내지 않는다 ──
  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  // ── 닫고 [주문 업데이트] — 분리배송으로 바뀐 묶음배송번호를 쿠팡 기준으로 맞춘다 ──
  const closeAndUpdateOrders = useCallback(() => {
    if (submittingRef.current) return
    analyzeSeqRef.current++
    setOpen(false)
    void onRequestOrderUpdate()
  }, [onRequestOrderUpdate])

  return {
    open, phase, fileName, analyzeError, submitError, plan, splitBoxCount, splitAcknowledged, canSubmit,
    progress, result, saveFailedBoxIds, needsOrderUpdate, busy,
    openModal, closeModal, analyze, setSplitAcknowledged, submit, abort, closeAndUpdateOrders,
  }
}
