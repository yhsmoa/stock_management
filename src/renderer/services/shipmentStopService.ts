/* ================================================================
   [출고중지] 서비스 — 상품준비중(INSTRUCT) 주문의 출고를 멈춘다. 대상은 두 가지:
     · 판매자 취소   : 판매자가 직접 취소한다 (WING 의 "주문취소 → 출고중지요청 목록에서 출고중지완료" 2단계와 같은 일)
     · 고객 취소 요청 : 고객이 먼저 취소(출고중지)를 요청한 건 — 쿠팡 출고중지요청 목록에서 접수 건을 찾아
                       ③ 출고중지완료 처리만 한다 (WING › 출고중지요청 › 출고중지완료와 같은 일. ① 취소는 보내지 않는다)
   - 쿠팡 Open API (developers.coupang.com · 2026-11-12 확인)
       ① 주문 상품 취소 처리   POST  v5/vendors/{vendorId}/orders/{orderId}/cancel            (CANCEL_ORDER_PROCESSING)
            · 결제완료 = 즉시 취소, 상품준비중 = 출고중지. 문서상 상품준비중은 이 호출 하나로 출고중지 접수와 완료가
              함께 된다 (응답 receiptType=STOP_SHIPMENT 는 "출고중지완료 접수 번호").
            · 한 주문에 묶음배송번호가 여럿이면 묶음별로 따로 호출해야 한다.
            · 사유 코드는 CANERR + CCTTER/CCPNER/CCPRER 뿐이다 — 귀책(판매자/고객)을 고르는 값도, 사유 글도 없다.
              상품준비중 취소는 입력과 무관하게 사유가 '품절'로 고정되고 상세 사유는 '파트너 API 강제 취소'로 남는다.
              판매자 점수(주문이행)가 내려간다.
       ② 반품요청 단건 조회     GET   v6/vendors/{vendorId}/returnRequests/{receiptId}          (GET_RETURN_REQUEST_BY_RECEIPT)
            · returnItems[].releaseStatus — N 미출고(출고중지 처리 전) · S 출고중지됨 · Y 출고됨 · A 이미출고됨
       ③ 출고중지완료 처리      PATCH v4/vendors/{vendorId}/returnRequests/{receiptId}/stoppedShipment (STOP_RETURN_REQUEST_SHIPMENT)
            · 접수 건이 출고중지요청(RELEASE_STOP_UNCHECKED)이거나 releaseStatus=N 일 때 쓴다.
              cancelCount 는 접수 건의 총 취소수량(cancelCountSum)과 같아야 한다 (접수번호 단위로만 처리된다).
   - 흐름 (묶음 하나): ① 취소 접수 → ② 접수 건 상태 확인 → 출고중지요청으로 남아 있으면 ③ 완료 처리
       문서대로면 ②에서 이미 완료라 ③은 부르지 않는다. WING 처럼 2단계로 남더라도 같은 코드로 끝까지 간다.
   - 실측 (2026-11-12 · hilili · 상품준비중 1건): ① 한 번으로 끝났다 — 1초 뒤 ②가 RETURNS_COMPLETED ·
       releaseStatus=S · releaseStopStatus '처리(출고중지)' · completeConfirmType VENDOR_CONFIRM. ③은 부르지 않았다.
       · ① 성공 본문: code 는 숫자 200, receiptMap 은 접수번호를 키로 묶은 꼴 { "<receiptId>": { receiptId, receiptType, vendorItemIds, totalCount } }
       · ① 거절은 HTTP 200 + 본문 code 400 으로 왔다 ("취소 가능한 개수보다 요청한 개수가 더 많습니다" — 문서는 HTTP 400)
       · 기록된 사유: faultByType VENDOR · reasonCode OOSSELLER(업체 품절) · 사유 카테고리 '오류' › '재고연동오류'
         (보낸 CCTTER 의 뜻과 같다 — 문서의 "입력과 무관하게 고정"과 달리 카테고리는 보낸 코드를 따라간 것으로 보인다) · 상세 '파트너 API 강제 취소'
       · 고객 사유는 보낼 수 없다: WING 화면이 쓰는 값(bigCancelCode=CUSTOMER · middleCancelCode=CHANGEMIND)은
         "취소사유 대분류 코드를 확인해 주세요", CANERR + CHANGEMIND 는 "취소사유 중분류 코드를 확인해 주세요" 로 거절됐다 (주문 변화 없음)
       ①이 접수된 뒤에는 ②·③이 실패해도 그 상품은 취소 접수된 것이다 → 화면·DB 는 취소로 반영하고 '확인 필요'로 알린다.
   - 판매자 취소 대상: 선택한 줄의 남은 수량 전체 (묶음배송번호마다 ① 1회)
   - 고객 취소 요청 대상: 선택한 줄(release_stop)이 든 접수 건 전체 — ③ 은 접수번호 단위로만 처리되므로
       같은 접수 건의 선택하지 않은 상품도 함께 완료된다 (고객이 요청한 수량만큼. 화면에 미리 보여 준다).
       접수 건은 출고중지요청(RU) 목록 최근 60일에서 묶음배송번호 + 옵션ID 로 찾는다
       (personalOrderService.fetchReturnRequests → parseStopRequestReceipts). 실행 때 ②로 상태를 다시 보고
       완료 처리에 쓰는 수량(cancelCountSum)도 그 응답 값을 쓴다.
   - 구성: buildShipmentStopPlan(순수 함수 — 사전 검사·대상 구성) → runShipmentStop(순차 실행)
           → toStoppedRowPatches(반영값) → saveShipmentStopped(DB)
   - 프록시: /api/coupang/order-cancel · return-request-detail · return-request-stop — coupangProxy.ts · prodServer.js 양쪽.
       응답 { success, data: 쿠팡 본문, coupangStatus: 쿠팡 HTTP 상태 }
   - 쿠팡은 등록 IP(Railway)만 받으므로 로컬 dev 에서는 403 — 배포 후에만 실제 확인 가능
   ================================================================ */

import {
  getCoupangHeaders,
  saveOrderRowPatches,
  type OrderRowPatchFields,
  STATUS_MAP,
  type OrderRowPatch,
  type PersonalOrderRow,
} from './personalOrderService'
import { CANCEL_BIG_CODE, CANCEL_MIDDLE_OUT_OF_STOCK } from './orderCancelService'
import { COUPANG_RATE_LIMIT } from '../utils/rateLimitQueue'

