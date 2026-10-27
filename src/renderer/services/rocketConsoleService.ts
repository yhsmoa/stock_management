/* ================================================================
   로켓그로스 콘솔 (RocketConsole) — 서비스
   - 쿠팡윙 로켓그로스 입고 화면에 붙여넣을 콘솔 스크립트를 만든다.
   - 엑셀은 한 번만 해석(parseInboundExcel)하고, 보드(단계)마다 그 결과로
     스크립트를 만든다.
       · 1단계 상품 선택        — buildSelectProductsScript
       · 2단계 상품 확인·수량 입력 — buildInputQuantitiesScript
   - 스크립트 본문은 rocketConsoleScripts/*.console.js 템플릿 원문 그대로이고,
     @@자리표시@@ 만 바꾼다. 쿠팡윙 화면이 바뀌어 스크립트를 고칠 때는
     템플릿 파일만 고친다 (자리표시는 남겨 둘 것).
   - 엑셀 양식: 쿠팡윙 [로켓그로스 입고] 다운로드 파일
     (시트 '로켓그로스 입고', 3행 머리글 · 4행 예시 · 5행부터 데이터)
   ================================================================ */

import * as XLSX from 'xlsx'
import selectProductsTemplate from './rocketConsoleScripts/selectProducts.console.js?raw'
import inputQuantitiesTemplate from './rocketConsoleScripts/inputQuantities.console.js?raw'

// ══════════════════════════════════════════════════════════════════
// 엑셀 해석
// ══════════════════════════════════════════════════════════════════

// ── 양식 상수 ─────────────────────────────────────────────────────
const INBOUND_SHEET_NAME = '로켓그로스 입고'
const HEADER_SCAN_ROWS = 20                 // 머리글을 찾을 최대 행 수
const OPTION_ID_PATTERN = /^\d+$/           // 쿠팡 옵션 ID = 숫자만
const EXAMPLE_ROW_PREFIX = '예시'           // '예시 및 설명' 행 (No. 칸)

/** 머리글 이름 — 줄바꿈·공백을 지우고 비교. prefix 는 앞부분 일치 */
const HEADERS = {
  no:         { name: 'No.',       prefix: false },
  itemName:   { name: '등록상품명', prefix: false },
  optionName: { name: '옵션명',     prefix: false },
  optionId:   { name: '옵션 ID',    prefix: false },
  qty:        { name: '입고 수량',  prefix: true  },   // '입고 수량 입력\n(필수)'
} as const
type HeaderKey = keyof typeof HEADERS
const REQUIRED_HEADERS: HeaderKey[] = ['optionId', 'qty']

const normalizeHeader = (v: unknown): string => String(v ?? '').replace(/\s+/g, '')
const cellText = (v: unknown): string => String(v ?? '').trim()

/** 엑셀 셀 → 숫자 ID 문자열 (정수가 아니면 null) */
function cellToId(v: unknown): string | null {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : null
  const s = cellText(v)
  return OPTION_ID_PATTERN.test(s) ? s : null
}

/** 엑셀 셀 → 양의 정수 수량 (아니면 null) */
function cellToQty(v: unknown): number | null {
  const s = cellText(v)
  if (s === '') return null
  const n = Number(s)
  return Number.isInteger(n) && n > 0 ? n : null
}

// ── 타입 ──────────────────────────────────────────────────────────

/** 입고 엑셀 1행 (스크립트에 들어가는 값) */
export interface InboundRow {
  no: number              // 엑셀 No. (없으면 순번)
  optionId: string
  itemName: string        // 등록상품명
  optionName: string      // 옵션명
  qty: number             // 입고 수량 (양의 정수)
  excelRow: number        // 엑셀 행 번호 (1부터) — 안내용
}

/** 엑셀에서 뺀 행 */
export interface SkippedRow {
  excelRow: number
  optionId: string        // 옵션 ID 가 무효면 셀 원문
  reason: string
}

export interface InboundExcel {
  fileName: string
  rows: InboundRow[]              // 유효 행 · 옵션 ID 중복 제거(첫 행 유지) · 엑셀 순서
  duplicateIds: string[]          // 두 번 이상 나온 옵션 ID
  skippedRows: SkippedRow[]       // 옵션 ID 또는 입고 수량이 잘못돼 뺀 행
  totalQty: number
}

