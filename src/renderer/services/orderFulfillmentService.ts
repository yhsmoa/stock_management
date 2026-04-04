/* ================================================================
   주문 프로젝트 Fulfillment 서비스
   - orderSupabase (purchase_agent DB) 를 통해 fulfillment 데이터 조회
   - 테이블: ft_order_items, ft_fulfillment_inbounds/outbounds,
             ft_cancel_details
   ================================================================ */

import { orderSupabase } from './orderSupabase'

// ── 상수 ──────────────────────────────────────────────────────────
const BATCH_SIZE = 100 // .in() URL 길이 제한 대응

// ══════════════════════════════════════════════════════════════════
// 타입 정의
// ══════════════════════════════════════════════════════════════════

/** fulfillment 집계 (테이블 컬럼용) */
export interface FulfillmentAgg {
  arrival: number
  packed: number
  cancel: number
  shipped: number
}

export const EMPTY_AGG: FulfillmentAgg = { arrival: 0, packed: 0, cancel: 0, shipped: 0 }

/** ft_order_items 상세 (드로어 열기용) */
export interface OrderItemDetail {
  id: string
  personal_order_no: string
  item_name: string | null
  option_name: string | null
  product_no: string | null
  item_no: string | null
  order_no: string | null
  '1688_order_id': string | null
}

/** FulfillmentDrawer 이력 행 */
export interface FulfillmentRow {
  id: string
  created_at: string
  type: string | null
  quantity: number | null
  note: string | null
  shipment_no: string | null
  cancel_reason?: string | null
}

// ══════════════════════════════════════════════════════════════════
// 유틸: 배치 조회 (.in() URL 길이 제한 대응, 100개 단위)
// ══════════════════════════════════════════════════════════════════

async function batchIn<T>(
  table: string,
  select: string,
  column: string,
  ids: string[],
): Promise<T[]> {
  const all: T[] = []
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE)
    const { data, error } = await (orderSupabase.from(table) as any)
      .select(select)
      .in(column, batch)
    if (error) throw error
    if (data) all.push(...(data as T[]))
  }
  return all
}

// ══════════════════════════════════════════════════════════════════
// 메인: Fulfillment 집계 데이터 조회
// ══════════════════════════════════════════════════════════════════

/**
 * 주문번호(order_id) 목록으로 fulfillment 집계 + orderItem 매핑 조회
 *
 * @param orderIds     - coupang_personal_orders.order_id 배열
 * @param orderUserId  - purchase_agent ft_users.id (si_users.order_user_id)
 * @returns aggMap (order_id → FulfillmentAgg), orderItemMap (order_id → OrderItemDetail)
 */
export async function fetchFulfillmentData(
  orderIds: string[],
  orderUserId: string,
): Promise<{
  aggMap: Map<string, FulfillmentAgg>
  orderItemMap: Map<string, OrderItemDetail>
}> {
  const aggMap = new Map<string, FulfillmentAgg>()
  const orderItemMap = new Map<string, OrderItemDetail>()

  if (orderIds.length === 0 || !orderUserId) {
    return { aggMap, orderItemMap }
  }

  // ── 1) ft_order_items 조회 (personal_order_no = our order_id) ──
  const orderItems = await batchIn<OrderItemDetail>(
    'ft_order_items',
    'id, personal_order_no, item_name, option_name, product_no, item_no, order_no, 1688_order_id',
    'personal_order_no',
    orderIds,
  )

  // order_id → OrderItemDetail 매핑
  for (const oi of orderItems) {
    orderItemMap.set(oi.personal_order_no, oi)
  }

  // order_item_id → order_id 역방향 매핑
  const itemToOrderId = new Map<string, string>()
  for (const oi of orderItems) {
    itemToOrderId.set(oi.id, oi.personal_order_no)
  }

  const itemIds = orderItems.map((oi) => oi.id)
  if (itemIds.length === 0) return { aggMap, orderItemMap }

  // ── 2) inbound + outbound 병렬 조회 ────────────────────────────
  const [inbounds, outbounds] = await Promise.all([
    batchIn<{
      order_item_id: string
      type: string
      quantity: number | null
    }>('ft_fulfillment_inbounds', 'order_item_id, type, quantity', 'order_item_id', itemIds),
    batchIn<{
      order_item_id: string
      type: string
      quantity: number | null
      shipment_no: string | null
    }>(
      'ft_fulfillment_outbounds',
      'order_item_id, type, quantity, shipment_no',
      'order_item_id',
      itemIds,
    ),
  ])

  // ── 3) 집계: order_id → FulfillmentAgg ──────────────────────────
  const allFulfillments = [
    ...inbounds.map((f) => ({ ...f, shipment_no: null as string | null })),
    ...outbounds,
  ]

  for (const f of allFulfillments) {
    const orderId = itemToOrderId.get(f.order_item_id)
    if (!orderId) continue

    if (!aggMap.has(orderId)) aggMap.set(orderId, { ...EMPTY_AGG })
    const entry = aggMap.get(orderId)!
    const qty = f.quantity ?? 0

    if (f.type === 'ARRIVAL') entry.arrival += qty
    if (f.type === 'PACKED') entry.packed += qty
    if (f.type === 'CANCEL') entry.cancel += qty
    if (f.shipment_no) entry.shipped += qty
  }

  return { aggMap, orderItemMap }
}

// ══════════════════════════════════════════════════════════════════
// 드로어: Fulfillment 이력 조회
// ══════════════════════════════════════════════════════════════════

/**
 * 단일 order_item의 fulfillment 이력 조회 (드로어 표시용)
 *
 * @param itemId       - ft_order_items.id
 * @param orderUserId  - ft_users.id
 * @returns FulfillmentRow[] (created_at 오름차순)
 */
export async function fetchFulfillmentHistory(
  itemId: string,
  orderUserId: string,
): Promise<FulfillmentRow[]> {
  // ── inbound + outbound + cancel_details 병렬 조회 ──────────────
  const [inboundRes, outboundRes, cancelRes] = await Promise.all([
    (orderSupabase.from('ft_fulfillment_inbounds') as any)
      .select('id, created_at, type, quantity, note')
      .eq('order_item_id', itemId)
      .eq('user_id', orderUserId)
      .order('created_at', { ascending: true }),
    (orderSupabase.from('ft_fulfillment_outbounds') as any)
      .select('id, created_at, type, quantity, note, shipment_no')
      .eq('order_item_id', itemId)
      .eq('user_id', orderUserId)
      .order('created_at', { ascending: true }),
    (orderSupabase.from('ft_cancel_details') as any)
      .select('cancel_reason')
      .eq('order_items_id', itemId),
  ])

  // ── 취소사유 매핑 ──────────────────────────────────────────────
  const cancelReasons: string[] = (cancelRes.data ?? [])
    .map((c: { cancel_reason: string | null }) => c.cancel_reason)
    .filter((r: string | null): r is string => !!r)

  let cancelIdx = 0
  const inbounds: FulfillmentRow[] = (inboundRes.data ?? []).map((r: any) => ({
    ...r,
    shipment_no: null,
    cancel_reason: r.type === 'CANCEL' ? (cancelReasons[cancelIdx++] ?? null) : null,
  }))
  const outbounds: FulfillmentRow[] = outboundRes.data ?? []

  // ── created_at 기준 오름차순 병합 ────────────────────────────────
  return [...inbounds, ...outbounds].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
}
