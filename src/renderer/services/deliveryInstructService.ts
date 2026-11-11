/* ================================================================
   [배송준비] 송장 업로드 서비스 — 상품준비중(INSTRUCT) → 배송지시(DEPARTURE)
   - 쿠팡 DeliveryList 엑셀(택배사·운송장번호를 채운 것)을 읽어 쿠팡 송장업로드 API 로 등록한다.
     WING 의 엑셀 일괄 송장등록과 같은 일. 분리배송(부분출고)도 같은 API 로 한다.
   - 흐름: parseDeliveryExcel(엑셀 → 행) → buildDeliveryInstructPlan(순수 함수 — 사전 검사·묶음 구성)
           → submitDeliveryInstruct(순차 전송) → saveDeliveryInstructed(성공 줄 DB 반영)
   - API: POST /v2/providers/openapi/apis/api/v4/vendors/{vendorId}/orders/invoices
       (UPDATE_ORDER_SHIPPING_INFO · FAQ "분리배송을 하고 싶습니다", developers.coupang.com 2026-11-11 확인)
       · 상품준비중 주문만 가능 · 한 줄 = 옵션(vendorItemId) 하나
       · 일반: 묶음(shipmentBoxId)의 모든 옵션을 같은 송장으로 (splitShipping=false)
       · 분리 시작: 묶음의 모든 옵션을 한 번에 — 지금 보낼 옵션은 송장, 나중 옵션은 출고예정일 (splitShipping=true)
       · 분리 이어 보내기: 남은 옵션 중 송장이 생긴 것만 (splitShipping=true, preSplitShipped=true)
       · 분리하면 일반으로 되돌릴 수 없고 출고예정일을 고칠 수 없다. 먼저 보낸 옵션의 묶음배송번호는 바뀐다
       · HTTP 400 은 요청 전체를 거절한다 (송장 형식 오류 등)
   - 프록시: /api/coupang/orders-invoices — coupangProxy.ts · prodServer.js 양쪽에 있다.
       응답 { success, data: 쿠팡 본문, coupangStatus: 쿠팡 HTTP 상태 } — 쿠팡 HTTP 400 일 때만 묶음별로 다시 보낸다
   - 쿠팡은 등록 IP(Railway)만 받으므로 로컬 dev 에서는 403 — 배포 후에만 실제 확인 가능
   ================================================================ */

import * as XLSX from 'xlsx'
import { supabase } from './supabase'
import {
  getCoupangHeaders,
  STATUS_MAP,
  SPLIT_SHIPPING,
  type PersonalOrderRow,
} from './personalOrderService'
import {
  resolveCarrier,
  validateInvoiceNumber,
  SUPPORTED_CARRIER_NAMES,
  type CoupangCarrier,
} from './coupangCarriers'
import { COUPANG_RATE_LIMIT } from '../utils/rateLimitQueue'

// ══════════════════════════════════════════════════════════════════
// 상수
// ══════════════════════════════════════════════════════════════════

/**
 * 송장업로드 1회 요청의 최대 줄(옵션) 수.
 * 쿠팡 문서에는 최대값이 없다 — 주문확인 API 의 50건 제한과 같은 값으로 보수적으로 잡았다.
 * 프록시(coupangProxy.ts · prodServer.js)의 INVOICE_UPLOAD_MAX_ITEMS 와 같은 값이어야 한다.
 */
export const INVOICE_UPLOAD_MAX_DTOS = 50

/** 송장 등록이 가능한 주문 상태 (상품준비중) */
const INVOICE_UPLOADABLE_STATUS = 'INSTRUCT'
/** 등록 성공 후 상태 (배송지시) — 화면·DB 반영에 쓴다 */
export const DELIVERY_INSTRUCTED_STATUS = 'DEPARTURE'
/** 주문확인 전 상태 (결제완료) — 안내 문구 분기용 */
const ACCEPT_STATUS = 'ACCEPT'

/** 엑셀 '분리배송 Y/N' 칸에서 분리배송을 뜻하는 값 (대소문자 무시) */
const EXCEL_SPLIT_YES = 'Y'
/** 분리배송 최소 옵션 수 — 옵션이 하나면 쿠팡이 거절한다 (NOT_ALLOW_SEPARATE_WHEN_ONE_VENDOR_ITEM) */
const SPLIT_MIN_OPTIONS = 2

/** 머리글 행을 찾을 범위 — 시트 맨 위에서 이 행 수 안에 있어야 한다 */
const HEADER_SCAN_ROWS = 10
/** 엑셀 숫자 셀이 정확히 담을 수 있는 최대 자릿수 (Excel 유효숫자 15자리) */
const EXCEL_EXACT_DIGITS = 15
/** DB 반영(update) 동시 실행 수 — updatePendingInvoiceNumbers 와 같은 값 */
const DB_UPDATE_CONCURRENCY = 10

/** 쿠팡 응답 성공 코드 (최상위 code) */
const COUPANG_OK_CODE = '200'
/** 쿠팡 data.responseCode — 0 = 전체 성공 */
const RESPONSE_CODE_SUCCESS = 0

// ── DeliveryList 머리글 (usePersonalOrder 의 DELIVERY_HEADERS 와 같은 이름) ──
const HEADER_NAMES = {
  shipmentBoxId: '묶음배송번호',
  orderId: '주문번호',
  carrier: '택배사',
  invoiceNumber: '운송장번호',
  vendorItemId: '옵션ID',
  splitShipping: '분리배송 Y/N',
  splitShipDate: '분리배송 출고예정일',
} as const

type HeaderField = keyof typeof HEADER_NAMES
const REQUIRED_HEADERS: readonly HeaderField[] = ['shipmentBoxId', 'orderId', 'carrier', 'invoiceNumber', 'vendorItemId']

