// ═══════════════════════════════════════════════════════════════════
// stockImportService — 재고관리 [엑셀 추가] 의 엑셀 해석 · 검사 · 계획 (순수 로직)
//   - Supabase 를 부르지 않는다. DB 조회는 StockService.loadStockImportContext,
//     DB 쓰기는 StockService.applyStockImport 가 한다.
//   - 흐름: readStockWorkbook(파일 → 시트들) → detectHeaderRow · guessMapping (자동 추측)
//           → parseStockImportRows (셀 검사) → buildStockImportPlan (재고와 맞춰 신규/수정 계획)
//   - 계획은 입력이 같으면 항상 같다 (실행 직전에 새로 읽은 재고로 다시 만들어 비교한다)
// ═══════════════════════════════════════════════════════════════════

import * as XLSX from 'xlsx'
import type { Stock } from '../types/stock'
import { readExcelIdCell } from '../utils/excelCell'

// ══════════════════════════════════════════════════════════════════
// 상수
// ══════════════════════════════════════════════════════════════════

/** 머리글 자동 찾기 · 머리글 선택지 — 시트 위에서부터 비어 있지 않은 행 이 수만큼 */
export const HEADER_SCAN_ROWS = 10
/** 머리글로 볼 최소 글자 칸 수 */
const HEADER_MIN_TEXT_CELLS = 2
/** 계획 미리 보기 줄 수 */
export const PREVIEW_OP_LIMIT = 20
/** 수량 상한 — si_stocks.qty (PostgreSQL integer) 가 담을 수 있는 최대값 */
const STOCK_QTY_MAX = 2_147_483_647
/** 수량 글자 칸 — 쉼표·공백을 뗀 뒤 이 모양이어야 숫자로 본다 ("1e3" 같은 지수 표기는 받지 않음) */
const QTY_TEXT_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)$/

// ══════════════════════════════════════════════════════════════════
// 타입
// ══════════════════════════════════════════════════════════════════

/** 추가 = 엑셀 수량을 더함(없으면 새 행) · 차감 = 엑셀 수량만큼 뺌 */
export type StockImportMode = 'add' | 'deduct'

/** 엑셀 열의 역할 */
export type StockImportRole = 'location' | 'barcode' | 'qty' | 'item_name' | 'option_name'

/** 역할 → 열 번호(시트 데이터 기준 0부터) · 고르지 않으면 null */
export type StockImportMapping = Record<StockImportRole, number | null>

/** 역할 → 기억해 둔 머리글 (정규화한 글자) */
export type StockImportMappingMemory = Partial<Record<StockImportRole, string>>

/** 시트 1개 — rows[0] 이 엑셀의 (rowOffset + 1)행, 열 0 이 (colOffset) 열 */
export interface ExcelSheetData {
  name: string
  rows: unknown[][]
  rowOffset: number
  colOffset: number
  columnCount: number
}

/** 검사에서 걸린 것 — 하나라도 있으면 실행할 수 없다 */
export interface StockImportError {
  rowNumbers: number[]      // 엑셀 행 번호 (열 선택 오류처럼 행과 무관하면 [])
  column: string | null     // 엑셀 열 문자 (A, B, …)
  value: string             // 문제가 된 값 (표시용)
  reason: string
}

/** 셀 검사를 통과한 엑셀 행 (수량 > 0) */
export interface StockImportRow {
  rowNumber: number
  location: string
  barcode: string
  qty: number
  item_name: string | null
  option_name: string | null
}

/** 셀 검사 결과 */
export interface ParsedStockImport {
  rows: StockImportRow[]
  errors: StockImportError[]
  zeroQtyRows: number[]     // 수량 0 → 제외
  blankRowCount: number     // 고른 칸이 모두 빈 행 → 건너뜀
}

/** 쿠팡 상품관리(si_coupang_items)의 바코드별 이름 */
export interface CoupangStockName {
  item_name: string
  option_name: string | null
}

/** 계획에 필요한 DB 값 — StockService.loadStockImportContext 가 만든다 */
export interface StockImportContext {
  stocks: Stock[]                                       // 이 계정의 재고 전체
  coupangNames: ReadonlyMap<string, CoupangStockName>   // 신규 행 바코드 → 쿠팡 이름 (추가 모드만)
}

