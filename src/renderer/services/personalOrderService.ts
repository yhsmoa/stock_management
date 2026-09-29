/* ================================================================
   개인주문 (PersonalOrder) 서비스
   - Vite 프록시를 통한 쿠팡 발주서 목록 API 호출
   - 상태별 기간 분할 호출 (31일 제한 준수)
   - Supabase coupang_personal_orders 테이블 CRUD
   ================================================================ */

import { supabase } from './supabase'
import type { AuthUser } from '../types/auth'

// ── 상수 ──────────────────────────────────────────────────────────
const SUPABASE_BATCH_SIZE = 500
const SUPABASE_PAGE_SIZE = 1000      // PostgREST 기본 반환 상한 — 조회 루프 단위
const SUPABASE_IN_DELETE_SIZE = 300  // .in() 삭제 청크 (URL 길이 보호)
const ORDERSHEET_MAX_PER_PAGE = 50  // 쿠팡 API 최대값 (1회 요청당 행 수)

// ── prune 안전장치 ────────────────────────────────────────────────
//   쿠팡이 에러 없이 일부 상태만 빈 배열로 돌려주면 "안 온 행" 이 대량으로
//   잡혀 기존 주문이 한꺼번에 지워진다. 삭제 대상이 아래 기준을 넘으면
//   호출 측(훅)이 사용자 확인을 받은 뒤 forcePrune 으로 다시 호출한다.
//   기준: max(PRUNE_GUARD_MIN, 기존 행수 × PRUNE_GUARD_RATIO)
const PRUNE_GUARD_MIN = 50
const PRUNE_GUARD_RATIO = 0.3
const FETCH_CONCURRENCY = 2          // rate limit 보호용 동시 요청 제한
const MAX_RETRIES = 3                // 요청 실패 시 재시도 횟수
const RETRY_BASE_DELAY_MS = 500      // 지수 백오프 기본 지연 (0.5s, 1s, 2s)

// ══════════════════════════════════════════════════════════════════
// 동시 실행 제한 러너 — Promise-returning 함수 배열을 limit 만큼만 동시 실행
// - 세마포어/풀 패턴: cursor 기반 워커가 태스크를 하나씩 집어감
// - 실패 전파: 한 건이라도 throw 하면 전체 reject
// - 결과 순서는 입력 순서 유지
// ══════════════════════════════════════════════════════════════════

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let cursor = 0

  async function worker() {
    while (true) {
      const idx = cursor++
      if (idx >= tasks.length) return
      results[idx] = await tasks[idx]()
    }
  }

  const workerCount = Math.min(limit, tasks.length)
  await Promise.all(Array.from({ length: workerCount }, worker))
  return results
}

// ── 상태 코드 매핑 ────────────────────────────────────────────────
/** 쿠팡 API 상태코드 → 한글 */
export const STATUS_MAP: Record<string, string> = {
  ACCEPT: '결제완료',
  INSTRUCT: '상품준비중',
  DEPARTURE: '배송지시',
  DELIVERING: '배송중',
  FINAL_DELIVERY: '배송완료',
  NONE_TRACKING: '업체직송',
}

/** 한글 → 쿠팡 API 상태코드 */
export const STATUS_REVERSE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_MAP).map(([k, v]) => [v, k])
)

// ── 개인주문 행 타입 ──────────────────────────────────────────────
export interface PersonalOrderRow {
  id?: string
  user_id: string
  vendor_id: string
  shipment_box_id: string
  order_id: string
  status: string
  seller_product_id: string
  product_id: string
  vendor_item_id: string
  item_name: string
  option_name: string
  product_name: string
  shipping_count: number
  sales_price_units: number
  order_price_units: number
  delivery_company_name: string
  invoice_number: string
  // 이용자가 송장 xlsx로 등록한 운송장번호 (API invoice_number 가 비었을 때 표시).
  // 새로 추가된 컬럼 — [업데이트] 재삽입 시 별도 보존 로직으로 유지.
  pending_invoice_number?: string | null
  estimated_shipping_date: string | null
  planned_shipping_date: string | null
  in_transit_date_time: string | null
  orderer_name: string
  receiver_name: string
  receiver_safe_number: string
  receiver_post_code: string
  receiver_address: string
  ordered_at: string | null
  paid_at: string | null
  delivered_date: string | null
  parcel_print_message: string
  split_shipping: string
  shipment_type: string
  refer: string
  canceled: boolean
  cancel_count: number
  external_vendor_sku_code: string
  // 로켓그로스 바코드 — [바코드 연결] 이 채운다. API 변환 시엔 '' 이지만
  // savePersonalOrders 가 기존 행의 값을 이월하므로 [업데이트] 로 지워지지 않는다.
  barcode: string
  note: string
  release_stop: boolean  // 출고중지요청(RU) 또는 반품접수(UC) 대상 여부
  updated_at?: string
}

// ══════════════════════════════════════════════════════════════════
// 쿠팡 인증 (purchaseService.ts와 동일 패턴)
// ══════════════════════════════════════════════════════════════════