/** 쿠팡 resultCode → 한국어 설명 (resultMessage 가 비었을 때 쓴다) */
export const INVOICE_RESULT_CODE_LABELS: Record<string, string> = {
  OK: '성공',
  NOT_FOUND_SHIPMENT_BOX: '묶음배송번호를 찾을 수 없습니다',
  INVALID_STATUS: '배송진행상태가 유효하지 않습니다 (상품준비중이 아님)',
  PERMISSION_DENIED: '권한이 없습니다',
  DUPLICATE_INVOICE_NUMBER: '이미 저장된 송장번호가 있습니다 (6개월 내 중복)',
  INVALID_INVOICE_NUMBER: '송장번호가 유효하지 않습니다',
  ORDER_DELIVERY_CANCELED: '취소된 주문 또는 출고중지 요청 건입니다',
  ORDER_DELIVERY_PARTIAL_STOP_REQUESTED: '출고중지 요청 건입니다',
  ORDER_DELIVERY_CANCELED_HOLDING_FOR_CANCEL: '취소 대기 중인 주문입니다',
  UNDEFINED_ERROR_OCCUR: '쿠팡 내부 오류입니다',
  NOT_ALLOW_INVOICE_NUMBER_RE_UPLOAD: '송장번호를 다시 올릴 수 없습니다',
  NOT_FOUND_INVOICE_NUMBER: '이미 출고예정일이 등록된 상품이라 운송장번호를 넣어야 합니다',
  NOT_FOUND_VENDOR_ITEM: '합포장 건 중 누락된 상품이 있습니다',
  NOT_ALLOW_VENDOR_DIRECT: '업체직송은 분리배송할 수 없습니다',
  PSD_NOT_ALLOW_TO_CHANGE: '출고예정일은 처음 등록한 뒤 바꿀 수 없습니다',
  NOT_ALLOW_SEPARATE_AFTER_NORMAL_DELIVERY: '일반배송 접수 후에는 분리배송할 수 없습니다',
  IS_SEPARATE_MUST_BE_TRUE_WHEN_SEPARATE_DELIVERY: '분리배송 접수 후에는 일반배송으로 처리할 수 없습니다',
  NOT_ALLOW_SEPARATE_WHEN_ONE_VENDOR_ITEM: '상품이 한 가지인 묶음은 분리배송할 수 없습니다',
}

// ══════════════════════════════════════════════════════════════════
// 타입
// ══════════════════════════════════════════════════════════════════

/** 엑셀에서 읽은 1행 (값은 모두 문자열 — 빈 칸은 '') */
export interface DeliveryExcelRow {
  sheet: string
  /** 엑셀 화면의 행 번호 (1부터) */
  rowNumber: number
  shipmentBoxId: string
  orderId: string
  vendorItemId: string
  carrierRaw: string
  /** 공백·하이픈을 지운 운송장번호 */
  invoiceNumber: string
  /** '분리배송 Y/N' 칸 (없으면 '') */
  splitShipping: string
  /** '분리배송 출고예정일' 칸 → YYYY-MM-DD (없으면 '') */
  splitShipDate: string
  /** '분리배송 출고예정일' 칸을 날짜로 읽지 못한 사유 — 나중에 보낼 줄에서만 실패로 친다 */
  splitShipDateError: string | null
  /** 묶음배송번호·주문번호·옵션ID·운송장 셀 형식 오류 (숫자 셀 자릿수 손실 등) — 있으면 행 실패 */
  cellErrors: string[]
  /** 운송장번호 칸 자체가 형식 오류인지 — 빈 운송장(제외)과 구분 */
  invoiceCellError: boolean
}

export interface ParsedDeliveryExcel {
  rows: DeliveryExcelRow[]
  /** 읽은 시트 이름 (머리글이 있는 시트만) */
  sheets: string[]
}

/**
 * 묶음을 보내는 방식
 * - normal        : 묶음 전체를 한 송장으로
 * - splitFirst    : 분리배송 시작 — 묶음의 모든 옵션을 보내되 일부는 출고예정일만
 * - splitFollowUp : 분리배송 이어 보내기 — 남은 옵션 중 송장이 있는 것만
 */
export type DeliveryMode = 'normal' | 'splitFirst' | 'splitFollowUp'

/** 전송할 줄 1개 (옵션 하나) */
export interface ReadyLine {
  vendorItemId: string
  /** 화면 표시용 '상품명 / 옵션명' */
  itemLabel: string
  carrier: { code: string; name: string }
  /** '' = 나중에 보낼 옵션 (splitFirst 에서만) */
  invoiceNumber: string
  /** 나중에 보낼 옵션의 출고예정일 YYYY-MM-DD (그 밖에는 '') */
  estimatedShippingDate: string
  /** 출고예정일 출처 — 엑셀 '분리배송 출고예정일' 칸 / 주문에 등록된 출고예정일 */
  dateSource: 'excel' | 'order' | null
  /** 출고예정일이 오늘보다 이전 — 쿠팡이 거절할 수 있어 화면에서 알린다 */
  datePast: boolean
}

/** 전송할 묶음 1개 */
export interface ReadyBox {
  shipmentBoxId: string
  orderId: string
  mode: DeliveryMode
  lines: ReadyLine[]
}

/** 행 위치 (시트·행) + 식별자 */
interface RowRef {
  shipmentBoxId: string
  orderId: string
  vendorItemId: string
  sheet: string
  rowNumber: number
}

export interface PlanFailure extends RowRef {
  reason: string
}

export type SkippedRow = RowRef

export interface DeliveryInstructPlan {
  /** 빈 줄을 뺀 엑셀 데이터 행 수 */
  totalRows: number
  boxes: ReadyBox[]
  /** 운송장번호가 비어 제외한 행 (실패 아님) */
  skipped: SkippedRow[]
  /** 등록 불가 행 (시트 · 행 순) */
  failures: PlanFailure[]
}

export interface InvoiceUploadFailure {
  box: ReadyBox
  /** 쿠팡 resultCode / 요청 거절 코드 (없으면 '') */
  resultCode: string
  reason: string
  retryRequired: boolean
}

export interface InvoiceUploadUnknown {
  box: ReadyBox
  reason: string
}

export interface InvoiceUploadResult {
  succeeded: ReadyBox[]
  failed: InvoiceUploadFailure[]
  /** 반영 여부를 모르는 묶음 (응답 없음 · 묶음 안 일부만 처리) — 자동 재시도하지 않는다 */
  unknown: InvoiceUploadUnknown[]
  /** 중단으로 보내지 않은 묶음 */
  notSent: ReadyBox[]
  aborted: boolean
}

/** 성공한 줄을 화면(items)·DB 에 반영할 값 */
export type DeliveryRowPatch = Partial<Pick<
  PersonalOrderRow,
  'status' | 'invoice_number' | 'delivery_company_name' | 'split_shipping' | 'planned_shipping_date'
>>

/** 화면(items)·DB 반영용 — 성공 줄 1개 (묶음배송번호 + 옵션ID 로 행을 찾는다) */
export interface DeliveryInstructedRow {
  shipmentBoxId: string
  vendorItemId: string
  patch: DeliveryRowPatch
}

// ══════════════════════════════════════════════════════════════════
// 날짜 (YYYY-MM-DD)
// ══════════════════════════════════════════════════════════════════