/** 신규 행 이름의 출처 — ① 쿠팡 ② 기존 재고(다른 위치) ③ 엑셀 ④ 없음 */
export type StockNameSource = 'coupang' | 'stock' | 'excel' | 'none'

export interface StockImportInsert {
  key: string
  location: string
  barcode: string
  item_name: string | null
  option_name: string | null
  qty: number
  nameSource: StockNameSource
  rowNumbers: number[]
}

export interface StockImportUpdate {
  key: string
  id: string
  location: string | null
  barcode: string
  item_name: string | null
  option_name: string | null
  currentQty: number
  nextQty: number
  rowNumbers: number[]
}

export interface StockImportOps {
  inserts: StockImportInsert[]
  updates: StockImportUpdate[]
}

export interface StockImportMergedKey {
  location: string
  barcode: string
  rowNumbers: number[]
}

/** 실행을 막지 않는 안내 */
export interface StockImportNotices {
  zeroQtyRows: number[]
  blankRowCount: number
  mergedKeys: StockImportMergedKey[]   // 같은 (위치 + 바코드) 가 여러 행 → 합산
  unnamedInserts: number               // 추가: 이름을 정하지 못한 신규 행
  duplicateStockKeys: number           // 재고에 같은 (위치 + 바코드) 행이 여러 개 → id 가 가장 앞선 행만 고친다
}

export interface StockImportStats {
  processRows: number      // 처리할 엑셀 행 (수량 > 0, 오류 없음)
  insertCount: number
  updateCount: number
  totalQty: number
  excludedRows: number     // 수량 0 으로 뺀 행
  nameSources: Record<StockNameSource, number>
}

export interface StockImportPreviewRow {
  kind: 'insert' | 'update'
  rowNumber: number
  location: string | null
  barcode: string
  item_name: string | null
  option_name: string | null
  currentQty: number
  nextQty: number
}

export interface StockImportPlan {
  mode: StockImportMode
  errors: StockImportError[]
  notices: StockImportNotices
  ops: StockImportOps
  stats: StockImportStats
  preview: StockImportPreviewRow[]
}

// ══════════════════════════════════════════════════════════════════
// 역할 정의 (이름 · 필수 여부 · 머리글 별칭)
// ══════════════════════════════════════════════════════════════════

export const STOCK_IMPORT_ROLES: readonly StockImportRole[] = ['location', 'barcode', 'qty', 'item_name', 'option_name']

export const STOCK_IMPORT_ROLE_LABELS: Record<StockImportRole, string> = {
  location: '위치',
  barcode: '바코드',
  qty: '수량',
  item_name: '상품명',
  option_name: '옵션명',
}

const REQUIRED_ROLES: ReadonlySet<StockImportRole> = new Set(['location', 'barcode', 'qty'])

export const isRequiredRole = (role: StockImportRole) => REQUIRED_ROLES.has(role)

/** 모드에서 쓰는 역할 — 차감은 이름을 쓰지 않는다 */
export const rolesForMode = (mode: StockImportMode): StockImportRole[] =>
  mode === 'add' ? [...STOCK_IMPORT_ROLES] : STOCK_IMPORT_ROLES.filter(isRequiredRole)

/** 머리글 별칭 (정규화한 글자 — 소문자 · 공백 없음). 앞의 것부터 맞춰 본다 */
const ROLE_ALIASES: Record<StockImportRole, readonly string[]> = {
  location: ['로케이션', '위치', 'location', 'loc'],
  barcode: ['바코드', 'barcode', '상품바코드'],
  qty: ['수량', '개수', 'qty', '재고', '재고수량'],
  item_name: ['상품명', '등록상품명', '노출상품명', 'item_name', '상품'],
  option_name: ['옵션명', '옵션', 'option_name'],
}

export const emptyMapping = (): StockImportMapping =>
  ({ location: null, barcode: null, qty: null, item_name: null, option_name: null })

// ══════════════════════════════════════════════════════════════════
// 공용 작은 함수
// ══════════════════════════════════════════════════════════════════

/** (로케이션 + 바코드) 재고 키 — 엑셀 행과 재고 행을 같은 규칙으로 맞춘다 */
export const stockKeyOf = (location: string | null | undefined, barcode: string | null | undefined) =>
  `${(location ?? '').trim()}|${(barcode ?? '').trim()}`