// ══════════════════════════════════════════════════════════════════
// 상수
// ══════════════════════════════════════════════════════════════════

/** 출고중지할 수 있는 주문 상태 (상품준비중) */
const STOPPABLE_STATUS = 'INSTRUCT'

/** 프록시 경로 */
const PROXY_PATHS = {
  cancel: '/api/coupang/order-cancel',
  receipt: '/api/coupang/return-request-detail',
  stop: '/api/coupang/return-request-stop',
} as const

/** 쿠팡 응답 성공 코드 (최상위 code) */
const COUPANG_OK_CODE = '200'

/** HTTP 상태 범위 */
const HTTP_SUCCESS_MIN = 200
const HTTP_SUCCESS_MAX = 299
const CLIENT_ERROR_MIN_STATUS = 400
const SERVER_ERROR_MIN_STATUS = 500
/**
 * 4xx 이지만 '거절'로 볼 수 없는 상태 — 처리 시간 초과.
 * 쿠팡 게이트웨이는 시간 초과를 412(Read timed out)로 준다 (반품요청 목록 조회 문서의 오류 사양).
 * 요청이 처리됐을 수 있으므로 반영 여부를 모르는 것으로 다룬다.
 */
const TIMEOUT_STATUSES: ReadonlySet<number> = new Set([408, 412])

/** 취소 응답 receiptType — CANCEL 은 결제완료 건의 즉시 취소 (출고중지 확인 대상이 아니고 단건 조회도 안 된다) */
const RECEIPT_TYPE_IMMEDIATE_CANCEL = 'CANCEL'
/** 접수 건 진행 상태 — 출고중지요청 (판매자가 아직 완료 처리하지 않음) */
const RECEIPT_STATUS_STOP_REQUESTED = 'RELEASE_STOP_UNCHECKED'
/** 접수 건 상품의 출고 여부 (returnItems[].releaseStatus) */
const RELEASE_STATUS = {
  /** 미출고 — 출고중지 처리 전 */
  NOT_RELEASED: 'N',
  /** 출고중지됨 */
  STOPPED: 'S',
} as const
/** 출고중지완료 처리 응답 data.resultCode */
const STOP_RESULT_SUCCESS = 'SUCCESS'

/**
 * 취소 API 가 "출고 정지 요청 롤백에 실패했습니다[접수 아이디]" 로 거절한 경우를 가르는 낱말.
 * 이 오류만 거절인데도 쿠팡에 출고중지요청이 남는다 (문서 오류 사양) — 코드가 따로 없어 문구로 가른다.
 * 못 가려도 쿠팡 문구는 그대로 화면에 나온다.
 */
const ROLLBACK_FAILED_KEYWORD = '롤백'

const UNKNOWN_REASON =
  '쿠팡 응답을 받지 못했습니다 — 취소가 접수됐을 수 있습니다. [주문 업데이트] 후 WING 에서 확인해 주세요'
const ROLLBACK_REASON =
  '쿠팡이 출고중지 처리에 실패했고 접수 건을 되돌리지도 못했습니다 — 출고중지요청이 남아 있을 수 있으니 WING › 출고중지요청에서 확인해 주세요'
const NO_RECEIPT_NOTE =
  '취소는 접수됐지만 응답에 접수번호가 없어 출고중지완료 여부를 확인하지 못했습니다 — WING 에서 확인해 주세요'
const ALL_REJECTED_REASON = '쿠팡이 모든 상품의 취소를 거절했습니다'
const REQUEST_LOOKUP_FAILED_REASON = '쿠팡 출고중지요청 목록을 읽지 못했습니다 — 창을 닫았다가 다시 열어 주세요'
const REQUEST_NOT_FOUND_REASON =
  '쿠팡 출고중지요청 목록(최근 60일)에 이 상품의 접수 건이 없습니다 — 반품접수 건이거나 이미 처리됐을 수 있습니다. [주문 업데이트] 후 확인해 주세요'
const REQUEST_UNKNOWN_REASON =
  '쿠팡 응답을 받지 못했습니다 — 출고중지완료가 처리됐을 수 있습니다. [주문 업데이트] 후 WING › 출고중지요청에서 확인해 주세요'
const ORDER_MISMATCH_REASON = '같은 묶음의 주문번호가 서로 다릅니다 — [주문 업데이트] 후 다시 시도해 주세요'

// ══════════════════════════════════════════════════════════════════
// 타입
// ══════════════════════════════════════════════════════════════════

/** 출고중지할 줄 1개 (옵션 하나) */
export interface StopLine {
  shipmentBoxId: string
  vendorItemId: string
  /** 화면 표시용 '상품명 / 옵션명' */
  itemLabel: string
  /** 취소 수량 — 판매자 취소는 남은 수량 전체, 고객 요청은 고객이 요청한 수량 */
  quantity: number
  /** 주문 수량 (shipping_count) */
  orderedQuantity: number
  /** 처리 전의 취소 수량 (cancel_count) — 처리 뒤 = 이 값 + 처리된 quantity 합 (같은 줄이 여러 건에 나와도 맞게) */
  cancelCountBefore: number
}

/** 판매자 취소 대상 1개 = 묶음 하나 = 쿠팡 취소 요청 1회 (주문번호 + 묶음배송번호) */
export interface StopBox {
  kind: 'sellerCancel'
  /** 화면 · 결과 키 (= 묶음배송번호) */
  key: string
  shipmentBoxId: string
  orderId: string
  receiverName: string
  lines: StopLine[]
  /**
   * 같은 주문에서 이번에 취소하지 않는 상품 수 (0 = 주문 전체 취소).
   * 묶음이 아니라 주문 기준이다 — 분리배송으로 묶음이 나뉜 주문도 남는 상품을 알려 준다.
   */
  otherLinesInOrder: number
}

/** 고객 취소 요청 대상 1개 = 쿠팡 접수 건 하나 = 출고중지완료 처리 1회 */
export interface StopRequest {
  kind: 'customerRequest'
  /** 화면 · 결과 키 (= 접수번호) */
  key: string
  receiptId: string
  orderId: string
  receiverName: string
  /** 접수 건의 상품 전체 — 완료 처리는 접수 건 단위라 선택하지 않은 상품도 함께 처리된다 */
  lines: StopLine[]
  /** lines 중 선택하지 않은 상품 수 */
  unselectedLines: number
  /** 고객이 남긴 취소 사유 (없으면 '') */
  reason: string
}

