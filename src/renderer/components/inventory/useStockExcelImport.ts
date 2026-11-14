// ═══════════════════════════════════════════════════════════════════
// useStockExcelImport — 재고관리 [엑셀 추가] 모달 상태
//   파일 → 시트 · 머리글 행 → 열 선택 → 자동 검사 → 실행 → 결과
//   - 검사: 입력(파일·시트·머리글·열·모드)이 바뀔 때마다 다시 돈다. 늦게 끝난 옛 검사는
//     요청 번호(checkSeq)로 버린다.
//   - 실행: 재고를 새로 읽어 같은 엑셀 행으로 계획을 다시 만들고, 검사 때와 작업 목록이
//     다르면 아무것도 쓰지 않고 멈춘다.
//   - 실행한 열 선택은 머리글 글자로 localStorage 에 기억해 다음 파일의 자동 추측에 쓴다
//     (고르는 도중의 값은 기억하지 않는다 — 잘못 누른 선택이 다음 파일에 남지 않도록).
//   검사·계획 규칙은 services/stockImportService.ts, DB 는 StockService.
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StockService, type StockImportApplyResult } from '../../services/stockService'
import {
  STOCK_IMPORT_ROLES,
  detectHeaderRow,
  firstSheetWithData,
  guessMapping,
  headerRowChoices,
  headerTexts,
  mappingConflicts,
  missingRequiredRoles,
  nextEmptyRole,
  parseStockImportRows,
  planStockImport,
  readStockWorkbook,
  rolesForMode,
  stockImportOpsSignature,
  toggleColumnInMapping,
  emptyMapping,
  type CoupangStockName,
  type ExcelSheetData,
  type StockImportMapping,
  type StockImportMappingMemory,
  type StockImportMode,
  type StockImportPlan,
  type StockImportRole,
} from '../../services/stockImportService'

// ── 상수 ──────────────────────────────────────────────────────────
const MAPPING_MEMORY_KEY = 'inventory_excel_mapping_v1'
const ACCEPTED_FILE = /\.(xlsx|xls)$/i
export const STALE_PLAN_MESSAGE = '그사이 재고가 바뀌었습니다 — 다시 확인해 주세요'

// ── 타입 ──────────────────────────────────────────────────────────
export interface ImportFileInfo {
  name: string
  size: number
}

export interface ImportCheckState {
  status: 'idle' | 'checking' | 'done' | 'error'
  plan: StockImportPlan | null
  error: string | null
}

export type ImportPhase = 'edit' | 'running' | 'done'

const IDLE_CHECK: ImportCheckState = { status: 'idle', plan: null, error: null }

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)

// ══════════════════════════════════════════════════════════════════
// 사용자 · 열 선택 기억 (localStorage — 실패해도 동작은 그대로)
// ══════════════════════════════════════════════════════════════════

const readUserId = (): string | null => {
  try {
    const raw = localStorage.getItem('user')
    return raw ? JSON.parse(raw)?.id ?? null : null
  } catch {
    return null
  }
}