/** 머리글 비교용 — 소문자 · 공백 제거 */
export const normalizeHeaderText = (v: unknown) => String(v ?? '').toLowerCase().replace(/\s+/g, '')

export const isBlankCell = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '')

const isBlankRow = (row: readonly unknown[] | undefined) => !row || row.every(isBlankCell)

/** 표시용 셀 글자 */
export const cellText = (v: unknown): string => (v == null ? '' : String(v))

/** 시트 데이터의 열 번호 → 엑셀 열 문자 */
export const columnLetter = (sheet: ExcelSheetData, col: number) => XLSX.utils.encode_col(sheet.colOffset + col)

/** 시트 데이터의 행 번호 → 엑셀 행 번호 */
export const excelRowNumber = (sheet: ExcelSheetData, rowIndex: number) => sheet.rowOffset + rowIndex + 1

/** id 비교 — 같은 키가 여럿일 때 늘 같은 행을 고르기 위해 (숫자 글자는 숫자 크기 순) */
export const compareIdText = (a: string, b: string) => {
  const digits = /^\d+$/
  if (digits.test(a) && digits.test(b) && a.length !== b.length) return a.length - b.length
  return a < b ? -1 : a > b ? 1 : 0
}

// ══════════════════════════════════════════════════════════════════
// 1) 엑셀 읽기 — 모든 시트를 raw 값 배열로
// ══════════════════════════════════════════════════════════════════

/**
 * 실제로 값이 있는 칸의 범위.
 * 서식만 있는 칸 때문에 !ref 가 A1:XFD1048576 처럼 커진 파일도 있어 !ref 를 그대로 쓰지 않는다.
 */
function usedRange(ws: XLSX.WorkSheet): XLSX.Range | null {
  let range: XLSX.Range | null = null
  for (const addr of Object.keys(ws)) {
    if (addr.startsWith('!')) continue
    const cell = ws[addr] as XLSX.CellObject | undefined
    if (!cell || cell.t === 'z' || cell.v == null) continue
    const { r, c } = XLSX.utils.decode_cell(addr)
    if (!range) {
      range = { s: { r, c }, e: { r, c } }
      continue
    }
    range.s.r = Math.min(range.s.r, r)
    range.s.c = Math.min(range.s.c, c)
    range.e.r = Math.max(range.e.r, r)
    range.e.c = Math.max(range.e.c, c)
  }
  return range
}

/** 워크시트 → 시트 데이터 (raw 값 · 빈 칸 null · 빈 행 유지 — 행 번호가 엑셀과 맞도록) */
function toSheetData(name: string, ws: XLSX.WorkSheet | undefined): ExcelSheetData {
  const range = ws ? usedRange(ws) : null
  if (!ws || !range) return { name, rows: [], rowOffset: 0, colOffset: 0, columnCount: 0 }

  const columnCount = range.e.c - range.s.c + 1
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
    range,
  })
  // 칸 수를 맞춰 둔다 (뒤쪽 빈 칸이 잘린 행이 있어도 열 번호가 어긋나지 않게)
  const rows = raw.map(row => Array.from({ length: columnCount }, (_, i) => row?.[i] ?? null))
  return { name, rows, rowOffset: range.s.r, colOffset: range.s.c, columnCount }
}

/** 엑셀 바이트 → 시트들 */
export function parseStockWorkbook(data: ArrayBuffer): ExcelSheetData[] {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(data, { type: 'array' })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`엑셀 파일을 읽지 못했습니다 — 손상되었거나 암호가 걸린 파일인지 확인해 주세요 (${detail})`)
  }
  if (wb.SheetNames.length === 0) throw new Error('엑셀 파일에 시트가 없습니다')
  return wb.SheetNames.map(name => toSheetData(name, wb.Sheets[name]))
}

/** 파일 → 시트들 */
export async function readStockWorkbook(file: File): Promise<ExcelSheetData[]> {
  return parseStockWorkbook(await file.arrayBuffer())
}

/** 처음 고를 시트 — 값이 있는 첫 시트 (없으면 0) */
export function firstSheetWithData(sheets: readonly ExcelSheetData[]): number {
  const idx = sheets.findIndex(s => s.rows.some(row => !isBlankRow(row)))
  return idx >= 0 ? idx : 0
}

// ══════════════════════════════════════════════════════════════════
// 2) 머리글 행 · 열 자동 추측
// ══════════════════════════════════════════════════════════════════

