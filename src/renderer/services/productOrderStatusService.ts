/* ================================================================
   상품 주문상황 서비스 — 사입관리 상세 패널 [주문상황] 탭
   - 주문 프로젝트(purchase_agent) DB 에서 바코드 1개의 구매주문 줄과
     입고 · 취소 · 포장 · 출고 기록을 읽어 줄마다 진행 단계를 정한다.
   - 사입관리 '주문' 열(orderFulfillmentService.fetchOrderDelta)과 같은 정의를 쓴다:
       · 세트상품은 대표행(set_seq = 1 또는 null)만 본다
       · 취소 = inbounds CANCEL + RETURN
       · 출고 = outbounds PACKED 중 shipment_id 가 배정된 것
     '주문' 열은 [주문] 모달에서 고른 유형 · 출고일만 반영하므로 이 탭의 합과 다를 수 있다.
   ================================================================ */

import { orderSupabase, isOrderSupabaseConfigured } from './orderSupabase'

// ── 상수 ──────────────────────────────────────────────────────────
const ID_CHUNK_SIZE = 100   // .in() URL 길이 제한
const PAGE_SIZE = 1000      // PostgREST 기본 limit — 페이지 루프 단위

// ══════════════════════════════════════════════════════════════════
// 타입
// ══════════════════════════════════════════════════════════════════

/** 주문 줄 진행 단계 (수량 기준 — deriveOrderLineStage) */
export type OrderLineStage =
  | 'canceled'      // 유효 수량 0 (전량 취소 · 반품)
  | 'shipped'       // 출고 완료 (유효 수량만큼 출고 배정)
  | 'packed'        // 포장 완료 · 출고 배정 전
  | 'arrived'       // 입고 완료 · 포장 전
  | 'partial'       // 일부 입고
  | 'waiting'       // 입고 대기 (주문만 됨)

/** 단계 표시 이름 */
export const ORDER_LINE_STAGE_LABELS: Record<OrderLineStage, string> = {
  canceled: '취소',
  shipped: '출고완료',
  packed: '포장완료',
  arrived: '입고완료',
  partial: '일부 입고',
  waiting: '입고 대기',
}

/** 주문 줄 1개 (ft_order_items 대표행 + 기록 합계) */
export interface ProductOrderLine {
  id: string
  createdAt: string
  orderNo: string | null
  itemNo: string | null
  shipmentType: string | null      // COUPANG / DIRECT / PERSONAL (원문)
  isProcessing: boolean            // ft_order_items.status = 'PROCESSING'
  personalOrderNo: string | null   // 개인주문이면 쿠팡 주문번호
  orderQty: number
  arrival: number
  cancel: number
  packed: number                   // 포장 전체 (출고 배정 여부 무관)
  shipped: number                  // 포장 중 출고 배정된 것
  remaining: number                // 유효 수량 − 출고 (음수면 0)
  shipmentNos: string[]            // 출고 배정된 쉽먼트 번호 (중복 제거)
  stage: OrderLineStage
}

// ══════════════════════════════════════════════════════════════════
// 순수 함수: 진행 단계 판정
// ══════════════════════════════════════════════════════════════════

/**
 * 수량으로 진행 단계를 정한다 (위에서부터 먼저 맞는 것)
 * - 유효 수량 = 주문 − 취소. 0 이하이면 취소.
 * - 출고 ≥ 유효 → 출고완료 / 포장 ≥ 유효 → 포장완료 / 입고 ≥ 유효 → 입고완료
 * - 입고가 조금이라도 있으면 일부 입고, 없으면 입고 대기
 */
export function deriveOrderLineStage(q: {
  orderQty: number
  arrival: number
  cancel: number
  packed: number
  shipped: number
}): OrderLineStage {
  const effective = q.orderQty - q.cancel
  if (effective <= 0) return 'canceled'
  if (q.shipped >= effective) return 'shipped'
  if (q.packed >= effective) return 'packed'
  if (q.arrival >= effective) return 'arrived'
  if (q.arrival > 0) return 'partial'
  return 'waiting'
}

// ══════════════════════════════════════════════════════════════════
// 조회 헬퍼: 전 구간 페이지 루프 (1000건 limit 대응)
// ══════════════════════════════════════════════════════════════════

/**
 * 한 쿼리를 range 페이지로 끝까지 받는다
 * - build 는 매 페이지 새 쿼리를 만들어야 한다 (PostgREST 빌더는 재사용 불가)
 * - 페이지 사이 순서가 흔들리지 않도록 build 안에서 id 로 정렬한다
 */
async function fetchAllPages<T>(build: () => any, label: string): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error(`[productOrderStatusService:${label}]`, error)
      throw error
    }
    rows.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