/** 2026-11-20 · 2026.11.20 · 2026/11/20 · 20261120 (+ 뒤에 시각이 붙어도 됨) */
const DATE_TEXT_PATTERN = /^(\d{4})[-./]?(\d{2})[-./]?(\d{2})(?:[ T].*)?$/

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 달력에 있는 날짜인지 (2월 30일 등 거름) */
function isRealDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/** 날짜 글자 → YYYY-MM-DD. 빈 값은 '', 날짜가 아니면 null */
function toYmd(text: string | null | undefined): string | null {
  const t = (text ?? '').trim()
  if (!t) return ''
  const m = DATE_TEXT_PATTERN.exec(t)
  if (!m) return null
  return isRealDate(Number(m[1]), Number(m[2]), Number(m[3])) ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/** 오늘 날짜 YYYY-MM-DD (이 PC 의 날짜) — buildDeliveryInstructPlan 에 넘긴다 */
export function todayYmd(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

// ══════════════════════════════════════════════════════════════════
// 1) 엑셀 파싱 — DeliveryList 머리글이 있는 시트를 모두 읽는다
//   (입고엑셀: Delivery · 합배송 시트에 머리글이 있고 shipment_list · 남은상품 시트엔 없다)
// ══════════════════════════════════════════════════════════════════

/** 머리글 비교용 — 공백 제거 */
const normalizeHeader = (v: unknown) => String(v ?? '').replace(/\s+/g, '')

/** 숫자 셀 자릿수 손실 안내 */
const NUMERIC_PRECISION_ERROR = '숫자 형식 셀의 자릿수가 손실되었습니다 — 텍스트 형식으로 저장해 주세요'
const DATE_CELL_ERROR = '날짜로 읽을 수 없습니다 — YYYY-MM-DD 로 넣어 주세요'

/**
 * ID·운송장 셀 → 문자열.
 * 숫자 셀은 안전한 정수이고 Excel 이 정확히 담는 15자리 이내일 때만 받는다 —
 * 그 밖의 값은 이미 자릿수가 깎였을 수 있어 조용히 틀린 ID 로 보내지 않도록 오류로 돌린다.
 */
function readIdCell(v: unknown): { value: string; error: string | null } {
  if (v == null) return { value: '', error: null }
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v) || v < 0 || String(v).length > EXCEL_EXACT_DIGITS) {
      return { value: '', error: NUMERIC_PRECISION_ERROR }
    }
    return { value: String(v), error: null }
  }
  if (typeof v === 'string') return { value: v.trim(), error: null }
  return { value: '', error: `읽을 수 없는 셀 값입니다 (${typeof v})` }
}

/**
 * 날짜 셀 → YYYY-MM-DD.
 * 글자(2026-11-20 등)와 숫자(20261120 또는 Excel 날짜 일련번호) 모두 받는다.
 */
function readDateCell(v: unknown): { value: string; error: string | null } {
  if (v == null || v === '') return { value: '', error: null }
  if (typeof v === 'string' || typeof v === 'number') {
    const fromText = toYmd(String(v))
    if (fromText != null) return { value: fromText, error: null }
    if (typeof v === 'number') {
      // Excel 날짜 일련번호 — 시간대와 무관하게 연·월·일을 꺼낸다
      const parsed = XLSX.SSF.parse_date_code(v)
      if (parsed && isRealDate(parsed.y, parsed.m, parsed.d)) {
        return { value: `${parsed.y}-${pad2(parsed.m)}-${pad2(parsed.d)}`, error: null }
      }
    }
  }
  return { value: '', error: DATE_CELL_ERROR }
}

/** 시트의 머리글 행 찾기 — 필수 머리글이 모두 있는 첫 행 */
function findHeaderRow(
  aoa: unknown[][],
): { rowIndex: number; columns: Partial<Record<HeaderField, number>> } | { missing: string[] } {
  let bestMissing: string[] = REQUIRED_HEADERS.map((f) => HEADER_NAMES[f])
  const scan = Math.min(aoa.length, HEADER_SCAN_ROWS)
  for (let r = 0; r < scan; r++) {
    const cells = (aoa[r] ?? []).map(normalizeHeader)
    const columns: Partial<Record<HeaderField, number>> = {}
    for (const field of Object.keys(HEADER_NAMES) as HeaderField[]) {
      const idx = cells.indexOf(normalizeHeader(HEADER_NAMES[field]))
      if (idx >= 0) columns[field] = idx
    }
    const missing = REQUIRED_HEADERS.filter((f) => columns[f] == null).map((f) => HEADER_NAMES[f])
    if (missing.length === 0) return { rowIndex: r, columns }
    if (missing.length < bestMissing.length) bestMissing = missing
  }
  return { missing: bestMissing }
}

/** 엑셀 파일 → 행 목록. 머리글이 있는 시트가 하나도 없으면 throw */
export async function parseDeliveryExcel(file: File): Promise<ParsedDeliveryExcel> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const rows: DeliveryExcelRow[] = []
  const sheets: string[] = []
  const missingBySheet: string[] = []

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName]
    if (!ws || !ws['!ref']) {
      missingBySheet.push(`'${sheetName}' (빈 시트)`)
      continue
    }
    // 시트 범위가 1행이 아닐 수 있으므로 시작 행을 더해 실제 행 번호를 만든다
    const startRow = XLSX.utils.decode_range(ws['!ref']).s.r
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true })

    const header = findHeaderRow(aoa)
    if ('missing' in header) {
      missingBySheet.push(`'${sheetName}' (없음: ${header.missing.join(', ')})`)
      continue
    }
    sheets.push(sheetName)
    const col = header.columns
    const cellAt = (line: unknown[], field: HeaderField) => {
      const idx = col[field]
      return idx == null ? null : line[idx]
    }

    for (let r = header.rowIndex + 1; r < aoa.length; r++) {
      const line = aoa[r] ?? []
      const cellErrors: string[] = []
      const readField = (field: HeaderField) => {
        const { value, error } = readIdCell(cellAt(line, field))
        if (error) cellErrors.push(`${HEADER_NAMES[field]}: ${error}`)
        return { value, error }
      }

      const shipmentBoxId = readField('shipmentBoxId').value
      const orderId = readField('orderId').value
      const vendorItemId = readField('vendorItemId').value
      const invoice = readField('invoiceNumber')
      const carrierRaw = String(cellAt(line, 'carrier') ?? '').trim()
      const splitShipping = String(cellAt(line, 'splitShipping') ?? '').trim()
      const splitShipDate = readDateCell(cellAt(line, 'splitShipDate'))
      // 운송장번호 정규화: 공백·하이픈 제거
      const invoiceNumber = invoice.value.replace(/[\s-]/g, '')

      // 빈 줄 (식별자·운송장 모두 없음) 은 행으로 치지 않는다
      if (!shipmentBoxId && !orderId && !vendorItemId && !invoiceNumber && cellErrors.length === 0) continue

      rows.push({
        sheet: sheetName,
        rowNumber: startRow + r + 1,
        shipmentBoxId,
        orderId,
        vendorItemId,
        carrierRaw,
        invoiceNumber,
        splitShipping,
        splitShipDate: splitShipDate.value,
        splitShipDateError: splitShipDate.error,
        cellErrors,
        invoiceCellError: invoice.error != null,
      })
    }
  }

  if (sheets.length === 0) {
    const required = REQUIRED_HEADERS.map((f) => HEADER_NAMES[f]).join(', ')
    throw new Error(
      `쿠팡 배송리스트(DeliveryList) 머리글을 찾지 못했습니다. 필요한 열: ${required}\n` +
      missingBySheet.join('\n'),
    )
  }
  return { rows, sheets }
}