/** 머리글 선택지 — 비어 있지 않은 앞쪽 행 (시트 데이터 행 번호) */
export function headerRowChoices(sheet: ExcelSheetData): number[] {
  const out: number[] = []
  for (let i = 0; i < sheet.rows.length && out.length < HEADER_SCAN_ROWS; i++) {
    if (!isBlankRow(sheet.rows[i])) out.push(i)
  }
  return out
}

/**
 * 머리글 행 — 앞쪽 비어 있지 않은 행 중 열 자동 추측이 가장 많이 맞는 행 (같으면 위쪽).
 * 쿠팡 양식처럼 '상품기본정보 · 구매옵션정보' 같은 묶음 머리글이 실제 머리글 위에 있어도
 * 아래 행을 고르기 위해서다. 맞는 행이 하나도 없으면 글자 칸이 2개 이상인 첫 행
 * (그것도 없으면 첫 비어 있지 않은 행).
 */
export function detectHeaderRow(sheet: ExcelSheetData, memory: StockImportMappingMemory = {}): number {
  const choices = headerRowChoices(sheet)
  let best = -1
  let bestScore = 0
  for (const i of choices) {
    const mapping = guessMapping(sheet, i, memory)
    const score = STOCK_IMPORT_ROLES.filter(role => mapping[role] !== null).length
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  }
  if (best >= 0) return best

  const found = choices.find(i =>
    sheet.rows[i].filter(v => typeof v === 'string' && v.trim() !== '').length >= HEADER_MIN_TEXT_CELLS)
  return found ?? choices[0] ?? 0
}

/** 머리글 칸 글자 (정규화) */
export function headerTexts(sheet: ExcelSheetData, headerRowIndex: number): string[] {
  const row = sheet.rows[headerRowIndex] ?? []
  return Array.from({ length: sheet.columnCount }, (_, i) => normalizeHeaderText(row[i]))
}

/** 영문 별칭 (loc · qty …) — 'clock' 같은 다른 낱말 안에 들어 있을 수 있어 같은 글자만 맞춘다 */
const ASCII_ALIAS = /^[a-z0-9_]+$/
/** 이보다 짧은 한글 별칭은 머리글 '끝'에 있을 때만 맞춘다 */
const ALIAS_CONTAINS_MIN_LENGTH = 3

/**
 * 머리글이 별칭을 '포함'하는지 — 짧은 별칭이 묶음 머리글에 걸리지 않게 규칙을 나눈다.
 *   - 영문: 같은 글자만
 *   - 한글 3자 이상(상품명 · 옵션명 · 로케이션 …): 어디든 포함 ('등록상품명' ⊃ '상품명')
 *   - 한글 2자(위치 · 수량 · 상품 · 옵션 …): 끝에 올 때만 ('보관위치' · '입고수량' 은 맞고,
 *     '상품기본정보' · '구매옵션정보' 는 안 맞는다)
 */
function headerContainsAlias(header: string, alias: string): boolean {
  if (ASCII_ALIAS.test(alias)) return header === alias
  if (alias.length >= ALIAS_CONTAINS_MIN_LENGTH) return header.includes(alias)
  return header.endsWith(alias)
}

/**
 * 열 자동 추측 — ① 지난번에 고른 머리글 ② 별칭과 같은 머리글 ③ 별칭을 포함한 머리글
 * (headerContainsAlias). 한 열은 한 역할에만 준다.
 */
export function guessMapping(
  sheet: ExcelSheetData,
  headerRowIndex: number,
  memory: StockImportMappingMemory = {},
): StockImportMapping {
  const headers = headerTexts(sheet, headerRowIndex)
  const mapping = emptyMapping()
  const used = new Set<number>()
  const tryAssign = (role: StockImportRole, match: (h: string) => boolean) => {
    if (mapping[role] !== null) return
    const idx = headers.findIndex((h, i) => h !== '' && !used.has(i) && match(h))
    if (idx >= 0) {
      mapping[role] = idx
      used.add(idx)
    }
  }

  // ── ① 기억해 둔 머리글 ──
  for (const role of STOCK_IMPORT_ROLES) {
    const want = memory[role]
    if (want) tryAssign(role, h => h === want)
  }
  // ── ② 같은 글자 ──
  for (const role of STOCK_IMPORT_ROLES) {
    for (const alias of ROLE_ALIASES[role]) tryAssign(role, h => h === alias)
  }
  // ── ③ 포함 ──
  for (const role of STOCK_IMPORT_ROLES) {
    for (const alias of ROLE_ALIASES[role]) tryAssign(role, h => headerContainsAlias(h, alias))
  }
  return mapping
}