/** order_item_id 목록을 100개씩 나눠 페이지 루프로 받는다 (user_id 격리) */
async function fetchByItemIds<T>(
  table: string,
  select: string,
  itemIds: string[],
  orderUserId: string,
): Promise<T[]> {
  const chunks: string[][] = []
  for (let i = 0; i < itemIds.length; i += ID_CHUNK_SIZE) {
    chunks.push(itemIds.slice(i, i + ID_CHUNK_SIZE))
  }
  const results = await Promise.all(
    chunks.map((chunk) =>
      fetchAllPages<T>(
        () => (orderSupabase.from(table) as any)
          .select(select)
          .eq('user_id', orderUserId)
          .in('order_item_id', chunk)
          .order('id'),
        table,
      ),
    ),
  )
  return results.flat()
}

// ══════════════════════════════════════════════════════════════════
// 메인: 바코드 1개의 주문 줄 조회
// ══════════════════════════════════════════════════════════════════

/**
 * 바코드의 구매주문 줄 전체(진행 중 + 완료)를 최신순으로 돌려준다
 * - 주문 DB 미설정 · order_user_id 없음 · 바코드 없음은 호출하는 쪽에서 막는다 (여기선 Error)
 */
export async function fetchProductOrderLines(
  barcode: string,
  orderUserId: string,
): Promise<ProductOrderLine[]> {
  if (!isOrderSupabaseConfigured) throw new Error('주문 DB 환경변수가 설정되지 않았습니다.')
  if (!orderUserId) throw new Error('주문 계정(order_user_id)이 없습니다.')
  if (!barcode) return []

  // ── 1) 주문 줄 (대표행만 — 세트 구성품 중복 방지) ──────────────
  type ItemRow = {
    id: string
    created_at: string
    order_no: string | null
    item_no: string | null
    shipment_type: string | null
    status: string | null
    personal_order_no: string | null
    order_qty: number | null
    set_seq: number | null
  }
  const items = (await fetchAllPages<ItemRow>(
    () => (orderSupabase.from('ft_order_items') as any)
      .select('id, created_at, order_no, item_no, shipment_type, status, personal_order_no, order_qty, set_seq')
      .eq('user_id', orderUserId)
      .eq('barcode', barcode)
      .order('id'),
    'ft_order_items',
  )).filter((r) => r.set_seq == null || r.set_seq === 1)

  if (items.length === 0) return []
  const itemIds = items.map((r) => r.id)

  // ── 2) 입고 · 취소 / 포장 · 출고 기록 (병렬) ─────────────────────
  type InboundRow = { order_item_id: string; type: string | null; quantity: number | null }
  type OutboundRow = {
    order_item_id: string
    type: string | null
    quantity: number | null
    shipment_id: string | null
    shipment_no: string | null
  }
  const [inbounds, outbounds] = await Promise.all([
    fetchByItemIds<InboundRow>('ft_fulfillment_inbounds', 'order_item_id, type, quantity', itemIds, orderUserId),
    fetchByItemIds<OutboundRow>(
      'ft_fulfillment_outbounds',
      'order_item_id, type, quantity, shipment_id, shipment_no',
      itemIds,
      orderUserId,
    ),
  ])

  // ── 3) 줄별 합계 ────────────────────────────────────────────────
  const sums = new Map<string, { arrival: number; cancel: number; packed: number; shipped: number; shipmentNos: Set<string> }>()
  const sumOf = (id: string) => {
    let s = sums.get(id)
    if (!s) {
      s = { arrival: 0, cancel: 0, packed: 0, shipped: 0, shipmentNos: new Set() }
      sums.set(id, s)
    }
    return s
  }
  for (const r of inbounds) {
    const qty = r.quantity ?? 0
    if (r.type === 'ARRIVAL') sumOf(r.order_item_id).arrival += qty
    else if (r.type === 'CANCEL' || r.type === 'RETURN') sumOf(r.order_item_id).cancel += qty
  }
  for (const r of outbounds) {
    if (r.type !== 'PACKED') continue
    const s = sumOf(r.order_item_id)
    const qty = r.quantity ?? 0
    s.packed += qty
    if (r.shipment_id != null) {
      s.shipped += qty
      if (r.shipment_no) s.shipmentNos.add(r.shipment_no)
    }
  }

  // ── 4) 줄 조립 + 최신순 정렬 ────────────────────────────────────
  return items
    .map((r): ProductOrderLine => {
      const s = sums.get(r.id)
      const q = {
        orderQty: r.order_qty ?? 0,
        arrival: s?.arrival ?? 0,
        cancel: s?.cancel ?? 0,
        packed: s?.packed ?? 0,
        shipped: s?.shipped ?? 0,
      }
      return {
        id: r.id,
        createdAt: r.created_at,
        orderNo: r.order_no,
        itemNo: r.item_no,
        shipmentType: r.shipment_type,
        isProcessing: r.status === 'PROCESSING',
        personalOrderNo: r.personal_order_no,
        ...q,
        remaining: Math.max(0, q.orderQty - q.cancel - q.shipped),
        shipmentNos: [...(s?.shipmentNos ?? [])].sort(),
        stage: deriveOrderLineStage(q),
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

/** 화면 표시용 유형 이름 — 주문 모달과 같은 코드(COUPANG 등). DB 값은 대소문자가 섞일 수 있다 */
export function shipmentTypeLabel(type: string | null): string {
  return type ? type.toUpperCase() : '-'
}