/** 파일 → 입고 시트 2차원 배열 (시트명이 다르면 첫 시트) */
async function readInboundSheet(file: File): Promise<unknown[][]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames.includes(INBOUND_SHEET_NAME) ? INBOUND_SHEET_NAME : wb.SheetNames[0]
  if (!sheetName) throw new Error('엑셀에 시트가 없습니다.')
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: '', raw: true })
}

/** 머리글 행 · 열 위치 찾기 ('옵션 ID' 칸이 있는 첫 행) */
function findHeader(rows: unknown[][]): { headerIdx: number; col: Record<HeaderKey, number> } {
  const target = normalizeHeader(HEADERS.optionId.name)
  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN_ROWS); i++) {
    if (!rows[i].some((c) => normalizeHeader(c) === target)) continue
    const cells = rows[i].map(normalizeHeader)
    const col = {} as Record<HeaderKey, number>
    for (const key of Object.keys(HEADERS) as HeaderKey[]) {
      const { name, prefix } = HEADERS[key]
      const h = normalizeHeader(name)
      col[key] = cells.findIndex((c) => (prefix ? c.startsWith(h) : c === h))
    }
    const missing = REQUIRED_HEADERS.filter((k) => col[k] < 0).map((k) => `'${HEADERS[k].name}'`)
    if (missing.length) throw new Error(`${missing.join(', ')} 머리글이 없습니다. 쿠팡윙 로켓그로스 입고 엑셀인지 확인해 주세요.`)
    return { headerIdx: i, col }
  }
  throw new Error(`'${HEADERS.optionId.name}' 머리글을 찾지 못했습니다. 쿠팡윙 로켓그로스 입고 엑셀인지 확인해 주세요.`)
}

/**
 * 입고 엑셀 해석
 * - 데이터 행: 머리글 아래, 빈 행과 '예시 및 설명' 행 제외
 * - 옵션 ID 가 숫자가 아니거나 입고 수량이 양의 정수가 아닌 행은 뺀다(skippedRows).
 *   두 단계 스크립트가 같은 상품 목록을 써야 2단계 검사(엑셀 ↔ 화면)가 맞기 때문에
 *   한 단계에서만 빼지 않고 여기서 함께 뺀다.
 * - 같은 옵션 ID 가 다시 나오면 첫 행만 쓰고 duplicateIds 에 남긴다.
 */
export async function parseInboundExcel(file: File): Promise<InboundExcel> {
  const sheet = await readInboundSheet(file)
  const { headerIdx, col } = findHeader(sheet)
  const get = (row: unknown[], key: HeaderKey): unknown => (col[key] >= 0 ? row[col[key]] : '')

  const rows: InboundRow[] = []
  const skippedRows: SkippedRow[] = []
  const seen = new Set<string>()
  const dup = new Set<string>()

  for (let i = headerIdx + 1; i < sheet.length; i++) {
    const row = sheet[i]
    if (row.every((c) => cellText(c) === '')) continue
    if (cellText(row[0]).startsWith(EXAMPLE_ROW_PREFIX)) continue

    const excelRow = i + 1
    const optionId = cellToId(get(row, 'optionId'))
    if (!optionId) {
      skippedRows.push({ excelRow, optionId: cellText(get(row, 'optionId')), reason: '옵션 ID 가 숫자가 아님' })
      continue
    }
    const qty = cellToQty(get(row, 'qty'))
    if (qty === null) {
      const raw = cellText(get(row, 'qty'))
      skippedRows.push({ excelRow, optionId, reason: raw === '' ? '입고 수량 비어 있음' : `입고 수량 "${raw}"` })
      continue
    }
    if (seen.has(optionId)) { dup.add(optionId); continue }
    seen.add(optionId)

    const noCell = Number(cellText(get(row, 'no')))
    rows.push({
      no: Number.isInteger(noCell) && noCell > 0 ? noCell : rows.length + 1,
      optionId,
      itemName: cellText(get(row, 'itemName')),
      optionName: cellText(get(row, 'optionName')),
      qty,
      excelRow,
    })
  }

  if (rows.length === 0) throw new Error('입고할 상품이 없습니다. (옵션 ID · 입고 수량을 확인해 주세요)')

  return {
    fileName: file.name,
    rows,
    duplicateIds: Array.from(dup),
    skippedRows,
    totalQty: rows.reduce((s, r) => s + r.qty, 0),
  }
}

// ══════════════════════════════════════════════════════════════════
// 템플릿 채우기
// ══════════════════════════════════════════════════════════════════