// ── 미리 보기에서 열을 눌러 고르기 ──────────────────────────────────

/** 다음에 채울 역할 — 이 모드의 역할 순서(위치 → 바코드 → 수량 → 상품명 → 옵션명)에서 첫 빈 역할 */
export function nextEmptyRole(mapping: StockImportMapping, mode: StockImportMode): StockImportRole | null {
  return rolesForMode(mode).find(role => mapping[role] === null) ?? null
}

/**
 * 열 하나를 눌렀을 때의 새 선택.
 *   - 이 모드의 역할에 이미 쓰인 열 → 그 역할을 비운다 (다시 누르면 해제)
 *   - 아니면 → 다음 빈 역할에 준다. 빈 역할이 없으면 그대로.
 *     이 모드에서 안 보이는 역할(차감 중의 상품명 · 옵션명)이 같은 열을 갖고 있으면 그 역할은 비운다
 *     — 추가로 돌아갔을 때 한 열이 두 역할에 겹치지 않게.
 */
export function toggleColumnInMapping(
  mapping: StockImportMapping,
  mode: StockImportMode,
  col: number,
): StockImportMapping {
  const visible = rolesForMode(mode)
  const assigned = visible.filter(role => mapping[role] === col)
  const next = { ...mapping }
  if (assigned.length > 0) {
    for (const role of assigned) next[role] = null
    return next
  }

  const target = nextEmptyRole(mapping, mode)
  if (!target) return mapping
  for (const role of STOCK_IMPORT_ROLES) {
    if (next[role] === col) next[role] = null
  }
  next[target] = col
  return next
}

// ══════════════════════════════════════════════════════════════════
// 3) 셀 검사
// ══════════════════════════════════════════════════════════════════

/** 아직 고르지 않은 필수 역할 (이 모드의 순서대로) */
export const missingRequiredRoles = (mapping: StockImportMapping, mode: StockImportMode): StockImportRole[] =>
  rolesForMode(mode).filter(role => isRequiredRole(role) && mapping[role] === null)

/** 열 선택 오류 — 필수 역할 빠짐 + mappingConflicts */
export function validateMapping(
  sheet: ExcelSheetData,
  mapping: StockImportMapping,
  mode: StockImportMode,
): StockImportError[] {
  const missing: StockImportError[] = missingRequiredRoles(mapping, mode).map(role => ({
    rowNumbers: [], column: null, value: '', reason: `'${STOCK_IMPORT_ROLE_LABELS[role]}' 열을 골라 주세요`,
  }))
  return [...missing, ...mappingConflicts(sheet, mapping, mode)]
}

/** 고른 열의 모순 — 한 열을 두 역할에 · 시트 범위 밖 (아직 안 고른 것은 여기서 보지 않는다) */
export function mappingConflicts(
  sheet: ExcelSheetData,
  mapping: StockImportMapping,
  mode: StockImportMode,
): StockImportError[] {
  const errors: StockImportError[] = []
  const byColumn = new Map<number, StockImportRole[]>()

  for (const role of rolesForMode(mode)) {
    const col = mapping[role]
    if (col === null) continue
    if (col < 0 || col >= sheet.columnCount) {
      errors.push({ rowNumbers: [], column: null, value: '', reason: `'${STOCK_IMPORT_ROLE_LABELS[role]}' 열이 시트 범위를 벗어났습니다` })
      continue
    }
    byColumn.set(col, [...(byColumn.get(col) ?? []), role])
  }
  for (const [col, list] of byColumn) {
    if (list.length < 2) continue
    errors.push({
      rowNumbers: [],
      column: columnLetter(sheet, col),
      value: '',
      reason: `같은 열을 ${list.map(r => `'${STOCK_IMPORT_ROLE_LABELS[r]}'`).join(' · ')}에 함께 골랐습니다`,
    })
  }
  return errors
}

/** 위치 · 이름 칸 → 글자 (숫자 칸은 그대로 글자로) */
const readTextCell = (v: unknown): string => (v == null ? '' : String(v).trim())

