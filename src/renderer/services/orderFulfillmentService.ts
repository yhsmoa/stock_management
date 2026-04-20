/* ================================================================
   주문 프로젝트 Fulfillment 서비스
   - orderSupabase (purchase_agent DB) 를 통해 fulfillment 데이터 조회
   - 테이블: ft_order_items, ft_fulfillment_inbounds/outbounds,
             ft_cancel_details
   ================================================================ */

import { orderSupabase, isOrderSupabaseConfigured } from './orderSupabase'

// ── 상수 ──────────────────────────────────────────────────────────
const BATCH_SIZE = 100   // .in() URL 길이 제한 대응
const PAGE_SIZE = 1000   // 페이지네이션 루프 단위 (Supabase 기본 limit 과 동일)

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
  vendor_option_id: string | null   // 쿠팡 option_id 매칭 키
  set_seq: number | null            // 세트 순번 (비세트도 1부터). 중복 시 multi 판정
  item_name: string | null
  option_name: string | null
  product_no: string | null
  item_no: string | null
  order_no: string | null
  '1688_order_id': string | null
  created_at: string                // 재주문 판별용
}

/** 복합 키: `${order_id}|${option_id ?? ''}` */
export function makeFulfillmentKey(orderId: string, optionId: string | null | undefined): string {
  return `${orderId}|${optionId ?? ''}`
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
 * 매칭 키: (personal_order_no, vendor_option_id) 복합 키
 * - 같은 쿠팡 주문번호 내 여러 option 주문을 구분
 * - 재주문(cancel 후 재발주)로 여러 ft_order_items 존재 시 개별 카운트
 *
 * @param orderIds     - coupang_personal_orders.order_id 배열
 * @param orderUserId  - purchase_agent ft_users.id (si_users.order_user_id)
 * @returns
 *   - aggMap        : 복합 키 → FulfillmentAgg (여러 ft_order_items 합산)
 *   - multiKeys     : set_seq 중복이 발견된 복합 키 집합 ('multi' 상태 판정용)
 *   - orderItemsMap : 복합 키 → OrderItemDetail[] (드로어에 전체 전달)
 */
export async function fetchFulfillmentData(
  orderIds: string[],
  orderUserId: string,
): Promise<{
  aggMap: Map<string, FulfillmentAgg>
  multiKeys: Set<string>
  orderItemsMap: Map<string, OrderItemDetail[]>
}> {
  const aggMap = new Map<string, FulfillmentAgg>()
  const multiKeys = new Set<string>()
  const orderItemsMap = new Map<string, OrderItemDetail[]>()

  if (orderIds.length === 0 || !orderUserId) {
    return { aggMap, multiKeys, orderItemsMap }
  }

  // ── 1) ft_order_items 조회 (personal_order_no = our order_id) ──
  const orderItems = await batchIn<OrderItemDetail>(
    'ft_order_items',
    'id, personal_order_no, vendor_option_id, set_seq, item_name, option_name, product_no, item_no, order_no, 1688_order_id, created_at',
    'personal_order_no',
    orderIds,
  )

  // 복합 키(order_id + option_id) 기반 매핑
  const itemToKey = new Map<string, string>() // ft_order_items.id → key
  for (const oi of orderItems) {
    const key = makeFulfillmentKey(oi.personal_order_no, oi.vendor_option_id)
    itemToKey.set(oi.id, key)

    // 동일 키에 복수 ft_order_items 누적
    const arr = orderItemsMap.get(key) ?? []
    arr.push(oi)
    orderItemsMap.set(key, arr)
  }

  // 각 키의 OrderItemDetail 배열을 created_at 오름차순 정렬
  for (const arr of orderItemsMap.values()) {
    arr.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
  }

  // ── multi 판정: 같은 key 그룹 내 set_seq 중복 여부 ──────────────
  // - 세트 상품(set_seq=1,2,...)은 정상 → 중복 없음
  // - 재주문으로 동일 set_seq 재등장 시 multi
  for (const [key, arr] of orderItemsMap) {
    const seqCount = new Map<number | null, number>()
    for (const oi of arr) {
      seqCount.set(oi.set_seq, (seqCount.get(oi.set_seq) ?? 0) + 1)
    }
    for (const c of seqCount.values()) {
      if (c >= 2) { multiKeys.add(key); break }
    }
  }

  const itemIds = orderItems.map((oi) => oi.id)
  if (itemIds.length === 0) return { aggMap, multiKeys, orderItemsMap }

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

  // ── 3) 집계: 복합 키 → FulfillmentAgg ──────────────────────────
  const allFulfillments = [
    ...inbounds.map((f) => ({ ...f, shipment_no: null as string | null })),
    ...outbounds,
  ]

  for (const f of allFulfillments) {
    const key = itemToKey.get(f.order_item_id)
    if (!key) continue

    if (!aggMap.has(key)) aggMap.set(key, { ...EMPTY_AGG })
    const entry = aggMap.get(key)!
    const qty = f.quantity ?? 0

    if (f.type === 'ARRIVAL') entry.arrival += qty
    if (f.type === 'PACKED') entry.packed += qty
    if (f.type === 'CANCEL') entry.cancel += qty
    if (f.shipment_no) entry.shipped += qty
  }

  return { aggMap, multiKeys, orderItemsMap }
}

// ══════════════════════════════════════════════════════════════════
// 드로어: Fulfillment 이력 조회
// ══════════════════════════════════════════════════════════════════

/**
 * 여러 order_item의 fulfillment 이력 조회 (드로어 표시용)
 * - itemIds 전체의 inbound/outbound/cancel 이벤트를 시간순으로 평탄화
 *
 * @param itemIds      - ft_order_items.id 배열 (재주문 등 여러 건 가능)
 * @param orderUserId  - ft_users.id
 * @returns FulfillmentRow[] (created_at 오름차순)
 */
export async function fetchFulfillmentHistory(
  itemIds: string[],
  orderUserId: string,
): Promise<FulfillmentRow[]> {
  if (itemIds.length === 0 || !orderUserId) return []

  // ── inbound + outbound + cancel_details 병렬 조회 (itemIds 전체) ─
  const [inbounds, outbounds, cancels] = await Promise.all([
    batchIn<{
      id: string
      created_at: string
      type: string | null
      quantity: number | null
      note: string | null
      order_item_id: string
    }>(
      'ft_fulfillment_inbounds',
      'id, created_at, type, quantity, note, order_item_id',
      'order_item_id',
      itemIds,
    ),
    batchIn<{
      id: string
      created_at: string
      type: string | null
      quantity: number | null
      note: string | null
      shipment_no: string | null
      order_item_id: string
    }>(
      'ft_fulfillment_outbounds',
      'id, created_at, type, quantity, note, shipment_no, order_item_id',
      'order_item_id',
      itemIds,
    ),
    batchIn<{
      order_items_id: string
      cancel_reason: string | null
    }>(
      'ft_cancel_details',
      'order_items_id, cancel_reason',
      'order_items_id',
      itemIds,
    ),
  ])

  // ── 취소사유: order_item_id 별 FIFO 큐 ────────────────────────
  const cancelReasonQueue = new Map<string, string[]>()
  for (const c of cancels) {
    if (!c.cancel_reason) continue
    const arr = cancelReasonQueue.get(c.order_items_id) ?? []
    arr.push(c.cancel_reason)
    cancelReasonQueue.set(c.order_items_id, arr)
  }

  const inboundRows: FulfillmentRow[] = inbounds.map((r) => {
    let reason: string | null = null
    if (r.type === 'CANCEL') {
      const q = cancelReasonQueue.get(r.order_item_id)
      reason = q?.shift() ?? null
    }
    return {
      id: r.id,
      created_at: r.created_at,
      type: r.type,
      quantity: r.quantity,
      note: r.note,
      shipment_no: null,
      cancel_reason: reason,
    }
  })

  const outboundRows: FulfillmentRow[] = outbounds.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    type: r.type,
    quantity: r.quantity,
    note: r.note,
    shipment_no: r.shipment_no,
  }))

  // ── created_at 기준 오름차순 병합 (여러 itemIds 평탄화) ─────────
  return [...inboundRows, ...outboundRows].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
}