function getCoupangCredentials() {
  const raw = localStorage.getItem('user')
  if (!raw) throw new Error('로그인 정보가 없습니다. 다시 로그인해 주세요.')

  const user: AuthUser = JSON.parse(raw)
  if (!user.coupang_access_key || !user.coupang_secret_key || !user.vendor_id) {
    throw new Error('쿠팡 API 키가 설정되지 않았습니다. 관리자에게 문의하세요.')
  }

  return {
    accessKey: user.coupang_access_key,
    secretKey: user.coupang_secret_key,
    vendorCode: user.vendor_id,
  }
}

function getCoupangHeaders(): Record<string, string> {
  const { accessKey, secretKey, vendorCode } = getCoupangCredentials()
  return {
    'X-Coupang-Access-Key': accessKey,
    'X-Coupang-Secret-Key': secretKey,
    'X-Vendor-Code': vendorCode,
  }
}

// ══════════════════════════════════════════════════════════════════
// 날짜 유틸
// ══════════════════════════════════════════════════════════════════

/** N일 전 날짜를 yyyy-mm-dd 형식으로 반환 */
function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

/** 오늘 날짜를 yyyy-mm-dd 형식으로 반환 */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 쿠팡 API용 날짜 포맷: yyyy-mm-dd+09:00 → URL 인코딩 시 %2B */
function toCoupangDate(date: string): string {
  return `${date}+09:00`
}

// ══════════════════════════════════════════════════════════════════
// 쿠팡 응답 검증 — 에러 본문을 '0건'으로 오인하지 않도록
//   프록시(callCoupangAPI)는 HTTP 상태와 무관하게 쿠팡 JSON 을 그대로
//   { success: true, data } 로 넘긴다. 인증 실패·IP 미허용·호출 제한 같은
//   쿠팡 에러도 success=true 로 오므로, 여기서 걸러내지 않으면
//   "조회 0건" 으로 처리되고 → 저장 단계의 prune 이 기존 주문을 전부 지운다.
//   성공 판정: data 가 배열이거나, 성공 코드(200/SUCCESS)인 경우만.
// ══════════════════════════════════════════════════════════════════

const COUPANG_SUCCESS_CODES = new Set(['200', 'SUCCESS'])

function assertCoupangListResponse(apiData: any, label: string): void {
  if (Array.isArray(apiData?.data)) return
  if (COUPANG_SUCCESS_CODES.has(String(apiData?.code ?? ''))) return
  const detail = apiData?.message
    ?? (apiData == null ? '응답 없음' : JSON.stringify(apiData).slice(0, 200))
  throw new Error(`쿠팡 ${label} 조회 실패: ${detail}`)
}

// ══════════════════════════════════════════════════════════════════
// 쿠팡 발주서 API 호출
// ══════════════════════════════════════════════════════════════════

/**
 * 단일 페이지 호출 (재시도 포함) — 빈 응답/500 에러 시 지수 백오프로 재시도
 * - 프록시가 Coupang 비JSON 응답을 status=500 + error 로 래핑해주므로
 *   이 함수에서는 JSON 응답이 보장됨
 */
async function fetchOrdersheetsPage(
  params: URLSearchParams,
  headers: Record<string, string>,
): Promise<any> {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`/api/coupang/ordersheets?${params.toString()}`, { headers })
      const text = await res.text()
      if (!text) {
        throw new Error(`프록시 응답 비어있음 (status=${res.status})`)
      }
      const json = JSON.parse(text)
      if (!json.success) {
        throw new Error(json.error || `발주서 조회 실패 (status=${res.status})`)
      }
      assertCoupangListResponse(json.data, '발주서')
      return json.data
    } catch (err: any) {
      lastErr = err
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
        console.warn(
          `[ordersheets 재시도] ${attempt + 1}/${MAX_RETRIES} — ${err.message} (${delay}ms 대기)`,
        )
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }
  throw lastErr ?? new Error('발주서 조회 실패 (알 수 없는 오류)')
}

/** 특정 상태 + 기간에 대한 발주서 목록 조회 (nextToken 페이징) */
async function fetchOrdersheetsByStatus(
  status: string,
  fromDate: string,
  toDate: string,
): Promise<any[]> {
  const headers = getCoupangHeaders()
  let allData: any[] = []
  let nextToken: string | null = null

  do {
    const params = new URLSearchParams({
      createdAtFrom: toCoupangDate(fromDate),
      createdAtTo: toCoupangDate(toDate),
      status,
      maxPerPage: String(ORDERSHEET_MAX_PER_PAGE),
    })
    if (nextToken) params.set('nextToken', nextToken)

    const apiData = await fetchOrdersheetsPage(params, headers)

    if (apiData?.data && Array.isArray(apiData.data)) {
      allData = allData.concat(apiData.data)
    }

    nextToken = apiData?.nextToken || null
  } while (nextToken)

  return allData
}

