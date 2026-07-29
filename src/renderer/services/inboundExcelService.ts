/* ================================================================
   inboundExcelService — 입고준비 엑셀(Delivery + shipment_list) 생성
   - 헤더 배경색·열너비 등 서식이 필요하므로 exceljs 를 사용한다.
     (xlsx 무료판은 셀 스타일을 저장하지 못하고 조용히 무시함)
   - 열너비는 헤더/데이터 중 가장 긴 값 기준으로 자동 계산한다.
   ================================================================ */

import ExcelJS from 'exceljs'

// ── 서식 상수 ─────────────────────────────────────────────────────
/** 헤더 배경 (회색) */
const HEADER_FILL_ARGB = 'FFD9D9D9'
/** 열너비 하한 / 상한 — 상품명처럼 긴 값이 화면을 다 먹지 않도록 제한 */
const MIN_COL_WIDTH = 8
const MAX_COL_WIDTH = 48
/** 좌우 여백 (문자 수 기준) */
const COL_WIDTH_PADDING = 2

export type Cell = string | number | null | undefined

// ── 표시 너비 계산 ────────────────────────────────────────────────
/**
 * 엑셀 열너비(wch)는 기본 글꼴 문자 폭 기준이라 한글·한자 등 전각 문자는
 * 영문의 약 2배를 차지한다. 이를 반영해 '표시 폭'을 계산한다.
 */
function displayWidth(value: Cell): number {
  if (value == null) return 0
  const str = String(value)
  let width = 0
  for (const ch of str) {
    const code = ch.codePointAt(0) ?? 0
    // CJK(한글/한자/가나) + 전각 기호 → 2칸
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||   // 한글 자모
      (code >= 0x2e80 && code <= 0xa4cf) ||   // CJK 부수 ~ 이체자
      (code >= 0xac00 && code <= 0xd7a3) ||   // 한글 음절
      (code >= 0xf900 && code <= 0xfaff) ||   // CJK 호환 한자
      (code >= 0xfe30 && code <= 0xfe6f) ||   // CJK 호환 형태
      (code >= 0xff00 && code <= 0xff60) ||   // 전각 영숫자
      (code >= 0xffe0 && code <= 0xffe6)
    width += isWide ? 2 : 1
  }
  return width
}

/** aoa 를 훑어 열별 최대 표시 폭 → 엑셀 열너비 배열 */
function calcColumnWidths(aoa: Cell[][]): number[] {
  const widths: number[] = []
  for (const row of aoa) {
    row.forEach((cell, i) => {
      const w = displayWidth(cell)
      if (w > (widths[i] ?? 0)) widths[i] = w
    })
  }
  return widths.map((w) =>
    Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, (w || 0) + COL_WIDTH_PADDING)),
  )
}

// ── 시트 구성 ─────────────────────────────────────────────────────
/** aoa 를 시트로 추가하고 헤더 서식 + 자동 열너비를 적용 */
function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  aoa: Cell[][],
  opts: { headerFill: boolean },
): void {
  const ws = wb.addWorksheet(name)
  for (const row of aoa) ws.addRow(row)

  // 열너비 (자동 계산)
  calcColumnWidths(aoa).forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })

  // 헤더 행 서식
  if (aoa.length > 0) {
    const header = ws.getRow(1)
    header.font = { bold: true }
    if (opts.headerFill) {
      header.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: HEADER_FILL_ARGB },
        }
      })
    }
    header.commit()
  }
}

// ── 다운로드 ──────────────────────────────────────────────────────
export interface SheetSpec {
  /** 시트명 */
  name: string
  /** 1행 = 헤더, 이후 = 데이터 */
  aoa: Cell[][]
  /** 헤더 회색 배경 적용 여부 (기본 false) */
  headerFill?: boolean
}

/**
 * 여러 시트를 서식(헤더 배경 + 자동 열너비)과 함께 xlsx 로 내려받는다.
 */
export async function downloadStyledWorkbook(
  sheets: SheetSpec[],
  fileName: string,
): Promise<void> {
  const wb = new ExcelJS.Workbook()
  for (const s of sheets) {
    addSheet(wb, s.name, s.aoa, { headerFill: s.headerFill ?? false })
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
