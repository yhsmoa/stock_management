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
// - BATCH_SIZE = 100 유지 (URL 안전)
// - 여러 배치를 Promise.all 로 병렬 실행 → RTT 1회로 단축
// ══════════════════════════════════════════════════════════════════

async function batchIn<T>(
  table: string,
  select: string,
  column: string,
  ids: string[],
): Promise<T[]> {
  if (ids.length === 0) return []

  // 배치 분할
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    chunks.push(ids.slice(i, i + BATCH_SIZE))
  }

  // 병렬 실행 (순차 await for-loop → Promise.all)
  const results = await Promise.all(
    chunks.map(async (chunk): Promise<T[]> => {
      const { data, error } = await (orderSupabase.from(table) as any)
        .select(select)
        .in(column, chunk)
      if (error) throw error
      return (data ?? []) as T[]
    }),
  )

  return results.flat()
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
  reorderCountMap: Map<string, number>
}> {
  const aggMap = new Map<string, FulfillmentAgg>()
  const multiKeys = new Set<string>()
  const orderItemsMap = new Map<string, OrderItemDetail[]>()
  const reorderCountMap = new Map<string, number>()

  if (orderIds.length === 0 || !orderUserId) {
    return { aggMap, multiKeys, orderItemsMap, reorderCountMap }
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

  // ── multi 판정 + 재주문 차수 계산 ──────────────────────────────
  // - 세트 상품(set_seq=1,2,...)은 정상 → 중복 없음
  // - 재주문으로 동일 set_seq 재등장 시 multi
  // - set_seq=1 이 N번 나오면 N차 재주문 → reorderCountMap 에 기록
  for (const [key, arr] of orderItemsMap) {
    const seqCount = new Map<number | null, number>()
    for (const oi of arr) {
      seqCount.set(oi.set_seq, (seqCount.get(oi.set_seq) ?? 0) + 1)
    }
    for (const c of seqCount.values()) {
      if (c >= 2) { multiKeys.add(key); break }
    }
    const seq1Count = seqCount.get(1) ?? 0
    if (seq1Count >= 2) reorderCountMap.set(key, seq1Count)
  }

  const itemIds = orderItems.map((oi) => oi.id)
  if (itemIds.length === 0) return { aggMap, multiKeys, orderItemsMap, reorderCountMap }

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
    if (f.type === 'CANCEL' || f.type === 'RETURN') entry.cancel += qty
    if (f.shipment_no) entry.shipped += qty
  }

  return { aggMap, multiKeys, orderItemsMap, reorderCountMap }
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
    if (r.type === 'CANCEL' || r.type === 'RETURN') {
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
//                 AND shipment_type ∈ includeTypes (모달 선택)
//                 AND set_seq=1 OR set_seq IS NULL (세트 중복 방지)
//         - Σ ft_fulfillment_inbounds.quantity (type=CANCEL|RETURN)
//         - Σ ft_fulfillment_outbounds.quantity (type=PACKED AND shipment_id IS NOT NULL)
//               EXCLUDING: shipment_id ∈ excludeShipmentIds (모달 미체크 출고일)
//           ※ shipment_id=NULL 인 PACKED 는 출고 batch 미배정 → '출고' 로 인정 안 함
// ══════════════════════════════════════════════════════════════════

/**
 * barcode 기준으로 '주문 - 취소 - (일부)출고' 합계 조회
 * - si_rg_items.barcode ↔ ft_order_items.barcode 매칭
 * - 모든 쿼리는 `orderUserId` 로 격리 (ft_users.id = si_users.order_user_id)
 *
 * @param barcodes                - rg_items 에서 추출한 barcode 배열
 * @param includeTypes            - 포함할 shipment_type (모달에서 체크된 항목)
 * @param excludeShipmentIds      - 차감 제외할 출고 ID (모달에서 미체크된 출고일)
 * @param orderUserId             - ft_users.id — 필수
 * @returns Map<barcode, OrderDelta>
 */
export async function fetchOrderDelta(
  barcodes: string[],
  includeTypes: ShipmentType[],
  excludeShipmentIds: string[],
  orderUserId: string,
): Promise<Map<string, OrderDelta>> {
  const result = new Map<string, OrderDelta>()
  if (!isOrderSupabaseConfigured || !orderUserId || barcodes.length === 0) return result

  // ════════════════════════════════════════════════════════════════
  // (A) ft_order_items — PROCESSING + includeTypes 조회
  //     - user_id 격리
  //     - status = 'PROCESSING'
  //     - shipment_type ∈ includeTypes (모달에서 선택한 유형)
  //     - barcode ∈ chunk  (si_rg_items.barcode ↔ ft_order_items.barcode)
  // ════════════════════════════════════════════════════════════════
  type OrderItemRow = {
    id: string
    barcode: string | null
    order_qty: number | null
    set_seq: number | null
  }
  const orderItems: OrderItemRow[] = []
  // PostgREST `or` 문법: 선택된 타입을 OR 로 묶음 (대소문자 무시 정확 매칭)
  if (includeTypes.length === 0) return result // 선택된 유형 없으면 결과 없음
  const baseTypeOr = includeTypes
    .map((t) => `shipment_type.ilike.${t}`)
    .join(',')

  for (let i = 0; i < barcodes.length; i += BATCH_SIZE) {
    const chunk = barcodes.slice(i, i + BATCH_SIZE)
    let from = 0
    while (true) {
      const { data, error } = await (orderSupabase.from('ft_order_items') as any)
        .select('id, barcode, order_qty, set_seq')
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

  // ── 집계 + 매핑 ────────────────────────────────────────────────
  //   orderMap      : barcode → 주문수량 합
  //   itemToBarcode : order_item_id → barcode (역매핑)
  const orderMap = new Map<string, number>()
  const itemToBarcode = new Map<string, string>()
  for (const oi of orderItems) {
    if (!oi.barcode) continue
    // ── 세트상품 보정: set_seq=1만 카운트 (비세트=null 포함) ──
    if (oi.set_seq != null && oi.set_seq !== 1) continue
    itemToBarcode.set(oi.id, oi.barcode)
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
            .in('type', ['CANCEL', 'RETURN'])
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

    // ── (C) 출고 — PACKED + shipment_id NOT NULL 조회 후 excludeShipmentIds 로 제외 ──
    //   * shipment_id 있는 PACKED 만 차감 대상 (= 출고 batch 배정된 것만 '출고' 로 인정)
    //   * shipment_id NULL 인 PACKED 는 아직 출고 미배정으로 보고 차감하지 않음
    //   * 이후 excludeShipmentIds 에 해당하는 건만 추가 제외
    (async () => {
      type OutboundRow = {
        order_item_id: string
        quantity: number | null
        shipment_id: string | null
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
            .not('shipment_id', 'is', null)   // ← '출고' 정의: shipment_id 배정된 것만
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
  // 출고 집계 — excludeShipmentIds 에 해당하는 출고건은 차감하지 않음
  // ════════════════════════════════════════════════════════════════
  const excludeSet = new Set(excludeShipmentIds)

  const outboundMap = new Map<string, number>()
  for (const r of outboundRows) {
    const pid = itemToBarcode.get(r.order_item_id)
    if (!pid) continue

    // 모달에서 미체크(제외) 된 출고건은 차감하지 않음
    if (excludeSet.size > 0 && r.shipment_id != null && excludeSet.has(r.shipment_id)) {
      continue
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

// ══════════════════════════════════════════════════════════════════
// 취소 메타 (취소사유 + site_url) — 전량취소 복사용
//   - itemIds 가 [복사] 대상 red 행의 ft_order_items.id 집합
//   - ft_order_items.site_url + ft_cancel_details.cancel_reason 병렬 조회
//   - itemId 별로 합쳐 Map 반환
// ══════════════════════════════════════════════════════════════════

/** 행별 취소사유(여러 건 가능) + site_url */
export interface CancelMeta {
  siteUrl: string | null
  cancelReasons: string[]
}

/**
 * 전량취소 상태 복사 시 Q열에 들어갈 메타 조회
 *
 * @param itemIds      - ft_order_items.id 목록 (red 행의 모든 item 평탄화)
 * @param orderUserId  - ft_users.id — 필수 (격리)
 * @returns Map<itemId, CancelMeta>
 */
export async function fetchCancelMetaForItems(
  itemIds: string[],
  orderUserId: string,
): Promise<Map<string, CancelMeta>> {
  const result = new Map<string, CancelMeta>()
  if (itemIds.length === 0 || !orderUserId) return result

  // ── 1) ft_order_items.site_url + 2) ft_cancel_details.cancel_reason 병렬 ──
  const [items, cancels] = await Promise.all([
    batchIn<{ id: string; site_url: string | null }>(
      'ft_order_items',
      'id, site_url',
      'id',
      itemIds,
    ),
    batchIn<{ order_items_id: string; cancel_reason: string | null }>(
      'ft_cancel_details',
      'order_items_id, cancel_reason',
      'order_items_id',
      itemIds,
    ),
  ])

  // ── itemId → entry 초기화 ──
  for (const id of itemIds) {
    result.set(id, { siteUrl: null, cancelReasons: [] })
  }

  // ── site_url 매핑 ──
  for (const it of items) {
    const entry = result.get(it.id)
    if (entry) entry.siteUrl = it.site_url
  }

  // ── 취소사유 매핑 (같은 item 에 여러 건이면 모두 보존) ──
  for (const c of cancels) {
    const entry = result.get(c.order_items_id)
    if (entry && c.cancel_reason) entry.cancelReasons.push(c.cancel_reason)
  }

  return result
}