/**
 * 전체 상태 발주서 조회 — 병렬 실행 (FETCH_CONCURRENCY 만큼 동시)
 * - ACCEPT/INSTRUCT/DEPARTURE/DELIVERING: 60일 (2분할)
 * - FINAL_DELIVERY/NONE_TRACKING: 30일 (1회)
 */
export async function fetchAllOrdersheets(
  onProgress?: (msg: string) => void,
): Promise<any[]> {
  // ── 태스크 빌드: (status, from, to, label) ─────────────────
  type Task = { status: string; fromDate: string; toDate: string; label: string }

  // 60일(2분할): 장기 체류 가능 상태 / 30일(1회): 배송 이후 상태 + 배송중(단기 체류)
  // NOTE: 'NONE_TRACKING'(업체직송)은 쿠팡 API 응답이 매우 느려 임시 비활성화.
  //        재활성화 시 shortStatuses 에 'NONE_TRACKING' 다시 추가.
  const longStatuses = ['ACCEPT', 'INSTRUCT', 'DEPARTURE']
  const shortStatuses = ['DELIVERING', 'FINAL_DELIVERY']

  const tasks: Task[] = [
    // 60일 상태 — 2분할 (API 31일 제한 대응)
    ...longStatuses.flatMap((status) => [
      { status, fromDate: daysAgo(60), toDate: daysAgo(30), label: `${STATUS_MAP[status]} (1/2)` },
      { status, fromDate: daysAgo(30), toDate: today(),    label: `${STATUS_MAP[status]} (2/2)` },
    ]),
    // 30일 상태 — 1회
    ...shortStatuses.map((status) => ({
      status, fromDate: daysAgo(30), toDate: today(), label: STATUS_MAP[status],
    })),
  ]

  // ── 진행률 카운터 (동시 실행 환경에서 단조 증가) ───────────
  let completed = 0
  const total = tasks.length

  const fns = tasks.map((t) => async (): Promise<any[]> => {
    const rows = await fetchOrdersheetsByStatus(t.status, t.fromDate, t.toDate)
    completed++
    onProgress?.(`발주서 조회 중... ${completed}/${total} (${t.label})`)
    return rows
  })

  // ── 동시 실행 (rate limit 보호: FETCH_CONCURRENCY) ─────────
  const batched = await runWithConcurrency(fns, FETCH_CONCURRENCY)
  return batched.flat()
}

// ══════════════════════════════════════════════════════════════════
// 반품/취소 요청 조회 (출고중지요청 RU + 반품접수 UC)
//   - API: /v2/providers/openapi/apis/api/v6/vendors/{vendorId}/returnRequests
//   - 최대 31일 / 페이지당 50건 / nextToken 페이징
//   - 60일 2분할 × 2 상태 = 4 태스크, 동시성 FETCH_CONCURRENCY 준수
// ══════════════════════════════════════════════════════════════════

const RETURN_STATUSES = ['RU', 'UC'] as const // RU=출고중지요청, UC=반품접수

/** 단일 페이지 호출 (재시도 포함) — 빈 응답/500 에러 대응 */
async function fetchReturnRequestsPage(
  params: URLSearchParams,
  headers: Record<string, string>,
): Promise<any> {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`/api/coupang/return-requests?${params.toString()}`, { headers })
      const text = await res.text()
      if (!text) {
        throw new Error(`프록시 응답 비어있음 (status=${res.status})`)
      }
      const json = JSON.parse(text)
      if (!json.success) {
        throw new Error(json.error || `반품요청 조회 실패 (status=${res.status})`)
      }
      assertCoupangListResponse(json.data, '반품요청')
      return json.data
    } catch (err: any) {
      lastErr = err
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
        console.warn(
          `[return-requests 재시도] ${attempt + 1}/${MAX_RETRIES} — ${err.message} (${delay}ms 대기)`,
        )
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }
  throw lastErr ?? new Error('반품요청 조회 실패 (알 수 없는 오류)')
}

/** 특정 상태 + 기간에 대한 반품/취소 요청 조회 (nextToken 페이징) */
async function fetchReturnRequestsByStatus(
  status: string,
  fromDate: string,
  toDate: string,
): Promise<any[]> {
  const headers = getCoupangHeaders()
  let allData: any[] = []
  let nextToken: string | null = null

  do {
    const params = new URLSearchParams({
      createdAtFrom: toCoupangDate(fromDate),
      createdAtTo: toCoupangDate(toDate),
      status,
      maxPerPage: String(ORDERSHEET_MAX_PER_PAGE),
    })
    if (nextToken) params.set('nextToken', nextToken)

    const apiData = await fetchReturnRequestsPage(params, headers)

    if (apiData?.data && Array.isArray(apiData.data)) {
      allData = allData.concat(apiData.data)
    }

    nextToken = apiData?.nextToken || null
  } while (nextToken)

  return allData
}

