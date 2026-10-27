/* ================================================================
   로켓그로스 콘솔 (RocketConsole) — 커스텀 훅
   - 엑셀은 맨 위 드롭 영역에서 한 번만 받는다 (모든 보드가 공유).
   - 보드(단계)는 BOARD_DEFS 배열 — 단계를 늘릴 때는 항목 하나와
     rocketConsoleService 의 build 함수 하나만 추가한다.
   ================================================================ */

import { useState, useCallback, useMemo, useRef } from 'react'
import {
  parseInboundExcel,
  buildSelectProductsScript,
  buildInputQuantitiesScript,
  type InboundExcel,
} from '../services/rocketConsoleService'
import { copyTextToClipboard } from '../utils/clipboard'

// ── 상수 ──────────────────────────────────────────────────────────
const COPIED_FEEDBACK_MS = 2000                 // [복사] 버튼 '복사됨' 표시 시간
const ACCEPT_EXTENSIONS = ['.xlsx', '.xls']     // 드롭 허용 확장자
export const ACCEPT_ATTR = ACCEPT_EXTENSIONS.join(',')

// ══════════════════════════════════════════════════════════════════
// 보드 정의
// ══════════════════════════════════════════════════════════════════

export interface ConsoleBoardDef {
  key: string
  step: number
  title: string
  /** 쿠팡윙 어느 화면에서 붙여넣는지 */
  usage: string
  /** 스크립트 생성 — 만들 수 없으면 Error 를 던진다 (보드에 사유 표시) */
  build: (excel: InboundExcel) => string
  /** 보드 요약 줄 */
  notes: (excel: InboundExcel) => string[]
}

const BOARD_DEFS: ConsoleBoardDef[] = [
  {
    key: 'select-products',
    step: 1,
    title: '상품 선택',
    usage: '입고 생성하기 › 1. 상품 선택 화면',
    build: buildSelectProductsScript,
    notes: (x) => [`옵션 ID ${x.rows.length.toLocaleString()}개를 20개씩 검색해 체크합니다.`],
  },
  {
    key: 'input-quantities',
    step: 2,
    title: '상품 확인 · 수량 입력',
    usage: '입고 생성하기 › 2. 입고 정보 입력 화면',
    build: buildInputQuantitiesScript,
    notes: (x) => [
      `화면 상품이 엑셀 ${x.rows.length.toLocaleString()}개와 같은지 먼저 검사합니다. 다르면 아무것도 입력하지 않고 멈춥니다.`,
      `같으면 수량을 입력하고 다시 검증합니다. 총 ${x.totalQty.toLocaleString()}개`,
    ],
  },
]

/** 화면에 그릴 보드 1개 */
export interface ConsoleBoard {
  def: ConsoleBoardDef
  script: string | null
  error: string
  notes: string[]
}

// ══════════════════════════════════════════════════════════════════
// 페이지 훅
// ══════════════════════════════════════════════════════════════════

export function useRocketConsole() {
  const [excel, setExcel] = useState<InboundExcel | null>(null)
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const copiedTimerRef = useRef<number | null>(null)

  // ── 엑셀 받기 (드롭 · 파일 선택 공용) ──
  const loadFile = useCallback(async (file: File) => {
    const lower = file.name.toLowerCase()
    if (!ACCEPT_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      setError(`엑셀 파일(${ACCEPT_ATTR})만 넣을 수 있습니다.`)
      return
    }
    setLoading(true)
    setError('')
    setCopiedKey(null)
    setFileName(file.name)
    try {
      setExcel(await parseInboundExcel(file))
    } catch (err: any) {
      setExcel(null)
      setError(err?.message ?? '엑셀을 읽지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  // ── 초기화 ──
  const clear = useCallback(() => {
    setExcel(null)
    setFileName('')
    setError('')
    setCopiedKey(null)
  }, [])

  // ── 보드별 스크립트 (엑셀이 바뀔 때만 다시 만든다) ──
  const boards = useMemo<ConsoleBoard[]>(() => BOARD_DEFS.map((def) => {
    if (!excel) return { def, script: null, error: '', notes: [] }
    try {
      return { def, script: def.build(excel), error: '', notes: def.notes(excel) }
    } catch (err: any) {
      return { def, script: null, error: err?.message ?? '스크립트를 만들지 못했습니다.', notes: [] }
    }
  }), [excel])

  // ── 복사 ──
  const copy = useCallback(async (board: ConsoleBoard) => {
    if (!board.script) return
    const ok = await copyTextToClipboard(board.script)
    if (!ok) {
      alert('클립보드 복사에 실패했습니다. 스크립트 칸을 직접 선택해 복사해 주세요.')
      return
    }
    setCopiedKey(board.def.key)
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = window.setTimeout(() => setCopiedKey(null), COPIED_FEEDBACK_MS)
  }, [])

  return { excel, fileName, loading, error, loadFile, clear, boards, copiedKey, copy }
}