// ══════════════════════════════════════════════════════════════════
// 2) 사전 검사 + 묶음 구성 (순수 함수 — React·네트워크 없음)
//   엑셀 행을 묶음배송번호로 묶고, 묶음마다:
//     ① 보낼 운송장이 하나도 없으면 묶음 전체 제외 (실패 아님)
//     ② 방식 판정 — DB 가 분리배송 진행 중이면 이어 보내기 / 엑셀 '분리배송 Y/N' 이 Y 면 분리 시작 / 아니면 일반
//     ③ 행 검사 — 셀 형식 · 주문 존재 · 주문번호 · 상태(상품준비중만) · 출고중지 · 취소 · 택배사 · 운송장 형식
//     ④ 방식별 묶음 검사 → 전송할 줄 구성
//   일반 · 분리 시작은 한 행이라도 걸리면 묶음 전체를 보내지 않는다 (쿠팡이 묶음 단위로 받고, 분리배송은 되돌릴 수 없다).
//   분리 이어 보내기만 옵션마다 따로 접수되므로 걸린 행을 빼고 보낸다.
// ══════════════════════════════════════════════════════════════════

const isDigits = (v: string) => /^\d+$/.test(v)
const hasInvoice = (row: DeliveryExcelRow) => row.invoiceNumber !== '' || row.invoiceCellError
const isSplitRequested = (row: DeliveryExcelRow) => row.splitShipping.toUpperCase() === EXCEL_SPLIT_YES
const boxOptionKey = (shipmentBoxId: string, vendorItemId: string) => `${shipmentBoxId}|${vendorItemId}`

const refOf = (row: DeliveryExcelRow): RowRef => ({
  shipmentBoxId: row.shipmentBoxId,
  orderId: row.orderId,
  vendorItemId: row.vendorItemId,
  sheet: row.sheet,
  rowNumber: row.rowNumber,
})

const SIBLING_FAILURE_REASON = '같은 묶음의 다른 상품에 오류가 있습니다'
const SPLIT_HINT = `나눠 보내려면 묶음의 모든 행을 엑셀에 두고 '${HEADER_NAMES.splitShipping}' 을 Y 로 바꿔 주세요`

/** DB 색인 — 묶음+옵션 → 행 / 묶음 → 취소 안 된 행들 */
interface OrderIndex {
  byKey: Map<string, PersonalOrderRow>
  activeByBox: Map<string, PersonalOrderRow[]>
}

function indexOrders(orders: readonly PersonalOrderRow[]): OrderIndex {
  const byKey = new Map<string, PersonalOrderRow>()
  const activeByBox = new Map<string, PersonalOrderRow[]>()
  for (const o of orders) {
    byKey.set(boxOptionKey(o.shipment_box_id, o.vendor_item_id), o)
    if (o.canceled) continue
    const list = activeByBox.get(o.shipment_box_id)
    if (list) list.push(o)
    else activeByBox.set(o.shipment_box_id, [o])
  }
  return { byKey, activeByBox }
}

/** 상품준비중이 아닌 주문 → 상태별 안내 */
function describeStatusFailure(status: string): string {
  const label = STATUS_MAP[status] ?? status
  if (status === ACCEPT_STATUS) return `${label} 상태입니다 — [주문확인] 을 먼저 해 주세요`
  if (STATUS_MAP[status]) {
    return `이미 ${label} 상태입니다 — 배송지시 이후의 송장 변경은 WING 에서 해 주세요`
  }
  return `${label || '알 수 없는'} 상태라 송장을 등록할 수 없습니다`
}

/** 행 검사를 통과한 행 — carrier 는 운송장이 없는 행에서 택배사 칸이 비었으면 null */
interface CheckedRow {
  row: DeliveryExcelRow
  order: PersonalOrderRow
  carrier: CoupangCarrier | null
}

/** ③ 행 검사 — 통과하면 CheckedRow, 아니면 사유 */
function checkRow(row: DeliveryExcelRow, index: OrderIndex): CheckedRow | string {
  if (row.cellErrors.length > 0) return row.cellErrors.join(' / ')

  // 식별자 (묶음배송번호는 묶음 단계에서 이미 확인)
  const idChecks: Array<[string, string]> = [
    [HEADER_NAMES.orderId, row.orderId],
    [HEADER_NAMES.vendorItemId, row.vendorItemId],
  ]
  const badId = idChecks.find(([, v]) => !isDigits(v))
  if (badId) {
    const [name, value] = badId
    return value ? `${name}가 숫자가 아닙니다: "${value}"` : `${name}가 비어 있습니다`
  }

  // 주문 존재 · 주문번호 일치
  const order = index.byKey.get(boxOptionKey(row.shipmentBoxId, row.vendorItemId))
  if (!order) return '주문을 찾을 수 없습니다 — [주문 업데이트] 후 다시 시도해 주세요'
  if (order.order_id !== row.orderId) {
    return `엑셀 주문번호(${row.orderId})가 이 묶음의 주문번호(${order.order_id})와 다릅니다`
  }

  // 상태 · 출고중지 · 취소
  if (order.status !== INVOICE_UPLOADABLE_STATUS) return describeStatusFailure(order.status)
  if (order.release_stop) return '출고중지 요청 건입니다'
  if (order.canceled) return '취소된 상품입니다 — 엑셀에서 이 행을 지운 뒤 다시 올려 주세요'

  // 택배사 · 운송장 형식 (운송장이 없는 행은 택배사가 비어도 된다 — 묶음 단계에서 정한다)
  const carrier = resolveCarrier(row.carrierRaw)
  if (!carrier && (row.carrierRaw || row.invoiceNumber)) {
    return row.carrierRaw
      ? `지원하지 않는 택배사입니다: "${row.carrierRaw}" (지원: ${SUPPORTED_CARRIER_NAMES})`
      : `택배사가 비어 있습니다 (지원: ${SUPPORTED_CARRIER_NAMES})`
  }
  if (carrier && row.invoiceNumber) {
    const invoiceError = validateInvoiceNumber(carrier, row.invoiceNumber)
    if (invoiceError) return invoiceError
  }
  return { row, order, carrier }
}