/**
 * 전체 반품/취소 요청 조회 — 출고중지 대상 shipment_box_id Set 반환
 * - 60일 기간을 2분할 (31일 제한 대응)
 * - RU(출고중지요청) + UC(반품접수) 양쪽 조회
 */
export async function fetchAllReturnRequests(
  onProgress?: (msg: string) => void,
): Promise<Set<string>> {
  type Task = { status: string; fromDate: string; toDate: string; label: string }

  const STATUS_LABEL: Record<string, string> = {
    RU: '출고중지요청',
    UC: '반품접수',
  }

  // 60일 2분할 × 2 상태 = 4 태스크
  const tasks: Task[] = RETURN_STATUSES.flatMap((status) => [
    { status, fromDate: daysAgo(60), toDate: daysAgo(30), label: `${STATUS_LABEL[status]} (1/2)` },
    { status, fromDate: daysAgo(30), toDate: today(),    label: `${STATUS_LABEL[status]} (2/2)` },
  ])

  let completed = 0
  const total = tasks.length

  const fns = tasks.map((t) => async (): Promise<any[]> => {
    const rows = await fetchReturnRequestsByStatus(t.status, t.fromDate, t.toDate)
    completed++
    onProgress?.(`반품요청 조회 중... ${completed}/${total} (${t.label})`)
    return rows
  })

  const batched = await runWithConcurrency(fns, FETCH_CONCURRENCY)
  const merged = batched.flat()

  // ── shipment_box_id 추출 (returnItems 배열 순회) ───────────
  const stopSet = new Set<string>()
  for (const item of merged) {
    const returnItems: any[] = item?.returnItems ?? []
    for (const ri of returnItems) {
      const sbid = ri?.shipmentBoxId
      if (sbid !== undefined && sbid !== null) {
        stopSet.add(String(sbid))
      }
    }
  }
  return stopSet
}

// ══════════════════════════════════════════════════════════════════
// API 응답 → DB 행 변환
// ══════════════════════════════════════════════════════════════════

/**
 * API 응답 data[] → PersonalOrderRow[] (orderItems 플랫화)
 * @param releaseStopSet - 출고중지/반품접수 shipment_box_id 집합 (선택). true면 release_stop = true 로 설정.
 */
export function mapOrderToRows(
  apiData: any[],
  vendorId: string,
  userId: string,
  releaseStopSet?: Set<string>,
): PersonalOrderRow[] {
  const rows: PersonalOrderRow[] = []

  for (const order of apiData) {
    const orderItems = order.orderItems || []
    const shipmentBoxId = String(order.shipmentBoxId ?? '')
    const releaseStop = releaseStopSet?.has(shipmentBoxId) ?? false
    for (const item of orderItems) {
      rows.push({
        user_id: userId,
        vendor_id: vendorId,
        shipment_box_id: shipmentBoxId,
        order_id: String(order.orderId ?? ''),
        status: order.status ?? '',
        seller_product_id: String(item.sellerProductId ?? ''),
        product_id: String(item.productId ?? ''),
        vendor_item_id: String(item.vendorItemId ?? ''),
        item_name: item.sellerProductName ?? '',
        option_name: item.sellerProductItemName ?? '',
        product_name: item.vendorItemName ?? '',
        shipping_count: item.shippingCount ?? 0,
        sales_price_units: item.salesPrice?.units ?? 0,
        order_price_units: item.orderPrice?.units ?? 0,
        delivery_company_name: order.deliveryCompanyName ?? '',
        invoice_number: order.invoiceNumber ?? '',
        estimated_shipping_date: item.estimatedShippingDate || null,
        planned_shipping_date: item.plannedShippingDate || null,
        in_transit_date_time: order.inTrasitDateTime || null,
        orderer_name: order.orderer?.name ?? '',
        receiver_name: order.receiver?.name ?? '',
        receiver_safe_number: order.receiver?.safeNumber ?? '',
        receiver_post_code: order.receiver?.postCode ?? '',
        receiver_address: [order.receiver?.addr1, order.receiver?.addr2].filter(Boolean).join(' '),
        ordered_at: order.orderedAt || null,
        paid_at: order.paidAt || null,
        delivered_date: order.deliveredDate || null,
        parcel_print_message: order.parcelPrintMessage ?? '',
        // 분리배송 표기(쿠팡 DeliveryList 'F열')는 두 API 필드로 결정:
        //   splitShipping=true          → 'Y'          (실제 분리배송 처리)
        //   ableSplitShipping=false     → '분리배송불가'  (분리배송 불가 = 대개 단일상품)
        //   그 외                        → 'N'          (가능하나 미처리)
        // ※ 상품 개수 등으로 임의 계산하지 않고 API 값을 그대로 사용.
        split_shipping: order.splitShipping
          ? 'Y'
          : (order.ableSplitShipping === false ? '분리배송불가' : 'N'),
        shipment_type: order.shipmentType ?? '',
        refer: order.refer ?? '',
        canceled: item.canceled ?? false,
        cancel_count: item.cancelCount ?? 0,
        external_vendor_sku_code: item.externalVendorSkuCode ?? '',
        barcode: '',   // 기본값 — 저장 단계에서 기존 행의 바코드로 대체됨
        note: '',
        release_stop: releaseStop,
      })
    }
  }

  return rows
}

