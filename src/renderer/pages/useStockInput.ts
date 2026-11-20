// ═══════════════════════════════════════════════════════════════════
// useStockInput — 재고입력(/stock-input) 화면 상태 · 동작
//   - 진입 시 로켓그로스 바코드 색인을 한 번 받는다 (실패하면 스캔을 막고 [다시 시도])
//   - 위치 → 바코드 스캔: 색인에 있는 바코드만 목록에 넣는다 (최신이 맨 위, 같은 위치 + 바코드는 수량 +1)
//   - [재고 추가]: 목록을 si_stocks 에 더하고, 저장된 줄은 목록에서 뺀다 (실패한 줄만 남음)
//   목록은 화면 상태다 — 저장 전에 페이지를 떠나면 사라지므로 화면이 이탈 확인을 띄운다.
//   규칙 · DB 작업은 services/stockInputService.ts.
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addScan,
  fetchRgBarcodeIndex,
  removeScan,
  saveStockInput,
  sumScanQty,
  type RgBarcodeIndex,
  type StockInputRow,
} from '../services/stockInputService'

// ── 타입 ──────────────────────────────────────────────────────────
/** 바코드 색인 상태 */
export type BarcodeIndexState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; index: RgBarcodeIndex }

/** 입력폼 아래 안내 한 줄 */
export interface StockInputNotice {
  tone: 'error' | 'success'
  text: string
}

// ── 사용자 ID ─────────────────────────────────────────────────────
const getUserId = (): string | null => {
  const raw = localStorage.getItem('user')
  if (!raw) return null
  try { return JSON.parse(raw)?.id ?? null } catch { return null }
}

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e))

export function useStockInput() {
  // ═══════════════════════════════════════════════════════════════
  // 상태
  // ═══════════════════════════════════════════════════════════════
  const [indexState, setIndexState] = useState<BarcodeIndexState>({ kind: 'loading' })
  const [indexNonce, setIndexNonce] = useState(0)          // [다시 시도] 마다 +1
  const [location, setLocation] = useState('')
  const [barcode, setBarcode] = useState('')
  const [rows, setRows] = useState<StockInputRow[]>([])
  const [notice, setNotice] = useState<StockInputNotice | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const savingRef = useRef(false)                          // 연속 클릭 · 이탈 모달의 중복 저장 방지

  const locationRef = useRef<HTMLInputElement>(null)
  const barcodeRef = useRef<HTMLInputElement>(null)

  // ═══════════════════════════════════════════════════════════════
  // 바코드 색인 (진입 · [다시 시도])
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    const userId = getUserId()
    if (!userId) {
      setIndexState({ kind: 'error', message: '사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.' })
      return
    }
    let cancelled = false
    setIndexState({ kind: 'loading' })
    fetchRgBarcodeIndex(userId)
      .then(index => { if (!cancelled) setIndexState({ kind: 'ready', index }) })
      .catch(e => {
        if (cancelled) return
        console.error('[useStockInput] 바코드 색인 조회 실패:', e)
        setIndexState({ kind: 'error', message: `로켓그로스 바코드를 불러오지 못했습니다: ${errorText(e)}` })
      })
    return () => { cancelled = true }
  }, [indexNonce])

  const retryIndex = useCallback(() => setIndexNonce(n => n + 1), [])

  // ── 처음 들어오면 위치 칸으로 ──
  useEffect(() => { locationRef.current?.focus() }, [])

  // ═══════════════════════════════════════════════════════════════
  // 입력
  // ═══════════════════════════════════════════════════════════════

  /** 위치 Enter → 바코드 칸으로 (빈 위치면 그대로) */
  const submitLocation = useCallback(() => {
    if (!location.trim()) {
      setNotice({ tone: 'error', text: '위치를 입력하세요.' })
      return
    }
    setNotice(null)
    barcodeRef.current?.focus()
  }, [location])

  /** 바코드 Enter → 색인에서 찾아 목록에 반영 */
  const submitBarcode = useCallback(() => {
    const code = barcode.trim()
    if (!code || savingRef.current || indexState.kind !== 'ready') return

    const loc = location.trim()
    if (!loc) {
      setNotice({ tone: 'error', text: '위치를 먼저 입력하세요.' })
      locationRef.current?.focus()
      return
    }

    setBarcode('')
    const product = indexState.index.get(code)
    if (!product) {
      setNotice({ tone: 'error', text: `로켓그로스 상품에 없는 바코드입니다: ${code}` })
      return
    }
    setRows(prev => addScan(prev, loc, code, product))
    setNotice(null)
  }, [barcode, location, indexState])

  /** 목록에서 한 줄 빼기 */
  const removeRow = useCallback((key: string) => {
    if (savingRef.current) return
    setRows(prev => removeScan(prev, key))
    barcodeRef.current?.focus()
  }, [])

  // ═══════════════════════════════════════════════════════════════
  // [재고 추가]
  // ═══════════════════════════════════════════════════════════════

  /** 목록을 재고에 더한다 — 전부 저장되면 true */
  const save = useCallback(async (): Promise<boolean> => {
    if (savingRef.current || rows.length === 0) return false
    const userId = getUserId()
    if (!userId) {
      setNotice({ tone: 'error', text: '사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.' })
      return false
    }

    savingRef.current = true
    setIsSaving(true)
    const target = rows   // 저장 중에는 스캔 · 삭제를 막으므로 목록이 바뀌지 않는다
    try {
      const result = await saveStockInput(userId, target)

      if (result.kind === 'blocked') {
        setNotice({ tone: 'error', text: `재고에 추가하지 않았습니다 — ${result.reasons.join(' / ')}` })
        return false
      }

      const failed = new Set(result.failedKeys)
      setRows(target.filter(r => failed.has(r.key)))
      const savedText = `신규 ${result.created.toLocaleString()}줄 · 수량 추가 ${result.updated.toLocaleString()}줄`
      if (failed.size > 0) {
        setNotice({
          tone: 'error',
          text: `${failed.size.toLocaleString()}줄을 저장하지 못해 목록에 남겼습니다 (저장됨: ${savedText}). [재고 추가] 를 다시 눌러 주세요.`,
        })
        return false
      }
      setNotice({
        tone: 'success',
        text: `재고에 추가했습니다 — ${savedText} · 수량 ${sumScanQty(target).toLocaleString()}`,
      })
      return true
    } catch (e) {
      // 재고 조회 실패 등 — 아무것도 쓰지 않았다
      console.error('[useStockInput] 재고 추가 실패:', e)
      setNotice({ tone: 'error', text: `재고에 추가하지 못했습니다 (바뀐 것 없음): ${errorText(e)}` })
      return false
    } finally {
      savingRef.current = false
      setIsSaving(false)
    }
  }, [rows])

  // ── 저장이 끝나면 바코드 칸으로 (저장 중에는 입력칸이 잠겨 있어 다시 그려진 뒤에 잡는다) ──
  const wasSavingRef = useRef(false)
  useEffect(() => {
    if (wasSavingRef.current && !isSaving) barcodeRef.current?.focus()
    wasSavingRef.current = isSaving
  }, [isSaving])

  // ═══════════════════════════════════════════════════════════════
  // 파생값
  // ═══════════════════════════════════════════════════════════════
  const totalQty = useMemo(() => sumScanQty(rows), [rows])

  return {
    // 색인
    indexState,
    retryIndex,
    // 입력
    location,
    setLocation,
    barcode,
    setBarcode,
    locationRef,
    barcodeRef,
    submitLocation,
    submitBarcode,
    // 목록
    rows,
    totalQty,
    removeRow,
    notice,
    // 저장
    isSaving,
    save,
  }
}