/** 수량 칸 → 0 이상의 정수 */
function readQtyCell(v: unknown): { value: number | null; error: string | null } {
  if (isBlankCell(v)) return { value: null, error: '수량이 비어 있습니다' }
  let n: number
  if (typeof v === 'number') {
    n = v
  } else if (typeof v === 'string') {
    const text = v.replace(/[,\s]/g, '')
    if (!QTY_TEXT_PATTERN.test(text)) return { value: null, error: '수량이 숫자가 아닙니다' }
    n = Number(text)
  } else {
    return { value: null, error: '수량이 숫자가 아닙니다' }
  }
  if (!Number.isFinite(n)) return { value: null, error: '수량이 숫자가 아닙니다' }
  if (!Number.isInteger(n)) return { value: null, error: '수량이 정수가 아닙니다' }
  if (n < 0) return { value: null, error: '수량이 음수입니다' }
  if (n > STOCK_QTY_MAX) return { value: null, error: '수량이 너무 큽니다' }
  return { value: n === 0 ? 0 : n, error: null }   // -0 → 0
}

/** 머리글 아래 행들을 검사해 처리할 행 · 오류 · 제외 행으로 나눈다 */
export function parseStockImportRows(
  sheet: ExcelSheetData,
  headerRowIndex: number,
  mapping: StockImportMapping,
  mode: StockImportMode,
): ParsedStockImport {
  const result: ParsedStockImport = { rows: [], errors: [], zeroQtyRows: [], blankRowCount: 0 }

  const mappingErrors = validateMapping(sheet, mapping, mode)
  if (mappingErrors.length > 0) {
    result.errors = mappingErrors
    return result
  }

  const roles = rolesForMode(mode)
  const letter = (role: StockImportRole) => columnLetter(sheet, mapping[role] as number)
  const useNames = mode === 'add'

  for (let r = headerRowIndex + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r]
    const cell = (role: StockImportRole): unknown => {
      const col = mapping[role]
      return col === null ? null : row[col] ?? null
    }
    if (roles.every(role => isBlankCell(cell(role)))) {
      result.blankRowCount++
      continue
    }

    const rowNumber = excelRowNumber(sheet, r)
    const rowErrors: StockImportError[] = []
    const fail = (role: StockImportRole, reason: string) =>
      rowErrors.push({ rowNumbers: [rowNumber], column: letter(role), value: cellText(cell(role)), reason })

    // ── 위치 ──
    const location = readTextCell(cell('location'))
    if (!location) fail('location', '위치가 비어 있습니다')

    // ── 바코드 (숫자 칸은 15자리 이내 정수만) ──
    const barcodeCell = readExcelIdCell(cell('barcode'))
    if (barcodeCell.error) fail('barcode', barcodeCell.error)
    else if (!barcodeCell.value) fail('barcode', '바코드가 비어 있습니다')

    // ── 수량 ──
    const qtyCell = readQtyCell(cell('qty'))
    if (qtyCell.error) fail('qty', qtyCell.error)

    if (rowErrors.length > 0) {
      result.errors.push(...rowErrors)
      continue
    }
    if (qtyCell.value === 0) {
      result.zeroQtyRows.push(rowNumber)
      continue
    }

    result.rows.push({
      rowNumber,
      location,
      barcode: barcodeCell.value,
      qty: qtyCell.value as number,
      item_name: useNames ? readTextCell(cell('item_name')) || null : null,
      option_name: useNames ? readTextCell(cell('option_name')) || null : null,
    })
  }

  if (result.rows.length + result.errors.length + result.zeroQtyRows.length === 0) {
    result.errors.push({ rowNumbers: [], column: null, value: '', reason: '머리글 아래에 데이터 행이 없습니다' })
  }
  return result
}

// ══════════════════════════════════════════════════════════════════
// 4) 계획 — 재고와 맞춰 신규 / 수정
// ══════════════════════════════════════════════════════════════════

/** 같은 (위치 + 바코드) 엑셀 행 묶음 */
interface RowGroup {
  key: string
  location: string
  barcode: string
  qty: number
  rowNumbers: number[]
  item_name: string | null
  option_name: string | null
}