// ══════════════════════════════════════════════════════════════════
// 주문확인 (결제완료 → 상품준비중)
// ══════════════════════════════════════════════════════════════════

const ACKNOWLEDGE_BATCH_SIZE = 50 // 쿠팡 API 최대 50개 제한

/** 결제완료 → 상품준비중 상태 변경 (50개씩 배치) */
export async function acknowledgeOrders(
  shipmentBoxIds: string[],
): Promise<{ success: number; failed: number; errors: string[] }> {
  const headers = getCoupangHeaders()
  let totalSuccess = 0
  let totalFailed = 0
  const errors: string[] = []

  // ── 50개씩 분할 호출 ──────────────────────────────────────────
  for (let i = 0; i < shipmentBoxIds.length; i += ACKNOWLEDGE_BATCH_SIZE) {
    const batch = shipmentBoxIds.slice(i, i + ACKNOWLEDGE_BATCH_SIZE)

    // shipmentBoxIds를 Number로 변환 (쿠팡 API는 Number 타입 요구)
    const numericIds = batch.map((id) => Number(id))

    const res = await fetch('/api/coupang/ordersheets-acknowledge', {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ shipmentBoxIds: numericIds }),
    })

    const json = await res.json()

    if (!json.success) {
      errors.push(json.error || '주문확인 API 호출 실패')
      totalFailed += batch.length
      continue
    }

    // ── 응답 파싱 (responseList) ─────────────────────────────────
    const responseData = json.data?.data
    if (responseData?.responseList) {
      for (const item of responseData.responseList) {
        if (item.succeed) {
          totalSuccess++
        } else {
          totalFailed++
          errors.push(`${item.shipmentBoxId}: ${item.resultMessage}`)
        }
      }
    } else {
      // responseList가 없으면 전체 성공으로 간주
      totalSuccess += batch.length
    }
  }

  return { success: totalSuccess, failed: totalFailed, errors }
}

/** Supabase에서 선택된 주문의 status를 INSTRUCT로 변경 */
export async function updateOrderStatusToInstruct(
  shipmentBoxIds: string[],
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('coupang_personal_orders')
    .update({ status: 'INSTRUCT' })
    .eq('user_id', userId)
    .in('shipment_box_id', shipmentBoxIds)

  if (error) {
    console.error('[personalOrderService] 상태 업데이트 실패:', error.message)
  }
}

// ══════════════════════════════════════════════════════════════════
// Supabase CRUD
// ══════════════════════════════════════════════════════════════════

export interface SavePersonalOrdersResult {
  success: boolean
  /** upsert 한 행 수 */
  count: number
  /** prune 으로 삭제한 행 수 */
  pruned: number
  /** prune 삭제 배치 실패 건수 (행 수 기준) */
  pruneErrors: number
  /** 안전장치에 걸려 중단됨 — 호출 측이 확인 후 forcePrune 으로 재호출 */
  needsPruneConfirm?: { toDelete: number; existing: number }
  error?: string
}

/**
 * 개인주문 동기화 — 이월(carry-forward) + Upsert + Prune (reconcile)
 *
 * 순서
 *   0. 기존 행 조회 (id, 키, barcode) — 이월과 prune 판정에 함께 사용
 *   1. prune 안전장치 — 삭제 대상이 과다하면 저장 전에 중단하고 확인 요청
 *   2. Upsert (onConflict = 유니크 제약 user_id, shipment_box_id, vendor_item_id)
 *      · payload 의 barcode 는 기존 행 값으로 대체 → [업데이트] 가 바코드를 지우지 않는다
 *      · id·pending_invoice_number 는 payload 에 없으므로 유지된다
 *   3. Prune — 이번에 안 온 기존 행만 삭제 (누적 없음)
 *
 * ⚠️ payload 에 id 를 넣지 않는 것이 핵심(넣으면 batch upsert 에서 null-id 위험).
 * ⚠️ 안전장치에 걸려 중단되면 DB 는 아무것도 바뀌지 않는다 (upsert 전 판정).
 */