// ══════════════════════════════════════════════════════════════════
// 주문 델타 (주문 - 취소 - 출고) 조회
//   - 사입관리 '주문' 열 표시용
//   - product_id 기준으로 rg_items 와 매칭
// ══════════════════════════════════════════════════════════════════

// ── 타입 정의 ──────────────────────────────────────────────────────

/** shipment_type 드롭박스 옵션 */
export type ShipmentType = 'COUPANG' | 'DIRECT' | 'PERSONAL'

/** ft_shipments 행 (주문 모달 옵션용) */
export interface ShipmentOption {
  id: string
  user_id: string
  date: string
  shipment_no: string | null
}

/** 주문 델타 (product_id 기준 합계) */
export interface OrderDelta {
  order: number      // 주문수량 합계
  cancel: number     // 취소수량 합계
  outbound: number   // 출고수량 합계
  net: number        // order - cancel - outbound
}

// ── 최근 출고일 N개 조회 ──────────────────────────────────────────

/**
 * ft_shipments 에서 현재 사용자의 최근 N개 출고일 조회 (date DESC)
 *
 * @param orderUserId - ft_users.id (= si_users.order_user_id) — 필수
 * @param limit       - 조회 건수 (기본 2)
 * @returns ShipmentOption[]
 */
export async function fetchRecentShipments(
  orderUserId: string,
  limit = 2,
): Promise<ShipmentOption[]> {
  if (!isOrderSupabaseConfigured || !orderUserId) return []

  const { data, error } = await (orderSupabase.from('ft_shipments') as any)
    .select('id, user_id, date, shipment_no')
    .eq('user_id', orderUserId)
    .order('date', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[fetchRecentShipments]', error)
    throw error
  }
  return (data ?? []) as ShipmentOption[]
}