/** 같은 옵션 행이 여러 번 있을 때 — 내용이 같으면 하나로, 다르면 사유 */
function dedupeByOption(checked: CheckedRow[]): CheckedRow[] | string {
  const byOption = new Map<string, CheckedRow>()
  for (const c of checked) {
    const prev = byOption.get(c.row.vendorItemId)
    if (!prev) { byOption.set(c.row.vendorItemId, c); continue }
    const same =
      prev.carrier?.code === c.carrier?.code &&
      prev.row.invoiceNumber === c.row.invoiceNumber &&
      prev.row.splitShipDate === c.row.splitShipDate
    if (!same) {
      return `같은 옵션ID(${c.row.vendorItemId}) 행이 여러 번 있고 택배사·운송장번호·출고예정일이 서로 다릅니다`
    }
  }
  return Array.from(byOption.values())
}

/** 묶음의 취소 안 된 옵션 중 엑셀에 없는 것 */
function missingOptions(checked: CheckedRow[], dbRows: PersonalOrderRow[]): string[] {
  const present = new Set(checked.map((c) => c.row.vendorItemId))
  return dbRows.filter((o) => !present.has(o.vendor_item_id)).map((o) => o.vendor_item_id)
}

const itemLabelOf = (order: PersonalOrderRow) =>
  order.item_name + (order.option_name ? ` / ${order.option_name}` : '')

/** 운송장이 있는 줄 */
function invoiceLine(c: CheckedRow, carrier: CoupangCarrier): ReadyLine {
  return {
    vendorItemId: c.row.vendorItemId,
    itemLabel: itemLabelOf(c.order),
    carrier: { code: carrier.code, name: carrier.name },
    invoiceNumber: c.row.invoiceNumber,
    estimatedShippingDate: '',
    dateSource: null,
    datePast: false,
  }
}

/** 분리배송을 할 수 있는 묶음인지 — 옵션 2개 이상이고 쿠팡이 불가로 표시하지 않음 */
const canSplitBox = (dbRows: PersonalOrderRow[]) =>
  dbRows.length >= SPLIT_MIN_OPTIONS && !dbRows.some((o) => o.split_shipping === SPLIT_SHIPPING.UNAVAILABLE)

// ── ④-a 일반: 묶음 전체를 한 송장으로 ──
function buildNormalLines(checked: CheckedRow[], dbRows: PersonalOrderRow[]): ReadyLine[] | string {
  const first = checked[0]
  if (!first.carrier) return '택배사가 비어 있습니다'
  // 분리배송이 가능한 묶음에만 방법을 알려 준다
  const splitHint = canSplitBox(dbRows) ? ` — ${SPLIT_HINT}` : ''
  if (checked.some((c) => c.carrier?.code !== first.carrier?.code)) {
    return `한 묶음배송에 택배사가 서로 다릅니다${splitHint}`
  }
  if (checked.some((c) => c.row.invoiceNumber !== first.row.invoiceNumber)) {
    return `한 묶음배송에 운송장번호가 서로 다릅니다${splitHint}`
  }
  const missing = missingOptions(checked, dbRows)
  if (missing.length > 0) {
    return `합포장 상품 중 운송장이 없는/누락된 상품이 있습니다 (${missing.length}개: 옵션ID ${missing.join(', ')})${splitHint}`
  }
  const carrier = first.carrier
  return checked.map((c) => invoiceLine(c, carrier))
}

// ── ④-b 분리 시작: 묶음의 모든 옵션 — 운송장이 있는 것은 지금, 없는 것은 출고예정일 ──
function buildSplitFirstLines(
  checked: CheckedRow[],
  dbRows: PersonalOrderRow[],
  today: string,
): ReadyLine[] | string {
  if (checked.some((c) => !isSplitRequested(c.row))) {
    return `'${HEADER_NAMES.splitShipping}' 이 묶음 안에서 서로 다릅니다 — 분리배송이면 묶음의 모든 행을 Y 로, 아니면 모두 N 으로 맞춰 주세요`
  }
  if (dbRows.length < SPLIT_MIN_OPTIONS) {
    return `상품이 한 가지인 묶음은 분리배송할 수 없습니다 — '${HEADER_NAMES.splitShipping}' 을 N 으로 바꿔 주세요`
  }
  if (!canSplitBox(dbRows)) {
    return '쿠팡에서 분리배송 불가로 표시된 주문입니다'
  }
  const missing = missingOptions(checked, dbRows)
  if (missing.length > 0) {
    return `분리배송을 시작할 때는 묶음의 모든 상품 행이 있어야 합니다 (없는 옵션ID: ${missing.join(', ')})`
  }

  const shipNow = checked.filter((c) => c.row.invoiceNumber !== '')
  const shipLater = checked.filter((c) => c.row.invoiceNumber === '')
  if (shipLater.length === 0 && new Set(shipNow.map((c) => c.row.invoiceNumber)).size === 1) {
    return `'${HEADER_NAMES.splitShipping}' 이 Y 인데 모든 상품의 운송장이 같습니다 — 한 송장으로 보내려면 N 으로 바꿔 주세요`
  }

  // 나중 줄의 택배사: 자기 칸이 비었으면 지금 보내는 줄의 택배사(하나뿐일 때)를 쓴다
  const nowCarriers = new Map<string, CoupangCarrier>()
  for (const c of shipNow) if (c.carrier) nowCarriers.set(c.carrier.code, c.carrier)
  const fallbackCarrier = nowCarriers.size === 1 ? Array.from(nowCarriers.values())[0] : null

  const lines: ReadyLine[] = []
  for (const c of checked) {
    if (c.row.invoiceNumber !== '') {
      if (!c.carrier) return `택배사가 비어 있습니다 (옵션ID ${c.row.vendorItemId})`
      lines.push(invoiceLine(c, c.carrier))
      continue
    }
    const carrier = c.carrier ?? fallbackCarrier
    if (!carrier) {
      return `나중에 보낼 상품(옵션ID ${c.row.vendorItemId})의 택배사를 정할 수 없습니다 — '${HEADER_NAMES.carrier}' 칸을 채워 주세요`
    }
    if (c.row.splitShipDateError) {
      return `'${HEADER_NAMES.splitShipDate}'(옵션ID ${c.row.vendorItemId}): ${c.row.splitShipDateError}`
    }
    // 출고예정일: 엑셀 칸 우선, 없으면 주문에 이미 등록된 출고예정일
    const fromExcel = c.row.splitShipDate
    const date = fromExcel || toYmd(c.order.estimated_shipping_date)
    if (!date) {
      return `나중에 보낼 상품(옵션ID ${c.row.vendorItemId})의 출고예정일을 알 수 없습니다 — '${HEADER_NAMES.splitShipDate}' 칸에 YYYY-MM-DD 로 넣어 주세요`
    }
    lines.push({
      vendorItemId: c.row.vendorItemId,
      itemLabel: itemLabelOf(c.order),
      carrier: { code: carrier.code, name: carrier.name },
      invoiceNumber: '',
      estimatedShippingDate: date,
      dateSource: fromExcel ? 'excel' : 'order',
      datePast: date < today,
    })
  }
  return lines
}