function groupRows(rows: readonly StockImportRow[]): RowGroup[] {
  const groups = new Map<string, RowGroup>()
  for (const row of rows) {
    const key = stockKeyOf(row.location, row.barcode)
    const group = groups.get(key)
    if (!group) {
      groups.set(key, {
        key, location: row.location, barcode: row.barcode, qty: row.qty, rowNumbers: [row.rowNumber],
        item_name: row.item_name, option_name: row.option_name,
      })
      continue
    }
    group.qty += row.qty
    group.rowNumbers.push(row.rowNumber)
    // 엑셀 이름은 상품명이 있는 첫 행 것을 쓴다
    if (!group.item_name && row.item_name) {
      group.item_name = row.item_name
      group.option_name = row.option_name
    }
  }
  return Array.from(groups.values())
}

/** 재고 색인 — (위치 + 바코드) → 행 · 바코드 → 이름. 겹치면 id 가 앞선 행 */
function indexStocks(stocks: readonly Stock[]) {
  const sorted = [...stocks].sort((a, b) => compareIdText(String(a.id), String(b.id)))
  const byKey = new Map<string, Stock>()
  const nameByBarcode = new Map<string, { item_name: string; option_name: string | null }>()
  const duplicateKeys = new Set<string>()
  for (const stock of sorted) {
    const key = stockKeyOf(stock.location, stock.barcode)
    if (byKey.has(key)) duplicateKeys.add(key)
    else byKey.set(key, stock)
    const barcode = (stock.barcode ?? '').trim()
    const itemName = (stock.item_name ?? '').trim()
    if (barcode && itemName && !nameByBarcode.has(barcode)) {
      nameByBarcode.set(barcode, { item_name: stock.item_name as string, option_name: stock.option_name ?? null })
    }
  }
  return { byKey, nameByBarcode, duplicateKeys }
}

/** 추가 모드에서 재고에 없는 (위치 + 바코드) 의 바코드 — 쿠팡 이름을 찾아야 하는 것 */
export function collectNewBarcodes(rows: readonly StockImportRow[], stocks: readonly Stock[]): string[] {
  const existing = new Set(stocks.map(s => stockKeyOf(s.location, s.barcode)))
  const out = new Set<string>()
  for (const row of rows) {
    if (!existing.has(stockKeyOf(row.location, row.barcode))) out.add(row.barcode)
  }
  return Array.from(out)
}