// ══════════════════════════════════════════════════════════════════
// 주문 델타 일괄 조회
//   '현재 주문되어 들어올 수량' = 사입관리 '주문' 열
//
//   공식:
//     net = Σ ft_order_items.order_qty
//               WHERE status='PROCESSING'
//                 AND shipment_type ∈ (COUPANG|DIRECT)  (대소문자 무시)
//         - Σ ft_fulfillment_inbounds.quantity (type=CANCEL)
//         - Σ ft_fulfillment_outbounds.quantity
//               WHERE type='PACKED'
//                 AND shipment_id IS NOT NULL              ← base 차감 조건
//               EXCLUDING (AND 결합, 모달 선택값):
//                 shipment_id ∈ selectedShipmentIds
//               AND
//                 shipment_type ∈ selectedShipmentTypes (대소문자 무시)
//
//   1단계(base): PACKED + shipment_id NOT NULL 만 차감 대상에 포함
//                (NULL 인 PACKED 는 애초에 차감하지 않음)
//   2단계(exclude): 위 대상 중, 모달에서 선택된 (shipment_id, shipment_type)
//                   에 AND 로 일치하는 건은 "아직 물리적으로 떠나지 않은 건"
//                   으로 간주하여 차감에서 추가로 제외.
//   - shipment_id 혹은 shipment_type 한쪽이라도 선택이 비어있으면
//     2단계 제외 로직 비활성 → base 대상(PACKED+non-NULL) 전부 차감.
// ══════════════════════════════════════════════════════════════════

/** base 대상 shipment_type — PERSONAL 제외, 대소문자 무시 OR 매칭 */
const BASE_SHIPMENT_TYPES = ['COUPANG', 'DIRECT'] as const

/**
 * barcode 기준으로 '주문 - 취소 - (일부)출고' 합계 조회
 * - si_rg_items.barcode ↔ ft_order_items.barcode 매칭
 * - 모든 쿼리는 `orderUserId` 로 격리 (ft_users.id = si_users.order_user_id)
 *
 * @param barcodes                - rg_items 에서 추출한 barcode 배열
 * @param selectedShipmentIds     - 모달에서 체크한 ft_shipments.id — '차감 제외' AND 조건의 한 축
 * @param selectedShipmentTypes   - 모달에서 체크한 shipment_type — '차감 제외' AND 조건의 나머지 축
 * @param orderUserId             - ft_users.id — 필수
 * @returns Map<barcode, OrderDelta>
 */