export async function savePersonalOrders(
  rows: PersonalOrderRow[],
  userId: string,
  opts: { forcePrune?: boolean } = {},
): Promise<SavePersonalOrdersResult> {
  // DB 의 vendor_item_id 는 nullable — null 을 '' 로 맞춰 API 행(String 변환)과 같은 키가 되게 한다
  const keyOf = (r: { shipment_box_id: string; vendor_item_id: string | null }) =>
    `${r.shipment_box_id}|${r.vendor_item_id ?? ''}`
  const fail = (error: string): SavePersonalOrdersResult =>
    ({ success: false, count: 0, pruned: 0, pruneErrors: 0, error })

  try {
    // ── 0. 기존 행 조회 (1000건 루프) ────────────────────────────
    const existingByKey = new Map<string, { id: string; barcode: string }>()
    {
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from('coupang_personal_orders')
          .select('id, shipment_box_id, vendor_item_id, barcode')
          .eq('user_id', userId)
          .range(from, from + SUPABASE_PAGE_SIZE - 1)
        if (error) throw error
        if (!data || data.length === 0) break
        for (const r of data as any[]) {
          existingByKey.set(keyOf(r), { id: r.id, barcode: r.barcode ?? '' })
        }
        if (data.length < SUPABASE_PAGE_SIZE) break
        from += SUPABASE_PAGE_SIZE
      }
    }

    // ── 1. prune 대상 산출 + 안전장치 ───────────────────────────
    const newKeys = new Set<string>()
    for (const r of rows) newKeys.add(keyOf(r))

    const idsToDelete: string[] = []
    for (const [key, ex] of existingByKey) {
      if (!newKeys.has(key)) idsToDelete.push(ex.id)
    }

    const guard = Math.max(PRUNE_GUARD_MIN, Math.floor(existingByKey.size * PRUNE_GUARD_RATIO))
    if (!opts.forcePrune && idsToDelete.length > guard) {
      return {
        ...fail('삭제 대상 과다 — 사용자 확인 필요'),
        needsPruneConfirm: { toDelete: idsToDelete.length, existing: existingByKey.size },
      }
    }

    // ── 2. Upsert — barcode 이월 (기존 값 || '') ─────────────────
    const now = new Date().toISOString()
    const payload: PersonalOrderRow[] = rows.map((r) => ({
      ...r,
      barcode: existingByKey.get(keyOf(r))?.barcode || '',
      updated_at: now,
    }))

    let count = 0
    for (let i = 0; i < payload.length; i += SUPABASE_BATCH_SIZE) {
      const batch = payload.slice(i, i + SUPABASE_BATCH_SIZE)
      const { error } = await supabase
        .from('coupang_personal_orders')
        .upsert(batch, { onConflict: 'user_id,shipment_box_id,vendor_item_id' })
      if (error) throw error
      count += batch.length
    }

    // ── 3. Prune (id 기준 삭제, 배치 실패는 건수로 보고) ─────────
    let pruned = 0
    let pruneErrors = 0
    for (let i = 0; i < idsToDelete.length; i += SUPABASE_IN_DELETE_SIZE) {
      const batch = idsToDelete.slice(i, i + SUPABASE_IN_DELETE_SIZE)
      const { error } = await supabase
        .from('coupang_personal_orders')
        .delete()
        .eq('user_id', userId)
        .in('id', batch)
      if (error) {
        console.error('[personalOrderService] prune 삭제 오류:', error.message)
        pruneErrors += batch.length
      } else {
        pruned += batch.length
      }
    }

    return { success: true, count, pruned, pruneErrors }
  } catch (err: any) {
    console.error('[personalOrderService] 저장 실패:', err.message)
    return fail(err.message)
  }
}

/** Supabase에서 전체 개인주문 데이터 조회 (user_id 기준, 페이지네이션) */
export async function fetchPersonalOrders(
  userId: string,
): Promise<PersonalOrderRow[]> {
  const allData: PersonalOrderRow[] = []
  const batchSize = 1000
  let from = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from('coupang_personal_orders')
      .select('*')
      .eq('user_id', userId)
      .order('ordered_at', { ascending: false })
      .range(from, from + batchSize - 1)

    if (error) {
      console.error('[personalOrderService] 조회 실패:', error.message)
      return allData
    }

    if (data && data.length > 0) {
      allData.push(...(data as PersonalOrderRow[]))
      from += batchSize
      if (data.length < batchSize) hasMore = false
    } else {
      hasMore = false
    }
  }

  return allData
}

// ══════════════════════════════════════════════════════════════════
// 사입관리 '개인' 열 — 바코드별 개인주문 출고 예정 수량
//   결제완료(ACCEPT)·상품준비중(INSTRUCT) 행의 shipping_count 를 바코드로 합산.
//   취소된 행(canceled)·출고중지 요청(release_stop) 행은 나갈 물량이 아니므로 제외.
//   바코드가 비어 있는 행(바코드 미연결)은 합산 대상이 아니다.
// ══════════════════════════════════════════════════════════════════

const PERSONAL_PENDING_STATUSES = ['ACCEPT', 'INSTRUCT'] as const