/** 주석에 넣을 파일명 — 주석을 닫는 '*\/' 와 줄바꿈 제거 */
const safeCommentText = (s: string): string => s.replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ')

// JS 문자열 안에서 줄바꿈으로 취급되는 U+2028 · U+2029 (상품명에 섞여 들어오면 문법 오류)
const LINE_SEPARATORS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g')

/** JS 작은따옴표 문자열 리터럴 (\ · ' · 줄바꿈 이스케이프) */
const jsString = (s: string): string =>
  `'${s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, '\\n')
    .replace(LINE_SEPARATORS, ' ')}'`

/**
 * 템플릿의 @@이름@@ 을 값으로 바꾼다.
 * - String.replace 의 '$' 특수 패턴을 피하려고 split/join 사용
 * - 템플릿에 없는 자리표시를 넘기거나, 채운 뒤에도 @@ 가 남으면 오류 (템플릿 손상 방지)
 */
function fillTemplate(template: string, values: Record<string, string>): string {
  let out = template.replace(/\r\n/g, '\n')         // git 체크아웃 줄바꿈 차이 정규화
  for (const [name, value] of Object.entries(values)) {
    const token = `@@${name}@@`
    if (!out.includes(token)) throw new Error(`콘솔 템플릿에 ${token} 자리표시가 없습니다.`)
    out = out.split(token).join(value)
  }
  const left = out.match(/@@[A-Z_]+@@/)
  if (left) throw new Error(`콘솔 템플릿에 채우지 않은 자리표시 ${left[0]} 가 있습니다.`)
  return out
}

/** 데이터 줄 자리표시: 템플릿에는 '    /*@@NAME@@*\/' 한 줄로 두고 여러 줄로 바꾼다 */
const dataLinesToken = (name: string): string => `    /*@@${name}@@*/`

// ══════════════════════════════════════════════════════════════════
// 1단계 — 상품 선택
// ══════════════════════════════════════════════════════════════════

const IDS_PER_LINE = 5        // 옵션 ID 배열 한 줄당 개수 (원문과 같은 모양)

/**
 * 1단계 "상품 선택" — 입고 생성하기 › 1. 상품 선택 화면
 * 옵션 ID 를 20개씩 검색 → 전체 옵션 펼침 → 체크
 */
export function buildSelectProductsScript(excel: InboundExcel): string {
  const ids = excel.rows.map((r) => r.optionId)
  const lines: string[] = []
  for (let i = 0; i < ids.length; i += IDS_PER_LINE) {
    lines.push('    ' + ids.slice(i, i + IDS_PER_LINE).map((id) => `'${id}'`).join(',') + ',')
  }
  return fillTemplate(selectProductsTemplate.replace(/\r\n/g, '\n').split(dataLinesToken('OPTION_IDS')).join('@@OPTION_IDS@@'), {
    FILE_NAME: safeCommentText(excel.fileName),
    COUNT: String(ids.length),
    OPTION_IDS: lines.join('\n'),
  })
}

// ══════════════════════════════════════════════════════════════════
// 2단계 — 상품 확인 · 수량 입력
// ══════════════════════════════════════════════════════════════════

/**
 * 2단계 "입고 정보 입력" — 입고 생성하기 › 2. 입고 정보 입력 화면
 * ① 화면 상품 ↔ 엑셀 대조(누락·엑셀외·중복이면 정지) ② 수량 입력 ③ 재검증
 * - 엑셀에 같은 옵션 ID 가 여러 번 있으면 어느 수량이 맞는지 정할 수 없어 만들지 않는다.
 */
export function buildInputQuantitiesScript(excel: InboundExcel): string {
  if (excel.duplicateIds.length > 0) {
    throw new Error(
      `엑셀에 같은 옵션 ID 가 두 번 이상 있어 입고 수량을 정할 수 없습니다: ${excel.duplicateIds.join(', ')}` +
      ' — 엑셀에서 한 행으로 합친 뒤 다시 넣어 주세요.',
    )
  }
  const lines = excel.rows.map(
    (r) => `    [${r.no},'${r.optionId}',${jsString(r.itemName)},${jsString(r.optionName)},${r.qty}],`,
  )
  return fillTemplate(inputQuantitiesTemplate.replace(/\r\n/g, '\n').split(dataLinesToken('EXCEL_ROWS')).join('@@EXCEL_ROWS@@'), {
    FILE_NAME: safeCommentText(excel.fileName),
    COUNT: String(excel.rows.length),
    EXCEL_ROWS: lines.join('\n'),
  })
}
