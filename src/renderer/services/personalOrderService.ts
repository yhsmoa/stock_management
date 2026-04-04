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
  barcode: string
  note: string
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
// 쿠팡 발주서 API 호출
// ══════════════════════════════════════════════════════════════════

/** 특정 상태 + 기간에 대한 발주서 목록 조회 (nextToken 페이징) */
async function fetchOrdersheetsByStatus(
  status: string,
  fromDate: string,
  toDate: string,
  maxPerPage = 50,
): Promise<any[]> {
  const headers = getCoupangHeaders()
  let allData: any[] = []
  let nextToken: string | null = null

  do {
    const params = new URLSearchParams({
      createdAtFrom: toCoupangDate(fromDate),
      createdAtTo: toCoupangDate(toDate),
      status,
      maxPerPage: String(maxPerPage),
    })
    if (nextToken) params.set('nextToken', nextToken)

    const res = await fetch(`/api/coupang/ordersheets?${params.toString()}`, {
      headers,
    })
    const json = await res.json()

    if (!json.success) {
      throw new Error(json.error || '발주서 조회 실패')
    }

    const apiData = json.data
    if (apiData?.data && Array.isArray(apiData.data)) {
      allData = allData.concat(apiData.data)
    }

    nextToken = apiData?.nextToken || null
  } while (nextToken)

  return allData
}

/**
 * 전체 상태 발주서 조회
 * - ACCEPT/INSTRUCT/DEPARTURE/DELIVERING: 60일 (2분할)
 * - FINAL_DELIVERY/NONE_TRACKING: 30일 (1회)
 *
 * @param maxPerPage 페이지당 조회 건수 (테스트 시 5)
 */
export async function fetchAllOrdersheets(
  maxPerPage = 50,
  onProgress?: (msg: string) => void,
): Promise<any[]> {
  const allData: any[] = []

  // ── 60일 조회 대상 (2분할: 60일전~30일전, 30일전~오늘) ──────
  const longStatuses = ['ACCEPT', 'INSTRUCT', 'DEPARTURE', 'DELIVERING']
  for (const status of longStatuses) {
    onProgress?.(`${STATUS_MAP[status]} 조회 중... (1/2)`)
    const batch1 = await fetchOrdersheetsByStatus(status, daysAgo(60), daysAgo(30), maxPerPage)
    allData.push(...batch1)

    onProgress?.(`${STATUS_MAP[status]} 조회 중... (2/2)`)
    const batch2 = await fetchOrdersheetsByStatus(status, daysAgo(30), today(), maxPerPage)
    allData.push(...batch2)
  }

  // ── 30일 조회 대상 (1회) ────────────────────────────────────
  const shortStatuses = ['FINAL_DELIVERY', 'NONE_TRACKING']
  for (const status of shortStatuses) {
    onProgress?.(`${STATUS_MAP[status]} 조회 중...`)
    const batch = await fetchOrdersheetsByStatus(status, daysAgo(30), today(), maxPerPage)
    allData.push(...batch)
  }

  return allData
}

// ══════════════════════════════════════════════════════════════════
// API 응답 → DB 행 변환
// ══════════════════════════════════════════════════════════════════

/** API 응답 data[] → PersonalOrderRow[] (orderItems 플랫화) */
export function mapOrderToRows(apiData: any[], vendorId: string, userId: string): PersonalOrderRow[] {
  const rows: PersonalOrderRow[] = []

  for (const order of apiData) {
    const orderItems = order.orderItems || []
    for (const item of orderItems) {
      rows.push({
        user_id: userId,
        vendor_id: vendorId,
        shipment_box_id: String(order.shipmentBoxId ?? ''),
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
        split_shipping: order.splitShipping ? 'Y' : 'N',
        shipment_type: order.shipmentType ?? '',
        refer: order.refer ?? '',
        canceled: item.canceled ?? false,
        cancel_count: item.cancelCount ?? 0,
        external_vendor_sku_code: item.externalVendorSkuCode ?? '',
        barcode: '',
        note: '',
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

/** 기존 데이터 삭제 후 배치 INSERT */
export async function savePersonalOrders(
  rows: PersonalOrderRow[],
  userId: string,
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    // ── 기존 데이터 삭제 (user_id 기준) ──────────────────────────
    const { error: deleteError } = await supabase
      .from('coupang_personal_orders')
      .delete()
      .eq('user_id', userId)

    if (deleteError) throw deleteError

    // ── 배치 INSERT ─────────────────────────────────────────────
    let insertedCount = 0
    for (let i = 0; i < rows.length; i += SUPABASE_BATCH_SIZE) {
      const batch = rows.slice(i, i + SUPABASE_BATCH_SIZE)
      const { error: insertError } = await supabase
        .from('coupang_personal_orders')
        .insert(batch)

      if (insertError) throw insertError
      insertedCount += batch.length
    }

    return { success: true, count: insertedCount }
  } catch (err: any) {
    console.error('[personalOrderService] 저장 실패:', err.message)
    return { success: false, count: 0, error: err.message }
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