/** 바코드 → Σ shipping_count (결제완료·상품준비중, 취소·출고중지 제외) */
export async function fetchPersonalOrderQtyByBarcode(
  userId: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (!userId) return map

  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('coupang_personal_orders')
      .select('barcode, shipping_count, canceled, release_stop')
      .eq('user_id', userId)
      .in('status', [...PERSONAL_PENDING_STATUSES])
      .neq('barcode', '')
      .not('barcode', 'is', null)
      .range(from, from + SUPABASE_PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break

    for (const r of data as {
      barcode: string
      shipping_count: number | null
      canceled: boolean | null
      release_stop: boolean | null
    }[]) {
      if (r.canceled || r.release_stop) continue
      const qty = r.shipping_count ?? 0
      if (qty <= 0) continue
      map.set(r.barcode, (map.get(r.barcode) ?? 0) + qty)
    }

    if (data.length < SUPABASE_PAGE_SIZE) break
    from += SUPABASE_PAGE_SIZE
  }
  return map
}

// ══════════════════════════════════════════════════════════════════
// pending_invoice_number (이용자 등록 운송장번호) — coupang_personal_orders 컬럼
// - 송장 xlsx 업로드 시 order_id 기준으로 UPDATE
// - [업데이트] 삭제+재삽입 시 값이 사라지지 않도록 보존용 조회/재적용 제공
// ══════════════════════════════════════════════════════════════════

/** order_id → pending_invoice_number 일괄 UPDATE (동시성 제한) */
export async function updatePendingInvoiceNumbers(
  userId: string,
  map: Map<string, string>,
): Promise<{ success: number; errors: number }> {
  let success = 0
  let errors = 0
  const entries = Array.from(map.entries())
  const CONCURRENCY = 10

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const chunk = entries.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      chunk.map(async ([orderId, invoiceNumber]) => {
        const { error } = await supabase
          .from('coupang_personal_orders')
          .update({ pending_invoice_number: invoiceNumber })
          .eq('user_id', userId)
          .eq('order_id', orderId)
        if (error) console.error('[pending 송장] update 오류:', orderId, error.message)
        return !error
      }),
    )
    for (const ok of results) ok ? success++ : errors++
  }

  return { success, errors }
}

// ══════════════════════════════════════════════════════════════════
// 송장 xlsx 운송장 번호 (si_personal_order_tracking)
// - 별도 테이블에 저장하여 [업데이트] 시 초기화 방지
// - order_id 기준 upsert → 중복 시 덮어쓰기
// ══════════════════════════════════════════════════════════════════

/** 운송장 번호 upsert (order_id 기준, 배치 500건) */
export async function upsertTrackingNumbers(
  rows: { user_id: string; order_id: string; invoice_number: string }[],
): Promise<{ success: number; errors: number }> {
  let success = 0
  let errors = 0

  for (let i = 0; i < rows.length; i += SUPABASE_BATCH_SIZE) {
    const batch = rows.slice(i, i + SUPABASE_BATCH_SIZE)
    const { error } = await supabase
      .from('si_personal_order_tracking')
      .upsert(batch, { onConflict: 'user_id,order_id' })

    if (error) {
      console.error('[송장 tracking] upsert 오류:', error)
      errors += batch.length
    } else {
      success += batch.length
    }
  }

  return { success, errors }
}

/** 운송장 번호 전체 조회 (order_id → invoice_number Map) — 페이지네이션 루프 */
export async function fetchTrackingNumbers(
  userId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const batchSize = 1000
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('si_personal_order_tracking')
      .select('order_id, invoice_number')
      .eq('user_id', userId)
      .range(from, from + batchSize - 1)

    if (error) {
      console.error('[송장 tracking] 조회 오류:', error)
      break
    }
    if (!data || data.length === 0) break

    for (const row of data) {
      if (row.order_id && row.invoice_number) {
        map.set(row.order_id, row.invoice_number)
      }
    }

    if (data.length < batchSize) break
    from += batchSize
  }

  return map
}

/** 업데이트 후 정리: coupang_personal_orders에 없는 order_id 삭제 */
export async function cleanupStaleTracking(
  userId: string,
  validOrderIds: Set<string>,
): Promise<{ deleted: number }> {
  // STEP 1: 현재 tracking 전체 order_id 조회
  const allTrackingOrderIds: string[] = []
  const batchSize = 1000
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('si_personal_order_tracking')
      .select('order_id')
      .eq('user_id', userId)
      .range(from, from + batchSize - 1)

    if (error) {
      console.error('[송장 tracking] 정리 조회 오류:', error)
      break
    }
    if (!data || data.length === 0) break

    for (const row of data) {
      if (row.order_id) allTrackingOrderIds.push(row.order_id)
    }

    if (data.length < batchSize) break
    from += batchSize
  }

  // STEP 2: validOrderIds에 없는 stale order_id 수집
  const staleIds = allTrackingOrderIds.filter((id) => !validOrderIds.has(id))
  if (staleIds.length === 0) return { deleted: 0 }

  // STEP 3: 배치 삭제 (Supabase .in() 최대 약 300건 권장)
  let deleted = 0
  const deleteBatch = 300

  for (let i = 0; i < staleIds.length; i += deleteBatch) {
    const batch = staleIds.slice(i, i + deleteBatch)
    const { error } = await supabase
      .from('si_personal_order_tracking')
      .delete()
      .eq('user_id', userId)
      .in('order_id', batch)

    if (error) {
      console.error('[송장 tracking] 정리 삭제 오류:', error)
    } else {
      deleted += batch.length
    }
  }

  return { deleted }
}