// ── ④-c 분리 이어 보내기: 남은 옵션 중 운송장이 있는 것만 (묶음 전체가 없어도 된다) ──
function buildSplitFollowUpLines(checked: CheckedRow[]): ReadyLine[] | string {
  const lines: ReadyLine[] = []
  for (const c of checked) {
    if (!c.carrier) return `택배사가 비어 있습니다 (옵션ID ${c.row.vendorItemId})`
    lines.push(invoiceLine(c, c.carrier))
  }
  return lines
}

/** 사전 검사 결과를 모으는 곳 */
interface PlanCollector {
  boxes: ReadyBox[]
  skipped: SkippedRow[]
  failures: PlanFailure[]
}

/** 묶음 1개 처리 — 결과를 collector 에 담는다 */
function planBox(
  boxId: string,
  rows: DeliveryExcelRow[],
  index: OrderIndex,
  today: string,
  out: PlanCollector,
): void {
  const fail = (row: DeliveryExcelRow, reason: string) => out.failures.push({ ...refOf(row), reason })
  const skip = (row: DeliveryExcelRow) => out.skipped.push(refOf(row))

  // ① 보낼 운송장이 하나도 없는 묶음은 통째로 제외
  if (!rows.some(hasInvoice)) { rows.forEach(skip); return }

  // 묶음배송번호를 읽지 못한 행 — 운송장이 있는 행만 실패로 알린다
  if (!isDigits(boxId)) {
    for (const row of rows) {
      if (!hasInvoice(row)) { skip(row); continue }
      fail(row, row.cellErrors.length > 0
        ? row.cellErrors.join(' / ')
        : boxId ? `${HEADER_NAMES.shipmentBoxId}가 숫자가 아닙니다: "${boxId}"` : `${HEADER_NAMES.shipmentBoxId}가 비어 있습니다`)
    }
    return
  }

  // ② 방식 판정
  const dbRows = index.activeByBox.get(boxId) ?? []
  const mode: DeliveryMode =
    dbRows.some((o) => o.split_shipping === SPLIT_SHIPPING.IN_PROGRESS) ? 'splitFollowUp'
      : rows.some(isSplitRequested) ? 'splitFirst'
        : 'normal'

  // 분리 시작만 운송장이 없는 행도 보낸다(출고예정일). 그 밖에는 운송장이 없는 행을 제외한다.
  const targets = mode === 'splitFirst' ? rows : rows.filter(hasInvoice)
  if (mode !== 'splitFirst') rows.filter((r) => !hasInvoice(r)).forEach(skip)

  // ③ 행 검사
  //   일반 · 분리 시작은 묶음이 한 단위 — 하나라도 걸리면 묶음 전체를 보내지 않는다.
  //   분리 이어 보내기는 쿠팡이 옵션마다 따로 접수한다 — 걸린 행만 빼고 나머지는 보낸다
  //   (예전 엑셀을 다시 올려 이미 보낸 상품 행이 섞여 있어도 이번 상품이 막히지 않게).
  const atomic = mode !== 'splitFollowUp'
  const passed: CheckedRow[] = []
  const rejected: Array<{ row: DeliveryExcelRow; reason: string }> = []
  for (const row of targets) {
    const result = checkRow(row, index)
    if (typeof result === 'string') rejected.push({ row, reason: result })
    else passed.push(result)
  }
  rejected.forEach((r) => fail(r.row, r.reason))
  const failBox = (reason: string) => passed.forEach((c) => fail(c.row, reason))
  if (rejected.length > 0 && atomic) { failBox(SIBLING_FAILURE_REASON); return }
  if (passed.length === 0) return

  const checked = dedupeByOption(passed)
  if (typeof checked === 'string') { failBox(checked); return }

  // ④ 방식별 묶음 검사 → 줄 구성
  const lines =
    mode === 'normal' ? buildNormalLines(checked, dbRows)
      : mode === 'splitFirst' ? buildSplitFirstLines(checked, dbRows, today)
        : buildSplitFollowUpLines(checked)
  if (typeof lines === 'string') { failBox(lines); return }
  if (lines.length > INVOICE_UPLOAD_MAX_DTOS) {
    failBox(`한 묶음의 상품이 ${INVOICE_UPLOAD_MAX_DTOS}개를 넘어 한 번에 보낼 수 없습니다 (WING 에서 처리)`)
    return
  }

  out.boxes.push({ shipmentBoxId: boxId, orderId: checked[0].order.order_id, mode, lines })
}

/**
 * 엑셀 행 + 화면이 가진 주문(계정 전체) → 전송 계획.
 * @param today 오늘 날짜 YYYY-MM-DD (todayYmd()) — 지난 출고예정일 표시용
 */
export function buildDeliveryInstructPlan(
  excelRows: readonly DeliveryExcelRow[],
  orders: readonly PersonalOrderRow[],
  today: string,
): DeliveryInstructPlan {
  const index = indexOrders(orders)

  // 묶음배송번호로 묶기 (엑셀에 처음 나온 순서 유지)
  const rowsByBox = new Map<string, DeliveryExcelRow[]>()
  for (const row of excelRows) {
    const list = rowsByBox.get(row.shipmentBoxId)
    if (list) list.push(row)
    else rowsByBox.set(row.shipmentBoxId, [row])
  }

  const out: PlanCollector = { boxes: [], skipped: [], failures: [] }
  for (const [boxId, rows] of rowsByBox) planBox(boxId, rows, index, today, out)

  // 실패 목록은 시트 · 행 순서로
  const sheetOrder = new Map<string, number>()
  for (const r of excelRows) if (!sheetOrder.has(r.sheet)) sheetOrder.set(r.sheet, sheetOrder.size)
  out.failures.sort((a, b) =>
    (sheetOrder.get(a.sheet) ?? 0) - (sheetOrder.get(b.sheet) ?? 0) || a.rowNumber - b.rowNumber)

  return { totalRows: excelRows.length, boxes: out.boxes, skipped: out.skipped, failures: out.failures }
}