export type StopTarget = StopBox | StopRequest

/** 출고중지요청(RU) 목록의 접수 건 (parseStopRequestReceipts) */
export interface StopRequestReceipt {
  receiptId: string
  orderId: string
  reason: string
  items: Array<{ shipmentBoxId: string; vendorItemId: string; vendorItemName: string; cancelCount: number }>
}

/** 고객 요청 건의 접수 건 조회 상태 — 고객 요청 줄이 없으면 조회하지 않는다(notNeeded) */
export type RequestLookup =
  | { status: 'notNeeded' }
  | { status: 'loading' }
  | { status: 'ready'; receipts: readonly StopRequestReceipt[] }
  | { status: 'error'; message: string }

/** 사전 검사에서 뺀 줄 */
export interface StopExclusion {
  shipmentBoxId: string
  orderId: string
  vendorItemId: string
  itemLabel: string
  reason: string
}

export interface ShipmentStopPlan {
  /** 판매자 취소 */
  boxes: StopBox[]
  /** 고객 취소 요청 */
  requests: StopRequest[]
  excluded: StopExclusion[]
  /** 접수 건 조회를 기다리는 고객 요청 줄 수 (조회 중일 때만 0 보다 크다) */
  pendingRequestLines: number
}

/**
 * 대상 처리 결과
 * - completed  : 출고중지완료 확인 (판매자 취소는 취소 접수까지 포함)
 * - needsCheck : 판매자 취소가 접수됨(화면 반영) — 완료를 확인하지 못했거나 일부 상품이 거절돼 사람이 봐야 한다
 * - failed     : 쿠팡이 거절 · 처리할 수 없는 상태 — 바뀐 것 없음
 * - unknown    : 처리 여부를 모름 (응답 없음 · 롤백 실패) — 화면에 반영하지 않는다
 * - notSent    : 중단으로 보내지 않음
 */
export type StopOutcome = 'completed' | 'needsCheck' | 'failed' | 'unknown' | 'notSent'

export interface StopResult {
  target: StopTarget
  outcome: StopOutcome
  /** 쿠팡이 처리한 줄 (completed · needsCheck 에서만 채워진다) — 화면·DB 반영 대상 */
  acceptedLines: StopLine[]
  /** 쿠팡이 거절한 줄 (응답 failedVendorItemIds) */
  rejectedLines: StopLine[]
  /** 쿠팡 접수번호 — WING 에서 찾을 때 쓴다 */
  receiptIds: string[]
  /** ③ 출고중지완료 처리를 호출했는지 (판매자 취소: 취소 호출만으로 완료되지 않았다는 뜻 · 고객 요청: 이번에 완료 처리함) */
  usedSecondStep: boolean
  /** 실패 · 확인 사유 (completed 는 '') */
  message: string
}

export interface ShipmentStopRun {
  /** 넘긴 대상과 같은 순서 */
  results: StopResult[]
  aborted: boolean
}

export interface RunShipmentStopOptions {
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
}

// ══════════════════════════════════════════════════════════════════
// 1) 사전 검사 + 대상 구성 (순수 함수 — React·네트워크 없음)
//   판매자 취소: 선택한 줄을 묶음배송번호로 묶는다. 묶음 하나가 쿠팡 취소 요청 1회.
//   고객 요청  : 선택한 줄(release_stop)의 접수 건을 찾는다. 접수 건 하나가 출고중지완료 처리 1회.
//   걸린 줄은 빼고 나머지만 보낸다 — 옵션마다 따로 처리되므로 다른 줄을 막지 않는다.
//   검사 기준은 화면이 가진 주문 — 오래됐으면 쿠팡이 거절한다(바뀌는 것 없음).
// ══════════════════════════════════════════════════════════════════

const isDigits = (v: string | null | undefined): v is string => typeof v === 'string' && /^\d+$/.test(v)

/** 쿠팡 body 에 숫자로 들어가는 ID — 숫자 문자열이고 JS 안전 정수 범위 */
const isSafeId = (v: string | null | undefined): v is string =>
  isDigits(v) && Number.isSafeInteger(Number(v)) && Number(v) > 0

const itemLabelOf = (row: PersonalOrderRow) =>
  row.item_name + (row.option_name ? ` / ${row.option_name}` : '')

const lineKey = (shipmentBoxId: string, vendorItemId: string) => `${shipmentBoxId}|${vendorItemId}`

/**
 * 남은 수량 = 주문 수량 − 취소 확정 수량.
 * 쿠팡 발주서의 발주 가능 수량은 shippingCount − (holdCountForCancel + cancelCount) 인데
 * 환불 대기 수량(holdCountForCancel)은 저장하지 않는다 — 그 경우(고객 취소 요청)는 release_stop 으로 따로 다룬다.
 */
const remainingQuantity = (row: PersonalOrderRow) => (row.shipping_count ?? 0) - (row.cancel_count ?? 0)

/** 아직 나갈 물량이 있는 줄 */
const isActiveRow = (row: PersonalOrderRow) => !row.canceled && remainingQuantity(row) > 0

/** 출고중지할 수 없는 줄이면 사유, 할 수 있으면 null (판매자 취소 · 고객 요청 공통) */
function exclusionReason(row: PersonalOrderRow): string | null {
  if (row.status !== STOPPABLE_STATUS) {
    const label = STATUS_MAP[row.status] ?? (row.status || '알 수 없는')
    return `${label} 상태입니다 — 상품준비중 주문만 출고중지할 수 있습니다`
  }
  if (!isActiveRow(row)) return '이미 취소된 상품입니다'
  if (!isDigits(row.shipment_box_id) || !isSafeId(row.order_id) || !isSafeId(row.vendor_item_id)) {
    return '묶음배송번호 · 주문번호 · 옵션ID 를 읽을 수 없습니다 — [주문 업데이트] 후 다시 시도해 주세요'
  }
  if (!Number.isInteger(remainingQuantity(row))) return '수량이 정수가 아닙니다 — [주문 업데이트] 후 다시 시도해 주세요'
  return null
}

/** 고객 취소 요청 줄인지 — 접수 건 조회가 필요한 줄 */
const isCustomerRequestRow = (row: PersonalOrderRow) => row.release_stop && exclusionReason(row) === null