// ══════════════════════════════════════════════════════════════════
// 고객주문 비고(note) — coupang_personal_orders_details
//   - 컬럼명은 coupang_personal_orders 와 동일하게 order_id / vendor_item_id 사용
//   - 매칭 키: (order_id, vendor_item_id)
//   - 불러오기 때 주문 데이터는 초기화되지만, note 는 이 테이블에서 별도
//     fetch → Map join 으로 보존된다.
//   - 권장 스키마: UNIQUE(user_id, order_id, vendor_item_id) (upsert onConflict 용)
//   - 테이블 미생성 시에도 페이지 로드가 깨지지 않도록 fetch 는 방어적 처리.
// ══════════════════════════════════════════════════════════════════

/** 사용자 비고 전체 조회 → Map<`${order_id}|${vendor_item_id}`, note> (1000건 루프) */
export async function fetchOrderNotes(userId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (!userId) return map

  try {
    let from = 0
    const SIZE = 1000
    while (true) {
      const { data, error } = await supabase
        .from('coupang_personal_orders_details')
        .select('order_id, vendor_item_id, note')
        .eq('user_id', userId)
        .range(from, from + SIZE - 1)
      if (error) {
        // 테이블 미생성 등 → 경고만 남기고 빈 Map 반환 (로드 비차단)
        console.warn('[fetchOrderNotes] 조회 실패(테이블 미생성?):', error.message)
        break
      }
      const rows = (data ?? []) as { order_id: string | null; vendor_item_id: string | null; note: string | null }[]
      for (const r of rows) {
        if (!r.order_id || !r.note) continue
        map.set(`${r.order_id}|${r.vendor_item_id ?? ''}`, r.note)
      }
      if (rows.length < SIZE) break
      from += SIZE
    }
  } catch (e) {
    console.warn('[fetchOrderNotes] 예외(테이블 미생성?):', e)
  }
  return map
}

/**
 * 업데이트 후 정리: 주문(coupang_personal_orders)이 더 이상 없는 order_id 의 비고 삭제
 * - 비고는 별도 표라 주문이 prune 돼도 남아 영구 누적된다 → 업데이트마다 정리
 * - 테이블 미생성 등 조회 실패 시 0건 처리 (업데이트 흐름 비차단)
 */
export async function cleanupStaleNotes(
  userId: string,
  validOrderIds: Set<string>,
): Promise<{ deleted: number; errors: number }> {
  if (!userId) return { deleted: 0, errors: 0 }

  // STEP 1: 비고 order_id 전체 조회 (1000건 루프, 중복 제거)
  const staleSet = new Set<string>()
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('coupang_personal_orders_details')
      .select('order_id')
      .eq('user_id', userId)
      .range(from, from + SUPABASE_PAGE_SIZE - 1)
    if (error) {
      console.warn('[cleanupStaleNotes] 조회 실패(테이블 미생성?):', error.message)
      return { deleted: 0, errors: 0 }
    }
    if (!data || data.length === 0) break
    for (const r of data as { order_id: string | null }[]) {
      if (r.order_id && !validOrderIds.has(r.order_id)) staleSet.add(r.order_id)
    }
    if (data.length < SUPABASE_PAGE_SIZE) break
    from += SUPABASE_PAGE_SIZE
  }
  if (staleSet.size === 0) return { deleted: 0, errors: 0 }

  // STEP 2: order_id 청크 삭제 (한 order_id 에 여러 옵션 행이 있을 수 있어 건수는 행 기준 아님)
  const staleIds = Array.from(staleSet)
  let deleted = 0
  let errors = 0
  for (let i = 0; i < staleIds.length; i += SUPABASE_IN_DELETE_SIZE) {
    const batch = staleIds.slice(i, i + SUPABASE_IN_DELETE_SIZE)
    const { error } = await supabase
      .from('coupang_personal_orders_details')
      .delete()
      .eq('user_id', userId)
      .in('order_id', batch)
    if (error) {
      console.error('[cleanupStaleNotes] 삭제 오류:', error.message)
      errors += batch.length
    } else {
      deleted += batch.length
    }
  }
  return { deleted, errors }
}

/** 비고 저장 (upsert) — note 빈 값이면 null 로 저장 */
export async function saveOrderNote(
  userId: string,
  orderId: string,
  vendorItemId: string,
  note: string,
): Promise<void> {
  const trimmed = note.trim()
  const { error } = await supabase
    .from('coupang_personal_orders_details')
    .upsert(
      {
        user_id: userId,
        order_id: orderId,
        vendor_item_id: vendorItemId,
        note: trimmed === '' ? null : trimmed,
      },
      { onConflict: 'user_id,order_id,vendor_item_id' },
    )
  if (error) {
    console.error('[saveOrderNote] 저장 실패:', error)
    throw error
  }
}