function readMappingMemory(): StockImportMappingMemory {
  try {
    const raw = localStorage.getItem(MAPPING_MEMORY_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const memory: StockImportMappingMemory = {}
    for (const role of STOCK_IMPORT_ROLES) {
      const v = (parsed as Record<string, unknown>)[role]
      if (typeof v === 'string' && v) memory[role] = v
    }
    return memory
  } catch {
    return {}
  }
}

/** 고른 열의 머리글 글자를 역할별로 기억 (고르지 않았거나 머리글이 비면 기억을 지운다) */
function rememberMapping(
  sheet: ExcelSheetData,
  headerRowIndex: number,
  mapping: StockImportMapping,
  roles: readonly StockImportRole[],
) {
  const headers = headerTexts(sheet, headerRowIndex)
  const memory = readMappingMemory()
  for (const role of roles) {
    const col = mapping[role]
    const header = col === null ? '' : headers[col] ?? ''
    if (header) memory[role] = header
    else delete memory[role]
  }
  try {
    localStorage.setItem(MAPPING_MEMORY_KEY, JSON.stringify(memory))
  } catch {
    // 저장소를 못 쓰는 환경 — 다음엔 자동 추측만 한다
  }
}

// ══════════════════════════════════════════════════════════════════
// 훅
// ══════════════════════════════════════════════════════════════════

export function useStockExcelImport() {
  const userId = useMemo(readUserId, [])

  // ── 입력 ──
  const [mode, setModeState] = useState<StockImportMode>('add')
  const [file, setFile] = useState<ImportFileInfo | null>(null)
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [sheets, setSheets] = useState<ExcelSheetData[]>([])
  const [sheetIndex, setSheetIndex] = useState(0)
  const [headerRowIndex, setHeaderRowIndex] = useState(0)
  const [mapping, setMapping] = useState<StockImportMapping>(emptyMapping)

  // ── 검사 ──
  const [check, setCheck] = useState<ImportCheckState>(IDLE_CHECK)
  const [recheckToken, setRecheckToken] = useState(0)
  const [staleMessage, setStaleMessage] = useState<string | null>(null)
  const checkSeq = useRef(0)
  const fileSeq = useRef(0)
  /** 바코드 → 쿠팡 이름 (못 찾으면 null) — 이 창에서 이미 물어본 바코드는 다시 묻지 않는다 */
  const nameCache = useRef(new Map<string, CoupangStockName | null>())

  // ── 실행 ──
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<StockImportApplyResult | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [wroteSomething, setWroteSomething] = useState(false)

  const sheet: ExcelSheetData | null = sheets[sheetIndex] ?? null
  const headerChoices = useMemo(() => (sheet ? headerRowChoices(sheet) : []), [sheet])
  // ── 열 선택 상태: 아직 안 고른 필수 역할(안내) · 고른 열의 모순(오류) · 다음에 채울 역할 ──
  const missingRoles = useMemo(() => missingRequiredRoles(mapping, mode), [mapping, mode])
  const mappingErrors = useMemo(
    () => (sheet ? mappingConflicts(sheet, mapping, mode) : []),
    [sheet, mapping, mode],
  )
  const nextRole = useMemo(() => nextEmptyRole(mapping, mode), [mapping, mode])
  const mappingReady = !!sheet && sheet.rows.length > 0 && missingRoles.length === 0 && mappingErrors.length === 0
  const phase: ImportPhase = result ? 'done' : running ? 'running' : 'edit'

  // ═══════════════════════════════════════════════════════════════
  // 입력 바꾸기
  // ═══════════════════════════════════════════════════════════════

  /** 시트를 고르면 머리글 행을 다시 찾고 열을 다시 추측한다 */
  const applySheet = useCallback((list: ExcelSheetData[], index: number) => {
    const target = list[index]
    if (!target) return
    const memory = readMappingMemory()
    const header = detectHeaderRow(target, memory)
    setSheetIndex(index)
    setHeaderRowIndex(header)
    setMapping(guessMapping(target, header, memory))
    setStaleMessage(null)
  }, [])

  const loadFile = useCallback(async (picked: File) => {
    if (!ACCEPTED_FILE.test(picked.name)) {
      setReadError('엑셀 파일(.xlsx, .xls)만 올릴 수 있습니다.')
      return
    }
    const seq = ++fileSeq.current
    setReading(true)
    setReadError(null)
    try {
      const list = await readStockWorkbook(picked)
      if (seq !== fileSeq.current) return
      setFile({ name: picked.name, size: picked.size })
      setSheets(list)
      applySheet(list, firstSheetWithData(list))
    } catch (err) {
      if (seq !== fileSeq.current) return
      console.error('재고 엑셀 읽기 실패:', err)
      setFile(null)
      setSheets([])
      setMapping(emptyMapping())
      setReadError(errorMessage(err))
    } finally {
      if (seq === fileSeq.current) setReading(false)
    }
  }, [applySheet])

  const selectSheet = useCallback((index: number) => applySheet(sheets, index), [applySheet, sheets])

  const selectHeaderRow = useCallback((index: number) => {
    if (!sheet) return
    setHeaderRowIndex(index)
    setMapping(guessMapping(sheet, index, readMappingMemory()))
    setStaleMessage(null)
  }, [sheet])

  const setRoleColumn = useCallback((role: StockImportRole, col: number | null) => {
    setMapping(prev => ({ ...prev, [role]: col }))
    setStaleMessage(null)
  }, [])

  /** 미리 보기에서 열 누르기 — 다음 빈 역할에 지정, 이미 고른 열이면 해제 */
  const toggleColumn = useCallback((col: number) => {
    setMapping(prev => toggleColumnInMapping(prev, mode, col))
    setStaleMessage(null)
  }, [mode])

  /** 열 선택 모두 지우기 — 자동 추측이 틀렸을 때 위치부터 다시 누르도록 */
  const clearMapping = useCallback(() => {
    setMapping(emptyMapping())
    setStaleMessage(null)
  }, [])

  /** 모드를 바꿔도 파일 · 시트 · 열 선택은 그대로 — 검사만 다시 */
  const setMode = useCallback((next: StockImportMode) => {
    setModeState(next)
    setStaleMessage(null)
  }, [])

  const recheck = useCallback(() => {
    setStaleMessage(null)
    setRecheckToken(t => t + 1)
  }, [])

  // ═══════════════════════════════════════════════════════════════
  // 자동 검사
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    const seq = ++checkSeq.current
    if (!sheet || !mappingReady) {
      setCheck(IDLE_CHECK)
      return
    }
    if (!userId) {
      setCheck({ status: 'error', plan: null, error: '사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.' })
      return
    }
    setCheck(prev => ({ status: 'checking', plan: prev.plan, error: null }))

    const parsed = parseStockImportRows(sheet, headerRowIndex, mapping, mode)
    const run = async () => {
      try {
        // 처리할 행이 없으면 DB 를 읽을 필요가 없다 (오류·제외 행만 보여 준다)
        const context = parsed.rows.length > 0
          ? await StockService.loadStockImportContext(userId, parsed.rows, mode, nameCache.current)
          : { stocks: [], coupangNames: new Map<string, CoupangStockName>() }
        if (seq !== checkSeq.current) return
        setCheck({ status: 'done', plan: planStockImport(parsed, mode, context), error: null })
      } catch (err) {
        if (seq !== checkSeq.current) return
        console.error('재고 엑셀 검사 실패:', err)
        setCheck({ status: 'error', plan: null, error: `재고를 읽지 못했습니다 — ${errorMessage(err)}` })
      }
    }
    void run()
  }, [sheet, mappingReady, headerRowIndex, mapping, mode, userId, recheckToken])

  const plan = check.status === 'done' ? check.plan : null
  const opCount = plan ? plan.ops.inserts.length + plan.ops.updates.length : 0
  const canExecute = phase === 'edit' && !reading && !!plan && plan.mode === mode
    && plan.errors.length === 0 && opCount > 0

  // ═══════════════════════════════════════════════════════════════
  // 실행 — 재고를 새로 읽어 계획을 다시 만들고, 같을 때만 쓴다
  // ═══════════════════════════════════════════════════════════════
  const execute = useCallback(async () => {
    if (!canExecute || !plan || !sheet || !userId) return
    setRunning(true)
    setRunError(null)
    setStaleMessage(null)
    setProgress({ done: 0, total: opCount })
    rememberMapping(sheet, headerRowIndex, mapping, rolesForMode(mode))

    let writing = false
    try {
      const parsed = parseStockImportRows(sheet, headerRowIndex, mapping, mode)
      const context = await StockService.loadStockImportContext(userId, parsed.rows, mode, nameCache.current)
      const fresh = planStockImport(parsed, mode, context)
      if (fresh.errors.length > 0 || stockImportOpsSignature(fresh.ops) !== stockImportOpsSignature(plan.ops)) {
        checkSeq.current++   // 진행 중인 검사가 있으면 버린다
        setCheck({ status: 'done', plan: fresh, error: null })
        setStaleMessage(STALE_PLAN_MESSAGE)
        return
      }

      writing = true
      setWroteSomething(true)
      const applied = await StockService.applyStockImport(userId, fresh.ops, (done, total) => setProgress({ done, total }))
      setResult(applied)
    } catch (err) {
      console.error('재고 엑셀 실행 실패:', err)
      setRunError(writing
        ? `저장 중 오류가 났습니다 — 일부는 이미 저장됐을 수 있습니다. 닫은 뒤 목록에서 확인해 주세요. (${errorMessage(err)})`
        : `재고를 다시 읽지 못해 실행하지 않았습니다 — ${errorMessage(err)}`)
    } finally {
      setRunning(false)
    }
  }, [canExecute, plan, sheet, userId, opCount, headerRowIndex, mapping, mode])

  return {
    // 입력
    mode, setMode,
    file, reading, readError, loadFile,
    sheets, sheetIndex, sheet, selectSheet,
    headerRowIndex, headerChoices, selectHeaderRow,
    mapping, missingRoles, mappingErrors, nextRole, mappingReady, setRoleColumn, toggleColumn, clearMapping,
    // 검사
    check, staleMessage, recheck,
    // 실행
    phase, running, progress, result, runError, canExecute, opCount, execute,
    /** 닫을 때 목록을 다시 읽어야 하는지 */
    changed: wroteSomething,
  }
}

export type StockExcelImport = ReturnType<typeof useStockExcelImport>