/** 선택한 줄 중 고객 취소 요청 줄이 있는지 — 있으면 모달을 열 때 접수 건을 조회한다 */
export function needsRequestLookup(selectedRows: readonly PersonalOrderRow[]): boolean {
  return selectedRows.some(isCustomerRequestRow)
}

const toExclusion = (row: PersonalOrderRow, reason: string): StopExclusion => ({
  shipmentBoxId: row.shipment_box_id,
  orderId: row.order_id,
  vendorItemId: row.vendor_item_id,
  itemLabel: itemLabelOf(row),
  reason,
})

/** 판매자 취소 줄 — 남은 수량 전체를 취소하므로 처리 뒤 취소 수량 = 주문 수량 */
const toSellerCancelLine = (row: PersonalOrderRow): StopLine => ({
  shipmentBoxId: row.shipment_box_id,
  vendorItemId: row.vendor_item_id,
  itemLabel: itemLabelOf(row),
  quantity: remainingQuantity(row),
  orderedQuantity: row.shipping_count,
  cancelCountBefore: row.cancel_count ?? 0,
})

type ReceiptItem = StopRequestReceipt['items'][number]

/**
 * 출고중지요청(RU) 목록 원문 → 접수 건 (순수 함수).
 * 접수번호 · 주문번호 · 상품(묶음배송번호 · 옵션ID · 취소 수량)을 읽을 수 없는 건은 뺀다
 * — 그 상품은 계획에서 '접수 건 없음'으로 제외된다.
 */
export function parseStopRequestReceipts(raw: readonly any[]): StopRequestReceipt[] {
  const receipts: StopRequestReceipt[] = []
  for (const entry of raw) {
    const receiptId = String(entry?.receiptId ?? '')
    const orderId = String(entry?.orderId ?? '')
    if (!isSafeId(receiptId) || !isSafeId(orderId)) continue

    const rawItems: any[] = Array.isArray(entry.returnItems) ? entry.returnItems : []
    const items: ReceiptItem[] = rawItems.map((item) => ({
      shipmentBoxId: String(item?.shipmentBoxId ?? ''),
      vendorItemId: String(item?.vendorItemId ?? ''),
      vendorItemName: String(item?.vendorItemName ?? ''),
      cancelCount: Number(item?.cancelCount),
    }))
    const readable = items.length > 0 && items.every((item) =>
      isDigits(item.shipmentBoxId) && isSafeId(item.vendorItemId) &&
      Number.isInteger(item.cancelCount) && item.cancelCount > 0)
    if (!readable) continue

    const category = [entry.cancelReasonCategory1, entry.cancelReasonCategory2]
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .join(' › ')
    const detail = typeof entry.cancelReason === 'string' ? entry.cancelReason.trim() : ''
    receipts.push({ receiptId, orderId, reason: [category, detail].filter(Boolean).join(' — '), items })
  }
  return receipts
}

/** 접수 건 → 고객 요청 대상 (상품 이름 · 주문 수량 · 이미 취소된 수량은 화면이 가진 주문에서) */
function toStopRequest(
  receipt: StopRequestReceipt,
  selectedKeys: ReadonlySet<string>,
  rowByKey: ReadonlyMap<string, PersonalOrderRow>,
): StopRequest {
  const rowOf = (item: ReceiptItem) => rowByKey.get(lineKey(item.shipmentBoxId, item.vendorItemId))
  const lines = receipt.items.map((item): StopLine => {
    const row = rowOf(item)
    const ordered = row?.shipping_count ?? item.cancelCount
    return {
      shipmentBoxId: item.shipmentBoxId,
      vendorItemId: item.vendorItemId,
      itemLabel: row ? itemLabelOf(row) : (item.vendorItemName || `옵션 ${item.vendorItemId}`),
      quantity: item.cancelCount,
      orderedQuantity: ordered,
      cancelCountBefore: row?.cancel_count ?? 0,
    }
  })
  const anyRow = receipt.items.map(rowOf).find((row): row is PersonalOrderRow => row != null)
  return {
    kind: 'customerRequest',
    key: receipt.receiptId,
    receiptId: receipt.receiptId,
    orderId: receipt.orderId,
    receiverName: anyRow?.receiver_name ?? '',
    lines,
    unselectedLines: lines.filter((line) => !selectedKeys.has(lineKey(line.shipmentBoxId, line.vendorItemId))).length,
    reason: receipt.reason,
  }
}

/**
 * 선택한 줄 + 화면이 가진 주문(계정 전체) + 고객 요청 접수 건 → 출고중지 계획.
 * @param selectedRows 체크한 줄
 * @param orders 계정 전체 주문 — 같은 주문에서 취소하지 않는 상품 수 · 접수 건 상품의 이름과 수량을 찾는 데 쓴다
 * @param lookup 출고중지요청 접수 건 조회 상태 (고객 요청 줄이 없으면 notNeeded)
 */