/** 셀 검사 결과 + 재고 → 계획 */
export function planStockImport(
  parsed: ParsedStockImport,
  mode: StockImportMode,
  context: StockImportContext,
): StockImportPlan {
  const errors: StockImportError[] = [...parsed.errors]
  const ops: StockImportOps = { inserts: [], updates: [] }
  const nameSources: Record<StockNameSource, number> = { coupang: 0, stock: 0, excel: 0, none: 0 }
  const groups = groupRows(parsed.rows)
  const { byKey, nameByBarcode, duplicateKeys } = indexStocks(context.stocks)
  const touchedDuplicateKeys = new Set<string>()

  for (const g of groups) {
    const found = byKey.get(g.key)
    if (found && duplicateKeys.has(g.key)) touchedDuplicateKeys.add(g.key)
    const currentQty = found?.qty ?? 0

    // ── 차감 ──
    if (mode === 'deduct') {
      if (!found) {
        errors.push({ rowNumbers: g.rowNumbers, column: null, value: `${g.location} · ${g.barcode}`, reason: '재고에 없음 (위치 + 바코드)' })
        continue
      }
      if (currentQty < g.qty) {
        errors.push({
          rowNumbers: g.rowNumbers, column: null, value: `${g.location} · ${g.barcode}`,
          reason: `재고 부족 (현재 ${currentQty.toLocaleString()} · 요청 합계 ${g.qty.toLocaleString()})`,
        })
        continue
      }
      ops.updates.push(toUpdate(g, found, currentQty - g.qty))
      continue
    }

    // ── 추가: 기존 행 → 수량만 더함 (이름은 그대로) ──
    if (found) {
      const nextQty = currentQty + g.qty
      if (nextQty > STOCK_QTY_MAX) {
        errors.push({ rowNumbers: g.rowNumbers, column: null, value: `${g.location} · ${g.barcode}`, reason: '더한 수량이 너무 큽니다' })
        continue
      }
      ops.updates.push(toUpdate(g, found, nextQty))
      continue
    }

    // ── 추가: 신규 행 → 이름 ① 쿠팡 ② 기존 재고(다른 위치) ③ 엑셀 ④ 없음 ──
    const coupang = context.coupangNames.get(g.barcode)
    const fromStock = nameByBarcode.get(g.barcode)
    let name: { item_name: string | null; option_name: string | null }
    let nameSource: StockNameSource
    if (coupang && coupang.item_name.trim()) {
      name = coupang
      nameSource = 'coupang'
    } else if (fromStock) {
      name = fromStock
      nameSource = 'stock'
    } else if (g.item_name) {
      name = { item_name: g.item_name, option_name: g.option_name }
      nameSource = 'excel'
    } else {
      name = { item_name: null, option_name: g.option_name }
      nameSource = 'none'
    }
    nameSources[nameSource]++
    ops.inserts.push({
      key: g.key, location: g.location, barcode: g.barcode,
      item_name: name.item_name, option_name: name.option_name,
      qty: g.qty, nameSource, rowNumbers: g.rowNumbers,
    })
  }

  // ── 미리 보기: 엑셀 행 순서대로 앞 PREVIEW_OP_LIMIT 개 ──
  const preview: StockImportPreviewRow[] = [
    ...ops.inserts.map(op => ({
      kind: 'insert' as const, rowNumber: op.rowNumbers[0], location: op.location, barcode: op.barcode,
      item_name: op.item_name, option_name: op.option_name, currentQty: 0, nextQty: op.qty,
    })),
    ...ops.updates.map(op => ({
      kind: 'update' as const, rowNumber: op.rowNumbers[0], location: op.location, barcode: op.barcode,
      item_name: op.item_name, option_name: op.option_name, currentQty: op.currentQty, nextQty: op.nextQty,
    })),
  ].sort((a, b) => a.rowNumber - b.rowNumber).slice(0, PREVIEW_OP_LIMIT)

  // 오류는 엑셀 행 순서로 (행과 무관한 것이 먼저)
  errors.sort((a, b) => (a.rowNumbers[0] ?? 0) - (b.rowNumbers[0] ?? 0))

  return {
    mode,
    errors,
    notices: {
      zeroQtyRows: parsed.zeroQtyRows,
      blankRowCount: parsed.blankRowCount,
      mergedKeys: groups
        .filter(g => g.rowNumbers.length > 1)
        .map(g => ({ location: g.location, barcode: g.barcode, rowNumbers: g.rowNumbers })),
      unnamedInserts: nameSources.none,
      duplicateStockKeys: touchedDuplicateKeys.size,
    },
    ops,
    stats: {
      processRows: parsed.rows.length,
      insertCount: ops.inserts.length,
      updateCount: ops.updates.length,
      totalQty: parsed.rows.reduce((sum, r) => sum + r.qty, 0),
      excludedRows: parsed.zeroQtyRows.length,
      nameSources,
    },
    preview,
  }
}

function toUpdate(g: RowGroup, found: Stock, nextQty: number): StockImportUpdate {
  return {
    key: g.key, id: found.id, location: found.location, barcode: found.barcode,
    item_name: found.item_name, option_name: found.option_name,
    currentQty: found.qty ?? 0, nextQty, rowNumbers: g.rowNumbers,
  }
}

/** 시트 · 머리글 · 열 선택 · 모드 · 재고 → 계획 (셀 검사 + 계획 한 번에) */
export function buildStockImportPlan(
  sheet: ExcelSheetData,
  headerRowIndex: number,
  mapping: StockImportMapping,
  mode: StockImportMode,
  context: StockImportContext,
): StockImportPlan {
  return planStockImport(parseStockImportRows(sheet, headerRowIndex, mapping, mode), mode, context)
}

/**
 * 계획의 작업 목록 서명 — 실행 직전에 새로 읽은 재고로 만든 계획과 비교한다.
 * 수정은 id · 현재 수량 · 바뀔 수량, 신규는 키 · 수량 · 이름이 같아야 같은 계획이다.
 */
export function stockImportOpsSignature(ops: StockImportOps): string {
  const lines = [
    ...ops.inserts.map(op => JSON.stringify(['I', op.key, op.qty, op.item_name, op.option_name])),
    ...ops.updates.map(op => JSON.stringify(['U', op.id, op.currentQty, op.nextQty])),
  ]
  return lines.sort().join('\n')
}