/** 분리배송 묶음인지 (시작 · 이어 보내기) */
export const isSplitBox = (box: ReadyBox) => box.mode !== 'normal'

// ══════════════════════════════════════════════════════════════════
// 3) 전송 — 묶음을 나누지 않고 요청당 최대 INVOICE_UPLOAD_MAX_DTOS 줄, 한 번에 1요청씩
//   프록시가 쿠팡 HTTP 상태(coupangStatus)를 같이 준다 — 본문 모양이 같아도 상태로만 원인을 가를 수 있다.
//   - 정상 응답(2xx · code 200): responseList 를 묶음별로 판정
//   - 쿠팡 HTTP 400 일 때만 묶음별로 다시 보낸다 ('요청변수확인' 전체 거절 — 송장 하나가 틀려 나머지가 막히지 않도록)
//   - 그 밖의 거절(401·403·429·2xx 비정상 본문): 나눠 보내도 같으므로 그대로 실패
//   - 응답을 못 받음(네트워크·5xx) · 묶음 안에서 일부만 처리: 반영 여부를 몰라 자동 재시도하지 않고 '확인 필요'
//   - 중단(signal)은 요청 사이에서만 확인한다 — 이미 보낸 요청은 되돌리지 않는다
// ══════════════════════════════════════════════════════════════════

/** 프록시 경로 */
const INVOICE_UPLOAD_PATH = '/api/coupang/orders-invoices'

/** HTTP 성공 범위 */
const HTTP_SUCCESS_MIN = 200
const HTTP_SUCCESS_MAX = 299
/** 묶음별로 다시 보내는 쿠팡 거절 상태 — 400(요청변수확인) 뿐 */
const SPLITTABLE_REJECT_STATUS = 400
/** 서버 오류 (반영 여부 알 수 없음) 기준 */
const SERVER_ERROR_MIN_STATUS = 500
const CLIENT_ERROR_MIN_STATUS = 400

const UNKNOWN_REASON = '응답을 받지 못했습니다 — [주문 업데이트]로 상태를 확인한 뒤 남은 건만 다시 등록하세요'
const PARTIAL_REASON = '묶음 안에서 일부 상품만 처리됐습니다 — [주문 업데이트]로 상태를 확인해 주세요'
const NO_RESULT_REASON = '응답에 결과가 없습니다 — [주문 업데이트]로 상태를 확인해 주세요'
const NO_RESULT_CODE = 'NO_RESULT'

/** 묶음 → 요청 묶음들 (묶음은 쪼개지 않는다. 계획 단계에서 MAX 초과 묶음은 이미 걸렀다) */
function chunkBoxes(boxes: readonly ReadyBox[]): ReadyBox[][] {
  const chunks: ReadyBox[][] = []
  let current: ReadyBox[] = []
  let size = 0
  for (const box of boxes) {
    const n = box.lines.length
    if (current.length > 0 && size + n > INVOICE_UPLOAD_MAX_DTOS) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(box)
    size += n
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/** 묶음 → 프록시 요청 줄 (ID 는 숫자 문자열 — 프록시가 숫자로 바꾼다) */
function toRequestItems(box: ReadyBox) {
  const splitShipping = isSplitBox(box)
  const preSplitShipped = box.mode === 'splitFollowUp'
  return box.lines.map((line) => ({
    shipmentBoxId: box.shipmentBoxId,
    orderId: box.orderId,
    vendorItemId: line.vendorItemId,
    deliveryCompanyCode: line.carrier.code,
    invoiceNumber: line.invoiceNumber,
    splitShipping,
    preSplitShipped,
    estimatedShippingDate: line.estimatedShippingDate,
  }))
}

/** 요청 1회의 결과 분류 */
type RequestOutcome =
  | { kind: 'response'; data: any }
  | { kind: 'rejected'; code: string; message: string; splittable: boolean }
  | { kind: 'unknown'; message: string }

/** 요청 1회 전송 + 결과 분류 (throw 하지 않는다) */
async function sendInvoiceRequest(
  boxes: readonly ReadyBox[],
  headers: Record<string, string>,
): Promise<RequestOutcome> {
  let res: Response
  try {
    res = await fetch(INVOICE_UPLOAD_PATH, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: boxes.flatMap(toRequestItems) }),
    })
  } catch (err) {
    // 요청이 서버에 닿았는지 알 수 없다
    return { kind: 'unknown', message: err instanceof Error ? err.message : String(err) }
  }

  let json: any
  try {
    json = await res.json()
  } catch {
    return { kind: 'unknown', message: `프록시 응답을 읽을 수 없습니다 (HTTP ${res.status})` }
  }

  // ── 프록시 레벨 실패 ──
  //   400(우리 검증)·401(키 없음)은 쿠팡에 보내기 전에 막힌 것 → 확실히 미반영. 나눠 보내도 같으므로 나누지 않는다.
  //   5xx 는 쿠팡 호출 중 예외(네트워크·빈 응답·비JSON) → 반영 여부를 모른다.
  if (!json?.success) {
    const message: string = json?.error || `프록시 오류 (HTTP ${res.status})`
    if (res.status >= SERVER_ERROR_MIN_STATUS || res.status < CLIENT_ERROR_MIN_STATUS) return { kind: 'unknown', message }
    return { kind: 'rejected', code: `HTTP_${res.status}`, message, splittable: false }
  }

  // ── 쿠팡 응답 — HTTP 상태(coupangStatus)로 판정 ──
  const status: number | null = typeof json.coupangStatus === 'number' ? json.coupangStatus : null
  const body = json.data ?? {}
  const httpOk = status != null && status >= HTTP_SUCCESS_MIN && status <= HTTP_SUCCESS_MAX
  if (httpOk && String(body.code ?? '') === COUPANG_OK_CODE && body.data && typeof body.data === 'object') {
    return { kind: 'response', data: body.data }
  }

  const message: string = body.message || body.error || '쿠팡이 요청을 거절했습니다'
  if (status != null && status >= SERVER_ERROR_MIN_STATUS) return { kind: 'unknown', message }
  return {
    kind: 'rejected',
    code: String(body.error || body.code || `HTTP_${status ?? '?'}`),
    message,
    splittable: status === SPLITTABLE_REJECT_STATUS,
  }
}