export function buildShipmentStopPlan(
  selectedRows: readonly PersonalOrderRow[],
  orders: readonly PersonalOrderRow[],
  lookup: RequestLookup,
): ShipmentStopPlan {
  const excluded: StopExclusion[] = []
  const rowByKey = new Map(orders.map((row) => [lineKey(row.shipment_box_id, row.vendor_item_id), row]))
  // 한 상품에 접수 건이 여럿일 수 있다 (고객이 수량을 나눠 요청) — 모두 처리한다
  const receiptsByLine = new Map<string, StopRequestReceipt[]>()
  if (lookup.status === 'ready') {
    for (const receipt of lookup.receipts) {
      for (const item of receipt.items) {
        const key = lineKey(item.shipmentBoxId, item.vendorItemId)
        const list = receiptsByLine.get(key)
        if (list) list.push(receipt)
        else receiptsByLine.set(key, [receipt])
      }
    }
  }

  // 판매자 취소는 묶음배송번호로, 고객 요청은 접수번호로 모은다 (선택 순서 유지 · 같은 줄이 두 번 오면 한 번만)
  const rowsByBox = new Map<string, PersonalOrderRow[]>()
  const requestReceipts = new Map<string, { receipt: StopRequestReceipt; selectedKeys: Set<string> }>()
  let pendingRequestLines = 0
  const seen = new Set<string>()
  for (const row of selectedRows) {
    const key = lineKey(row.shipment_box_id, row.vendor_item_id)
    if (seen.has(key)) continue
    seen.add(key)

    const reason = exclusionReason(row)
    if (reason) { excluded.push(toExclusion(row, reason)); continue }

    // ── 고객 취소 요청 줄 — 접수 건을 찾아 그 건 단위로 ──
    if (row.release_stop) {
      if (lookup.status === 'loading') { pendingRequestLines++; continue }
      if (lookup.status !== 'ready') {
        const detail = lookup.status === 'error' ? ` (${lookup.message})` : ''
        excluded.push(toExclusion(row, `${REQUEST_LOOKUP_FAILED_REASON}${detail}`))
        continue
      }
      const receipts = (receiptsByLine.get(key) ?? []).filter((receipt) => receipt.orderId === row.order_id)
      if (receipts.length === 0) {
        excluded.push(toExclusion(row, REQUEST_NOT_FOUND_REASON))
        continue
      }
      for (const receipt of receipts) {
        const entry = requestReceipts.get(receipt.receiptId)
        if (entry) entry.selectedKeys.add(key)
        else requestReceipts.set(receipt.receiptId, { receipt, selectedKeys: new Set([key]) })
      }
      continue
    }

    // ── 판매자 취소 줄 ──
    const list = rowsByBox.get(row.shipment_box_id)
    if (list) list.push(row)
    else rowsByBox.set(row.shipment_box_id, [row])
  }

  // 묶음 구성 — 한 묶음의 주문번호는 하나여야 한다
  const drafts: Array<{ shipmentBoxId: string; orderId: string; rows: PersonalOrderRow[] }> = []
  for (const [shipmentBoxId, rows] of rowsByBox) {
    const orderId = rows[0].order_id
    if (rows.some((r) => r.order_id !== orderId)) {
      for (const row of rows) excluded.push(toExclusion(row, ORDER_MISMATCH_REASON))
      continue
    }
    drafts.push({ shipmentBoxId, orderId, rows })
  }

  // 주문별 '취소되지 않은 상품 수' − '이번에 취소할 상품 수' = 같은 주문에 남는 상품 수
  const countBy = (list: readonly PersonalOrderRow[]) => {
    const counts = new Map<string, number>()
    for (const row of list) counts.set(row.order_id, (counts.get(row.order_id) ?? 0) + 1)
    return counts
  }
  const activeByOrder = countBy(orders.filter(isActiveRow))
  const stoppingByOrder = countBy(drafts.flatMap((draft) => draft.rows))

  const boxes: StopBox[] = drafts.map(({ shipmentBoxId, orderId, rows }) => {
    const stopping = stoppingByOrder.get(orderId) ?? 0
    return {
      kind: 'sellerCancel',
      key: shipmentBoxId,
      shipmentBoxId,
      orderId,
      receiverName: rows[0].receiver_name,
      lines: rows.map(toSellerCancelLine),
      otherLinesInOrder: Math.max(0, (activeByOrder.get(orderId) ?? stopping) - stopping),
    }
  })
  const requests = Array.from(requestReceipts.values(), ({ receipt, selectedKeys }) =>
    toStopRequest(receipt, selectedKeys, rowByKey))
  return { boxes, requests, excluded, pendingRequestLines }
}

// ══════════════════════════════════════════════════════════════════
// 2) 프록시 호출 — 결과를 세 가지로만 가른다 (throw 하지 않는다)
//   ok       : 쿠팡 HTTP 2xx — 본문(code · data) 판정은 부른 쪽이 한다
//   rejected : 쿠팡(4xx) 또는 프록시(검증 400 · 키 없음 401)가 거절 — 반영되지 않았다
//   unknown  : 응답을 못 받음 (네트워크 · 5xx · 시간 초과) — 반영 여부를 모른다. 자동 재시도하지 않는다
// ══════════════════════════════════════════════════════════════════

type ProxyOutcome =
  | { kind: 'ok'; body: any }
  | { kind: 'rejected'; message: string }
  | { kind: 'unknown'; message: string }

const isClientError = (status: number) =>
  status >= CLIENT_ERROR_MIN_STATUS && status < SERVER_ERROR_MIN_STATUS && !TIMEOUT_STATUSES.has(status)