export async function fetchOrderDelta(
  barcodes: string[],
  selectedShipmentIds: string[],
  selectedShipmentTypes: ShipmentType[],
  orderUserId: string,
): Promise<Map<string, OrderDelta>> {
  const result = new Map<string, OrderDelta>()
  if (!isOrderSupabaseConfigured || !orderUserId || barcodes.length === 0) return result

  // ════════════════════════════════════════════════════════════════
  // (A) ft_order_items — PROCESSING + (COUPANG|DIRECT) base 조회
  //     - user_id 격리
  //     - status = 'PROCESSING'
  //     - shipment_type ∈ (COUPANG|DIRECT)  대소문자 무시
  //     - barcode ∈ chunk  (si_rg_items.barcode ↔ ft_order_items.barcode)
  //     - select 에 shipment_type 포함 (outbound 차감 제외 매핑용)
  // ════════════════════════════════════════════════════════════════
  type OrderItemRow = {
    id: string
    barcode: string | null
    order_qty: number | null
    shipment_type: string | null
  }
  const orderItems: OrderItemRow[] = []
  // PostgREST `or` 문법: 두 ilike 절을 OR 로 묶음 (대소문자 무시 정확 매칭)
  const baseTypeOr = BASE_SHIPMENT_TYPES
    .map((t) => `shipment_type.ilike.${t}`)
    .join(',')

  for (let i = 0; i < barcodes.length; i += BATCH_SIZE) {
    const chunk = barcodes.slice(i, i + BATCH_SIZE)
    let from = 0
    while (true) {
      const { data, error } = await (orderSupabase.from('ft_order_items') as any)
        .select('id, barcode, order_qty, shipment_type')
        .eq('user_id', orderUserId)
        .eq('status', 'PROCESSING')
        .or(baseTypeOr)
        .in('barcode', chunk)
        .range(from, from + PAGE_SIZE - 1)
      if (error) {
        console.error('[fetchOrderDelta:ft_order_items]', error)
        throw error
      }
      if (data) orderItems.push(...(data as OrderItemRow[]))
      if (!data || data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }
  }

  // ── 집계 + 매핑 2종 ─────────────────────────────────────────────
  //   orderMap        : barcode → 주문수량 합
  //   itemToBarcode   : order_item_id → barcode (역매핑)
  //   itemToTypeLower : order_item_id → shipment_type (소문자 정규화)
  const orderMap = new Map<string, number>()
  const itemToBarcode = new Map<string, string>()
  const itemToTypeLower = new Map<string, string>()
  for (const oi of orderItems) {
    if (!oi.barcode) continue
    itemToBarcode.set(oi.id, oi.barcode)
    itemToTypeLower.set(oi.id, (oi.shipment_type ?? '').toLowerCase())
    orderMap.set(oi.barcode, (orderMap.get(oi.barcode) ?? 0) + (oi.order_qty ?? 0))
  }

  const itemIds = Array.from(itemToBarcode.keys())
  if (itemIds.length === 0) {
    // base 가 비었으면 취소/출고 조회할 필요 없음
    for (const pid of orderMap.keys()) {
      result.set(pid, { order: orderMap.get(pid) ?? 0, cancel: 0, outbound: 0, net: orderMap.get(pid) ?? 0 })
    }
    return result
  }

  // ════════════════════════════════════════════════════════════════
  // (B) ft_fulfillment_inbounds (CANCEL) + (C) ft_fulfillment_outbounds (PACKED)
  //     두 쿼리를 병렬 실행 (각각 BATCH_SIZE chunk)
  // ════════════════════════════════════════════════════════════════
  const [cancelRows, outboundRows] = await Promise.all([
    // ── (B) 취소 — 전부 차감 ─────────────────────────────────────
    (async () => {
      type InboundRow = { order_item_id: string; quantity: number | null }
      const rows: InboundRow[] = []
      for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
        const chunk = itemIds.slice(i, i + BATCH_SIZE)
        let from = 0
        while (true) {
          const { data, error } = await (orderSupabase.from('ft_fulfillment_inbounds') as any)
            .select('order_item_id, quantity')
            .eq('user_id', orderUserId)
            .eq('type', 'CANCEL')
            .in('order_item_id', chunk)
            .range(from, from + PAGE_SIZE - 1)
          if (error) {
            console.error('[fetchOrderDelta:ft_fulfillment_inbounds]', error)
            throw error
          }
          if (data) rows.push(...(data as InboundRow[]))
          if (!data || data.length < PAGE_SIZE) break
          from += PAGE_SIZE
        }
      }
      return rows
    })(),

    // ── (C) 출고 — base: PACKED + shipment_id NOT NULL ────────────
    //   * 조회 키: order_item_id (shipment_type 매핑 위해)
    //   * base 차감 대상만 조회 → shipment_id=NULL 인 PACKED 는 DB 단에서 제외
    //   * 이후 클라이언트에서 모달 AND 조건으로 "차감 제외"(2단계) 적용
    (async () => {
      type OutboundRow = {
        order_item_id: string
        quantity: number | null
        shipment_id: string  // NOT NULL 보장
      }
      const rows: OutboundRow[] = []
      for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
        const chunk = itemIds.slice(i, i + BATCH_SIZE)
        let from = 0
        while (true) {
          const { data, error } = await (orderSupabase.from('ft_fulfillment_outbounds') as any)
            .select('order_item_id, quantity, shipment_id')
            .eq('user_id', orderUserId)
            .eq('type', 'PACKED')
            .not('shipment_id', 'is', null)
            .in('order_item_id', chunk)
            .range(from, from + PAGE_SIZE - 1)
          if (error) {
            console.error('[fetchOrderDelta:ft_fulfillment_outbounds]', error)
            throw error
          }
          if (data) rows.push(...(data as OutboundRow[]))
          if (!data || data.length < PAGE_SIZE) break
          from += PAGE_SIZE
        }
      }
      return rows
    })(),
  ])

  // ════════════════════════════════════════════════════════════════
  // 취소 집계 — order_item_id → product_id 역매핑 후 합산 (전부 차감)
  // ════════════════════════════════════════════════════════════════
  const cancelMap = new Map<string, number>()
  for (const r of cancelRows) {
    const pid = itemToBarcode.get(r.order_item_id)
    if (!pid) continue
    cancelMap.set(pid, (cancelMap.get(pid) ?? 0) + (r.quantity ?? 0))
  }

  // ════════════════════════════════════════════════════════════════
  // 출고 집계 (2단계) — 모달 AND 제외 조건에 일치하는 건은 차감에서 추가 제외
  //   outboundRows 는 이미 base(PACKED + shipment_id NOT NULL) 필터 통과분
  //   excludeShipmentIds + excludeTypesLower 둘 다 비어있지 않을 때만 2단계 작동
  // ════════════════════════════════════════════════════════════════
  const excludeShipmentIds = new Set(selectedShipmentIds)
  const excludeTypesLower = new Set(selectedShipmentTypes.map((t) => t.toLowerCase()))
  const hasExcludeFilter = excludeShipmentIds.size > 0 && excludeTypesLower.size > 0

  const outboundMap = new Map<string, number>()
  for (const r of outboundRows) {
    const pid = itemToBarcode.get(r.order_item_id)
    if (!pid) continue

    if (hasExcludeFilter) {
      const itemTypeLower = itemToTypeLower.get(r.order_item_id) ?? ''
      const isExcluded =
        excludeShipmentIds.has(r.shipment_id) &&
        excludeTypesLower.has(itemTypeLower)
      if (isExcluded) continue // 차감에서 제외 (2단계)
    }

    outboundMap.set(pid, (outboundMap.get(pid) ?? 0) + (r.quantity ?? 0))
  }

  // ════════════════════════════════════════════════════════════════
  // 최종 합산 → Map<product_id, OrderDelta>
  // ════════════════════════════════════════════════════════════════
  const allPids = new Set<string>([
    ...orderMap.keys(),
    ...cancelMap.keys(),
    ...outboundMap.keys(),
  ])
  for (const pid of allPids) {
    const order = orderMap.get(pid) ?? 0
    const cancel = cancelMap.get(pid) ?? 0
    const outbound = outboundMap.get(pid) ?? 0
    result.set(pid, {
      order,
      cancel,
      outbound,
      net: order - cancel - outbound,
    })
  }

  return result
}