/** 정상 응답 → 묶음별 성공 / 실패 / 확인 필요(일부만 처리) */
function classifyResponse(
  boxes: readonly ReadyBox[],
  data: any,
  result: InvoiceUploadResult,
): void {
  const entriesByBox = new Map<string, any[]>()
  const list: any[] = Array.isArray(data?.responseList) ? data.responseList : []
  for (const entry of list) {
    const key = String(entry?.shipmentBoxId ?? '')
    const arr = entriesByBox.get(key)
    if (arr) arr.push(entry)
    else entriesByBox.set(key, [entry])
  }
  const overallSuccess = Number(data?.responseCode) === RESPONSE_CODE_SUCCESS

  for (const box of boxes) {
    const entries = entriesByBox.get(box.shipmentBoxId) ?? []
    if (entries.length === 0) {
      if (overallSuccess) result.succeeded.push(box)
      else result.failed.push({ box, resultCode: NO_RESULT_CODE, reason: NO_RESULT_REASON, retryRequired: false })
      continue
    }
    const failedEntries = entries.filter((e) => e?.succeed !== true)
    if (failedEntries.length === 0) {
      result.succeeded.push(box)
      continue
    }
    const bad = failedEntries[0]
    const resultCode = String(bad.resultCode ?? '')
    const reason = String(bad.resultMessage || INVOICE_RESULT_CODE_LABELS[resultCode] || '쿠팡이 등록을 거절했습니다')
    if (failedEntries.length < entries.length) {
      // 같은 묶음에 성공한 줄과 실패한 줄이 섞였다 — 어느 줄이 반영됐는지 여기서 확정할 수 없다
      result.unknown.push({ box, reason: `${PARTIAL_REASON} (${resultCode || '코드 없음'}: ${reason})` })
      continue
    }
    result.failed.push({ box, resultCode, reason, retryRequired: bad.retryRequired === true })
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface SubmitDeliveryInstructOptions {
  signal?: AbortSignal
  onProgress?: (doneBoxes: number, totalBoxes: number) => void
}

/**
 * 준비된 묶음을 쿠팡에 등록한다 (순차 · 요청 사이 COUPANG_RATE_LIMIT.intervalMs 이상).
 * 키가 없으면 첫 요청 전에 throw — 그 밖의 실패는 결과에 담고 throw 하지 않는다.
 */
export async function submitDeliveryInstruct(
  boxes: readonly ReadyBox[],
  options: SubmitDeliveryInstructOptions = {},
): Promise<InvoiceUploadResult> {
  const { signal, onProgress } = options
  const headers = getCoupangHeaders()
  const result: InvoiceUploadResult = { succeeded: [], failed: [], unknown: [], notSent: [], aborted: false }
  const total = boxes.length
  let done = 0

  const queue: ReadyBox[][] = chunkBoxes(boxes)
  let sentAny = false
  onProgress?.(done, total)

  while (queue.length > 0) {
    if (sentAny) await delay(COUPANG_RATE_LIMIT.intervalMs)
    if (signal?.aborted) {
      result.aborted = true
      result.notSent.push(...queue.flat())
      break
    }
    const request = queue.shift()!
    sentAny = true
    const outcome = await sendInvoiceRequest(request, headers)

    if (outcome.kind === 'response') {
      classifyResponse(request, outcome.data, result)
    } else if (outcome.kind === 'rejected') {
      if (request.length > 1 && outcome.splittable) {
        // 묶음 하나씩 다시 — 큐 맨 앞에 넣어 같은 속도로 보낸다 (진행 수는 그때 센다)
        queue.unshift(...request.map((box) => [box]))
        continue
      }
      for (const box of request) {
        result.failed.push({ box, resultCode: outcome.code, reason: outcome.message, retryRequired: false })
      }
    } else {
      for (const box of request) result.unknown.push({ box, reason: `${UNKNOWN_REASON} (${outcome.message})` })
    }

    done += request.length
    onProgress?.(done, total)
  }

  return result
}

// ══════════════════════════════════════════════════════════════════
// 4) 성공 줄 반영 — 화면(items)과 coupang_personal_orders 를 같은 값으로 고친다
//   - 송장이 나간 줄: 배송지시 + 운송장 + 택배사
//   - 분리배송에서 나중에 보낼 줄: 상품준비중 그대로, 분리배송 표시 + 출고예정일
//   - 분리배송 뒤에는 먼저 보낸 옵션의 묶음배송번호가 쿠팡에서 바뀐다 → [주문 업데이트] 로 맞춘다
//     (그 전까지 화면·DB 는 예전 번호로 남지만 배송지시 상태라 다시 보내지 않는다)
//   pending_invoice_number 는 건드리지 않는다.
// ══════════════════════════════════════════════════════════════════

/** 성공한 묶음 → 줄별 반영값 */
export function toInstructedRows(box: ReadyBox): DeliveryInstructedRow[] {
  const split = isSplitBox(box)
  return box.lines.map((line) => {
    const patch: DeliveryRowPatch = line.invoiceNumber
      ? {
          status: DELIVERY_INSTRUCTED_STATUS,
          invoice_number: line.invoiceNumber,
          delivery_company_name: line.carrier.name,
        }
      : { planned_shipping_date: line.estimatedShippingDate }
    if (split) patch.split_shipping = SPLIT_SHIPPING.IN_PROGRESS
    return { shipmentBoxId: box.shipmentBoxId, vendorItemId: line.vendorItemId, patch }
  })
}

/** 성공 줄을 DB 에 반영 — 실패한 묶음배송번호를 돌려준다 (쿠팡에는 등록됨 → [주문 업데이트] 로 맞춰진다) */
export async function saveDeliveryInstructed(
  userId: string,
  rows: readonly DeliveryInstructedRow[],
): Promise<{ failedBoxIds: string[] }> {
  const failed = new Set<string>()

  for (let i = 0; i < rows.length; i += DB_UPDATE_CONCURRENCY) {
    const chunk = rows.slice(i, i + DB_UPDATE_CONCURRENCY)
    const results = await Promise.all(
      chunk.map(async (row) => {
        const { error } = await supabase
          .from('coupang_personal_orders')
          .update(row.patch)
          .eq('user_id', userId)
          .eq('shipment_box_id', row.shipmentBoxId)
          .eq('vendor_item_id', row.vendorItemId)
        if (error) console.error('[배송준비] DB 반영 오류:', row.shipmentBoxId, row.vendorItemId, error.message)
        return { boxId: row.shipmentBoxId, ok: !error }
      }),
    )
    for (const r of results) if (!r.ok) failed.add(r.boxId)
  }

  return { failedBoxIds: Array.from(failed) }
}