async function callProxy(path: string, init: RequestInit): Promise<ProxyOutcome> {
  let res: Response
  try {
    res = await fetch(path, init)
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

  // ── 프록시 레벨 실패 — 4xx 는 쿠팡에 보내기 전에 막힌 것, 5xx 는 쿠팡 호출 중 예외(반영 여부 모름) ──
  if (!json?.success) {
    const message: string = json?.error || `프록시 오류 (HTTP ${res.status})`
    return isClientError(res.status) ? { kind: 'rejected', message } : { kind: 'unknown', message }
  }

  // ── 쿠팡 응답 — HTTP 상태(coupangStatus)로 가른다 ──
  const status: unknown = json.coupangStatus
  const body = json.data ?? {}
  if (typeof status !== 'number') return { kind: 'unknown', message: '쿠팡 응답 상태를 받지 못했습니다' }
  if (status >= HTTP_SUCCESS_MIN && status <= HTTP_SUCCESS_MAX) return { kind: 'ok', body }
  const message = String(body.message || body.error || `쿠팡이 요청을 거절했습니다 (HTTP ${status})`)
  return isClientError(status) ? { kind: 'rejected', message } : { kind: 'unknown', message }
}

/** 실행 한 번이 공유하는 값 */
interface RunContext {
  headers: Record<string, string>
  /** 쿠팡 WING 로그인 ID — 취소 요청의 userId */
  wingUserId: string
  /** 쿠팡 호출 직전에 부른다 — 호출 사이 간격을 지킨다 */
  pace: () => Promise<void>
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 호출 시작 사이에 최소 intervalMs 를 두는 대기 함수 (첫 호출은 바로) */
function createPacer(intervalMs: number): () => Promise<void> {
  let lastStartedAt = 0
  return async () => {
    const wait = lastStartedAt + intervalMs - Date.now()
    if (wait > 0) await delay(wait)
    lastStartedAt = Date.now()
  }
}

// ── ① 주문 상품 취소 처리 ──
async function requestOrderCancel(box: StopBox, ctx: RunContext): Promise<ProxyOutcome> {
  await ctx.pace()
  return callProxy(PROXY_PATHS.cancel, {
    method: 'POST',
    headers: { ...ctx.headers, 'Content-Type': 'application/json' },
    // ID 는 숫자 문자열 — 프록시가 숫자로 바꾼다. vendorItemIds 와 receiptCounts 는 같은 순서의 한 쌍
    body: JSON.stringify({
      orderId: box.orderId,
      vendorItemIds: box.lines.map((line) => line.vendorItemId),
      receiptCounts: box.lines.map((line) => line.quantity),
      bigCancelCode: CANCEL_BIG_CODE,
      // 상품준비중 취소는 쿠팡이 입력과 무관하게 '품절'로 기록한다 — 같은 뜻의 재고 사유로 보낸다
      middleCancelCode: CANCEL_MIDDLE_OUT_OF_STOCK,
      userId: ctx.wingUserId,
    }),
  })
}

// ── ② 반품요청 단건 조회 ──
async function requestReceipt(receiptId: string, ctx: RunContext): Promise<ProxyOutcome> {
  await ctx.pace()
  return callProxy(`${PROXY_PATHS.receipt}?receiptId=${encodeURIComponent(receiptId)}`, { headers: ctx.headers })
}

// ── ③ 출고중지완료 처리 ──
async function requestStopComplete(receiptId: string, cancelCount: number, ctx: RunContext): Promise<ProxyOutcome> {
  await ctx.pace()
  return callProxy(PROXY_PATHS.stop, {
    method: 'PATCH',
    headers: { ...ctx.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiptId, cancelCount }),
  })
}

// ══════════════════════════════════════════════════════════════════
// 3) 응답 해석 (순수 함수)
// ══════════════════════════════════════════════════════════════════

const isCoupangOk = (body: any) => String(body?.code ?? '') === COUPANG_OK_CODE

interface CancelReceipt {
  receiptId: string
  receiptType: string
}

/**
 * 취소 응답의 접수 정보 모으기.
 * 문서 표는 한 접수 건의 필드(receiptId · receiptType · vendorItemIds · totalCount)를 직접 가진 객체로 적혀 있지만
 * 실제 응답은 접수번호를 키로 묶은 꼴이다 (실측 2026-11-12: { "1953…": { receiptId, receiptType, … } }).
 * 문서 꼴과 묶인 꼴을 모두 읽는다.
 */
function collectReceipts(node: unknown): CancelReceipt[] {
  if (!node || typeof node !== 'object') return []
  const fields = node as Record<string, unknown>
  if (fields.receiptId != null) {
    return [{ receiptId: String(fields.receiptId), receiptType: String(fields.receiptType ?? '') }]
  }
  return Object.values(fields).flatMap(collectReceipts)
}

type CancelVerdict =
  | { kind: 'accepted'; receipts: CancelReceipt[]; acceptedLines: StopLine[]; rejectedLines: StopLine[] }
  | { kind: 'failed'; message: string }
  | { kind: 'unknown'; message: string }

/** 거절 문구 → 실패 / 확인 필요(롤백 실패는 쿠팡에 출고중지요청이 남는다) */
function rejectionVerdict(message: string): CancelVerdict {
  return message.includes(ROLLBACK_FAILED_KEYWORD)
    ? { kind: 'unknown', message: `${ROLLBACK_REASON} (${message})` }
    : { kind: 'failed', message }
}

/**
 * ① 취소 응답 판정.
 * 성공은 HTTP 2xx 이고 본문 code 가 200 인 경우뿐이다 ("200 - 전체/부분 취소 성공, 400 - 취소 실패").
 * 부분 성공이면 거절된 옵션이 failedVendorItemIds 로 온다 (문서 표에는 failedItemIds — 둘 다 읽는다).
 */
function judgeCancel(box: StopBox, outcome: ProxyOutcome): CancelVerdict {
  if (outcome.kind === 'unknown') return { kind: 'unknown', message: `${UNKNOWN_REASON} (${outcome.message})` }
  if (outcome.kind === 'rejected') return rejectionVerdict(outcome.message)
  if (!isCoupangOk(outcome.body)) {
    return rejectionVerdict(String(outcome.body?.message || '쿠팡이 취소를 거절했습니다'))
  }

  const data = outcome.body.data ?? {}
  const failedIds: unknown = data.failedVendorItemIds ?? data.failedItemIds
  const failed = new Set((Array.isArray(failedIds) ? failedIds : []).map(String))
  const acceptedLines = box.lines.filter((line) => !failed.has(line.vendorItemId))
  if (acceptedLines.length === 0) {
    return { kind: 'failed', message: String(outcome.body.message || ALL_REJECTED_REASON) }
  }
  return {
    kind: 'accepted',
    receipts: collectReceipts(data.receiptMap ?? data.ReceiptMap),
    acceptedLines,
    rejectedLines: box.lines.filter((line) => failed.has(line.vendorItemId)),
  }
}

/**
 * 접수 건의 출고중지 처리 상태
 * - stopped    : 출고중지 완료
 * - pending    : 출고중지요청으로 남아 있음 → ③ 완료 처리 대상 (cancelCount = 총 취소수량)
 * - other      : 그 밖의 상태 (이미출고 등) — 사람이 확인
 * - unreadable : 조회 실패
 */
type ReceiptState =
  | { kind: 'stopped' }
  | { kind: 'pending'; cancelCount: number }
  | { kind: 'other'; description: string }
  | { kind: 'unreadable'; message: string }

/** 접수 건의 총 취소수량 — cancelCountSum, 없으면 상품별 cancelCount 합 */
function readCancelCount(receipt: any, items: any[]): number | null {
  const sum = Number(receipt.cancelCountSum)
  if (Number.isInteger(sum) && sum > 0) return sum
  const fromItems = items.reduce((total, item) => total + Number(item?.cancelCount ?? 0), 0)
  return Number.isInteger(fromItems) && fromItems > 0 ? fromItems : null
}

/**
 * ② 단건 조회 본문 → 상태.
 * 완료 처리 대상(pending)을 넓게 잡는다 — 완료됐다고 잘못 알리는 것보다 한 번 더 완료 처리를 시도하는 편이 안전하다
 * (자기가 방금 만든 접수 건이라 완료 처리가 곧 원래 하려던 일이고, 이미 끝난 건이면 쿠팡이 거절할 뿐이다).
 */
function classifyReceipt(receipt: any): ReceiptState {
  const items: any[] = Array.isArray(receipt.returnItems) ? receipt.returnItems : []
  const stopRequested =
    receipt.receiptStatus === RECEIPT_STATUS_STOP_REQUESTED ||
    items.some((item) => item?.releaseStatus === RELEASE_STATUS.NOT_RELEASED)
  if (stopRequested) {
    const cancelCount = readCancelCount(receipt, items)
    return cancelCount == null
      ? { kind: 'other', description: '출고중지요청 상태인데 취소수량을 읽을 수 없습니다' }
      : { kind: 'pending', cancelCount }
  }
  if (items.length > 0 && items.every((item) => item?.releaseStatus === RELEASE_STATUS.STOPPED)) {
    return { kind: 'stopped' }
  }
  const status = String(receipt.receiptStatus ?? '상태 없음')
  const releaseStop = receipt.releaseStopStatus ? ` · 출고중지처리상태 ${receipt.releaseStopStatus}` : ''
  return { kind: 'other', description: `${status}${releaseStop}` }
}

async function readReceiptState(receiptId: string, ctx: RunContext): Promise<ReceiptState> {
  const outcome = await requestReceipt(receiptId, ctx)
  if (outcome.kind !== 'ok') return { kind: 'unreadable', message: outcome.message }
  if (!isCoupangOk(outcome.body)) {
    return { kind: 'unreadable', message: String(outcome.body?.message || '접수 건 조회 실패') }
  }
  // data 는 배열(접수 건 1개) — 요청한 접수번호의 것만 쓴다
  const data: unknown = outcome.body.data
  const list: any[] = Array.isArray(data) ? data : [data]
  const receipt = list.find((entry) => entry && String(entry.receiptId) === receiptId)
  return receipt ? classifyReceipt(receipt) : { kind: 'unreadable', message: '응답에 접수 건이 없습니다' }
}

// ══════════════════════════════════════════════════════════════════
// 4) 실행 — 대상을 하나씩. 판매자 취소는 ① → ② → (③), 고객 요청은 ② → (③) 를 끝까지
//   중단(signal)은 대상 사이에서만 확인한다 — 보낸 대상은 확인까지 마친다.
//   쿠팡 호출 사이에는 COUPANG_RATE_LIMIT.intervalMs 이상 둔다.
// ══════════════════════════════════════════════════════════════════

interface ReceiptConfirmation {
  confirmed: boolean
  usedSecondStep: boolean
  /** 확인하지 못한 사유 (confirmed 면 '') */
  detail: string
}

/** ② 상태 확인 → 출고중지요청으로 남아 있으면 ③ 완료 처리 */
async function confirmReceiptStopped(receiptId: string, ctx: RunContext): Promise<ReceiptConfirmation> {
  const tag = `접수번호 ${receiptId}`
  const state = await readReceiptState(receiptId, ctx)
  if (state.kind === 'stopped') return { confirmed: true, usedSecondStep: false, detail: '' }
  if (state.kind === 'unreadable') {
    return {
      confirmed: false,
      usedSecondStep: false,
      detail: `${tag}: 취소는 접수됐지만 출고중지완료 여부를 조회하지 못했습니다 (${state.message}) — WING › 출고중지요청에서 확인해 주세요`,
    }
  }
  if (state.kind === 'other') {
    return {
      confirmed: false,
      usedSecondStep: false,
      detail: `${tag}: 출고중지 완료 상태가 아닙니다 (${state.description}) — WING 에서 확인해 주세요`,
    }
  }

  // ── ③ 완료 처리 — 성공 응답이면 끝. 아니면 마지막으로 상태를 다시 본다 (그 사이 처리가 끝났을 수 있다) ──
  const stop = await requestStopComplete(receiptId, state.cancelCount, ctx)
  if (stop.kind === 'ok' && stop.body?.data?.resultCode === STOP_RESULT_SUCCESS) {
    return { confirmed: true, usedSecondStep: true, detail: '' }
  }
  const recheck = await readReceiptState(receiptId, ctx)
  if (recheck.kind === 'stopped') return { confirmed: true, usedSecondStep: true, detail: '' }
  const stopMessage = stop.kind === 'ok'
    ? String(stop.body?.data?.resultMessage || stop.body?.message || '응답에 결과가 없습니다')
    : stop.message
  return {
    confirmed: false,
    usedSecondStep: true,
    detail: `${tag}: 출고중지요청은 접수됐지만 완료 처리에 실패했습니다 (${stopMessage}) — WING › 출고중지요청에서 완료 처리해 주세요`,
  }
}

const emptyResult = (target: StopTarget, outcome: StopOutcome, message: string): StopResult => ({
  target, outcome, acceptedLines: [], rejectedLines: [], receiptIds: [], usedSecondStep: false, message,
})

/** 판매자 취소 — 묶음 1개 처리 */
async function stopBox(box: StopBox, ctx: RunContext): Promise<StopResult> {
  // ① 취소 접수
  const verdict = judgeCancel(box, await requestOrderCancel(box, ctx))
  if (verdict.kind !== 'accepted') return emptyResult(box, verdict.kind, verdict.message)

  const { receipts, acceptedLines, rejectedLines } = verdict
  const notes: string[] = []
  if (rejectedLines.length > 0) {
    notes.push(`쿠팡이 일부 상품의 취소를 거절했습니다 (옵션ID ${rejectedLines.map((l) => l.vendorItemId).join(', ')})`)
  }
  if (receipts.length === 0) notes.push(NO_RECEIPT_NOTE)

  // ② · ③ 접수 건마다 출고중지완료 확인 (즉시 취소 접수는 확인 대상이 아니다)
  let usedSecondStep = false
  for (const receipt of receipts) {
    if (receipt.receiptType === RECEIPT_TYPE_IMMEDIATE_CANCEL) continue
    const confirmation = await confirmReceiptStopped(receipt.receiptId, ctx)
    usedSecondStep = usedSecondStep || confirmation.usedSecondStep
    if (!confirmation.confirmed) notes.push(confirmation.detail)
  }

  return {
    target: box,
    outcome: notes.length === 0 ? 'completed' : 'needsCheck',
    acceptedLines,
    rejectedLines,
    receiptIds: receipts.map((r) => r.receiptId),
    usedSecondStep,
    message: notes.join(' / '),
  }
}

/**
 * 고객 취소 요청 — 접수 건 1개 처리: ② 상태 확인 → 출고중지요청이면 ③ 완료 처리.
 * ① 취소는 보내지 않는다 (고객이 이미 요청했다). 완료 처리 수량은 ② 응답의 cancelCountSum.
 * 이미 출고중지된 건이면 보낼 것 없이 화면만 맞춘다.
 */
async function completeRequest(request: StopRequest, ctx: RunContext): Promise<StopResult> {
  const { receiptId } = request
  const done = (usedSecondStep: boolean): StopResult => ({
    target: request, outcome: 'completed', acceptedLines: request.lines, rejectedLines: [],
    receiptIds: [receiptId], usedSecondStep, message: '',
  })
  const notDone = (outcome: 'failed' | 'unknown', message: string): StopResult =>
    ({ ...emptyResult(request, outcome, message), receiptIds: [receiptId] })

  const state = await readReceiptState(receiptId, ctx)
  if (state.kind === 'stopped') return done(false)
  if (state.kind === 'unreadable') return notDone('failed', `접수 건을 조회하지 못해 보내지 않았습니다 (${state.message})`)
  if (state.kind === 'other') {
    return notDone('failed', `출고중지요청 상태가 아니라 보내지 않았습니다 (${state.description}) — WING 에서 확인해 주세요`)
  }

  // ── ③ 완료 처리 — 성공 응답이 아니면 상태를 다시 본다 (그 사이 처리가 끝났을 수 있다) ──
  const stop = await requestStopComplete(receiptId, state.cancelCount, ctx)
  if (stop.kind === 'ok' && stop.body?.data?.resultCode === STOP_RESULT_SUCCESS) return done(true)
  const recheck = await readReceiptState(receiptId, ctx)
  if (recheck.kind === 'stopped') return done(true)
  if (stop.kind === 'unknown') return notDone('unknown', `${REQUEST_UNKNOWN_REASON} (${stop.message})`)
  const stopMessage = stop.kind === 'ok'
    ? String(stop.body?.data?.resultMessage || stop.body?.message || '응답에 결과가 없습니다')
    : stop.message
  return notDone('failed', `쿠팡이 출고중지완료 처리를 거절했습니다 (${stopMessage}) — WING › 출고중지요청에서 확인해 주세요`)
}

/**
 * 준비된 대상을 차례로 처리한다 (판매자 취소 · 고객 요청을 넘긴 순서대로).
 * 쿠팡 키가 없으면 첫 요청 전에 throw — 그 밖의 실패는 결과에 담고 throw 하지 않는다.
 * @param wingUserId 쿠팡 WING 로그인 ID (si_users.coupang_user_name) — 판매자 취소에만 쓴다
 */
export async function runShipmentStop(
  targets: readonly StopTarget[],
  wingUserId: string,
  options: RunShipmentStopOptions = {},
): Promise<ShipmentStopRun> {
  const { signal, onProgress } = options
  const ctx: RunContext = {
    headers: getCoupangHeaders(),
    wingUserId,
    pace: createPacer(COUPANG_RATE_LIMIT.intervalMs),
  }
  const results: StopResult[] = []
  let aborted = false
  onProgress?.(0, targets.length)

  for (const target of targets) {
    if (aborted || signal?.aborted) {
      aborted = true
      results.push(emptyResult(target, 'notSent', '보내지 않음 — 다시 선택해 실행하면 됩니다'))
      continue
    }
    try {
      results.push(target.kind === 'sellerCancel' ? await stopBox(target, ctx) : await completeRequest(target, ctx))
    } catch (err) {
      // 처리 중 예상하지 못한 오류 — 어디까지 갔는지 모르므로 반영 여부를 모르는 것으로 둔다
      console.error('[출고중지] 처리 오류:', target.key, err)
      const detail = err instanceof Error ? err.message : String(err)
      const reason = target.kind === 'sellerCancel' ? UNKNOWN_REASON : REQUEST_UNKNOWN_REASON
      results.push(emptyResult(target, 'unknown', `${reason} (${detail})`))
    }
    onProgress?.(results.length, targets.length)
  }

  return { results, aborted }
}

// ══════════════════════════════════════════════════════════════════
// 5) 반영 — 쿠팡이 처리한 줄을 화면(items)과 coupang_personal_orders 에 같은 값으로 쓴다
//   취소 수량 = 처리 전 취소 수량 + 이번에 처리된 수량 합 (주문 수량을 넘지 않게), 전량이면 canceled = true.
//   같은 줄이 여러 접수 건에 나오면 한 줄로 합친다 (줄마다 따로 쓰면 마지막 값만 남는다).
//   고객 요청은 요청이 끝났으므로 release_stop 을 내린다 (일부 수량만 요청한 건은 남은 수량이 다시 출고 대상).
//   취소된 줄은 [배송준비]·사입관리 '개인' 수량·출고준비에서 빠진다 (canceled 를 본다).
//   다음 [주문 업데이트] 가 쿠팡 값으로 다시 덮는다.
// ══════════════════════════════════════════════════════════════════

/** 처리 결과 → 줄별 반영값 (처리된 줄만, 줄마다 1개) */
export function toStoppedRowPatches(results: readonly StopResult[]): OrderRowPatch[] {
  const byLine = new Map<string, { line: StopLine; processed: number; customerRequest: boolean }>()
  for (const result of results) {
    for (const line of result.acceptedLines) {
      const key = lineKey(line.shipmentBoxId, line.vendorItemId)
      const entry = byLine.get(key) ?? { line, processed: 0, customerRequest: false }
      entry.processed += line.quantity
      entry.customerRequest = entry.customerRequest || result.target.kind === 'customerRequest'
      byLine.set(key, entry)
    }
  }
  return Array.from(byLine.values(), ({ line, processed, customerRequest }) => {
    const cancelCount = Math.min(line.orderedQuantity, line.cancelCountBefore + processed)
    const patch: OrderRowPatchFields = { canceled: cancelCount >= line.orderedQuantity, cancel_count: cancelCount }
    if (customerRequest) patch.release_stop = false
    return { shipmentBoxId: line.shipmentBoxId, vendorItemId: line.vendorItemId, patch }
  })
}

/** 처리된 줄을 DB 에 반영 — 실패한 묶음배송번호를 돌려준다 (쿠팡에는 처리됨 → [주문 업데이트] 로 맞춰진다) */
export function saveShipmentStopped(
  userId: string,
  patches: readonly OrderRowPatch[],
): Promise<{ failedBoxIds: string[] }> {
  return saveOrderRowPatches(userId, patches, '출고중지')
}
