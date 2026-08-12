/* ================================================================
   주문 전송 서비스 (ft_carts + ft_cart_items)
   - 진입점:
     · sendPersonalOrdersPre  : /personal-order [주문 전송] (shipment_type=PERSONAL)
     · sendPurchaseOrdersPre  : /purchase-management [주문 전송] (shipment_type=COUPANG)
   - 공통 흐름은 내부 헬퍼(createCart / insertCartItemsChunked)로 추출.
   - cart_name 은 호출 측(사용자 입력) 으로부터 받음.
     · cart_id   : ft_carts INSERT 시 gen_random_uuid() default
     · cart_name : 호출 인자 (UNIQUE 위반 23505 → 친화 메시지)
   ================================================================ */

import { orderSupabase, isOrderSupabaseConfigured } from './orderSupabase'
import type { PersonalOrderRow } from './personalOrderService'
import type { RgItem } from '../types/purchase'

// ── 상수 ──────────────────────────────────────────────────────────
const INSERT_CHUNK = 1000
const UNIQUE_VIOLATION = '23505'

// ══════════════════════════════════════════════════════════════════
// 내부 헬퍼 — ft_carts INSERT + status='NEW' 업데이트
//   · UNIQUE(user_id, cart_name) 충돌 시 사용자 친화 메시지로 throw
//   · 반환: 새로 생성된 cart_id
// ══════════════════════════════════════════════════════════════════

async function createCart(orderUserId: string, trimmedName: string): Promise<string> {
  // ── (1) ft_carts INSERT ──
  const { data: cartRow, error: cartError } = await (orderSupabase.from('ft_carts') as any)
    .insert({ user_id: orderUserId, cart_name: trimmedName })
    .select('id')
    .single()
  if (cartError) {
    console.error('[orderSendService:ft_carts insert]', cartError)
    if ((cartError as any).code === UNIQUE_VIOLATION) {
      throw new Error(`이미 "${trimmedName}" 카트가 존재합니다. 다른 이름을 사용해 주세요.`)
    }
    throw cartError
  }
  const cartId = (cartRow as { id?: string })?.id
  if (!cartId) {
    throw new Error('카트 생성에 실패했습니다. (id 반환 없음)')
  }

  // ── (2) ft_carts.status = 'NEW' 업데이트 ──
  const { error: cartUpdateError } = await (orderSupabase.from('ft_carts') as any)
    .update({ status: 'NEW' })
    .eq('id', cartId)
  if (cartUpdateError) {
    console.error('[orderSendService:ft_carts update]', cartUpdateError)
    throw cartUpdateError
  }

  return cartId
}

// ══════════════════════════════════════════════════════════════════
// 카트 목록 조회 — 기존 카트에 추가하기 위한 선택지
// ══════════════════════════════════════════════════════════════════

export interface CartOption {
  id: string
  cart_name: string
  status: string | null
  created_at: string | null
}

/** 아직 처리되지 않은(추가 가능한) 카트 상태 */
export const CART_STATUS_NEW = 'NEW'

/**
 * 사용자의 카트 목록 (최신순).
 * - onlyNew: status='NEW' 카트만 (이미 처리된 카트에 담기는 것을 막는다)
 * PostgREST 기본 1000행 제한 → range 루프로 전체 조회 (CLAUDE.md 룰 5)
 */
export async function fetchCarts(
  orderUserId: string,
  opts: { onlyNew?: boolean } = {},
): Promise<CartOption[]> {
  if (!isOrderSupabaseConfigured || !orderUserId) return []

  const all: CartOption[] = []
  let from = 0
  while (true) {
    let query = (orderSupabase.from('ft_carts') as any)
      .select('id, cart_name, status, created_at')
      .eq('user_id', orderUserId)
    if (opts.onlyNew) query = query.eq('status', CART_STATUS_NEW)

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .range(from, from + 999)
    if (error) {
      console.error('[orderSendService:fetchCarts]', error)
      throw error
    }
    const rows = (data ?? []) as CartOption[]
    all.push(...rows)
    if (rows.length < 1000) break
    from += 1000
  }
  return all
}

// ══════════════════════════════════════════════════════════════════
// 카트 대상 — 신규 생성 또는 기존 카트에 추가
// ══════════════════════════════════════════════════════════════════

export type CartTarget =
  | { mode: 'new'; cartName: string }
  | { mode: 'existing'; cartId: string }

/**
 * 대상 카트를 확정한다.
 * - new      : 카트 생성 후 cart_seq 1 부터
 * - existing : 기존 카트명을 읽고, 마지막 cart_seq 다음부터 이어붙인다
 */
async function resolveCart(
  orderUserId: string,
  target: CartTarget,
): Promise<{ cartId: string; cartName: string; startSeq: number }> {
  if (target.mode === 'new') {
    const trimmed = target.cartName.trim()
    if (!trimmed) throw new Error('카트 이름이 비어 있습니다.')
    const cartId = await createCart(orderUserId, trimmed)
    return { cartId, cartName: trimmed, startSeq: 1 }
  }

  // ── 기존 카트 ──
  if (!target.cartId) throw new Error('카트를 선택해 주세요.')
  const { data: cart, error: cartErr } = await (orderSupabase.from('ft_carts') as any)
    .select('id, cart_name')
    .eq('id', target.cartId)
    .eq('user_id', orderUserId)
    .single()
  if (cartErr || !cart) {
    console.error('[orderSendService:resolveCart]', cartErr)
    throw new Error('선택한 카트를 찾을 수 없습니다.')
  }

  // 기존 아이템 뒤에 이어붙이도록 마지막 순번 확인
  const { data: last, error: seqErr } = await (orderSupabase.from('ft_cart_items') as any)
    .select('cart_seq')
    .eq('cart_id', target.cartId)
    .order('cart_seq', { ascending: false })
    .limit(1)
  if (seqErr) {
    console.error('[orderSendService:cart_seq]', seqErr)
    throw seqErr
  }
  const maxSeq = Number((last as any[])?.[0]?.cart_seq ?? 0) || 0

  return {
    cartId: cart.id as string,
    cartName: (cart.cart_name as string) ?? '',
    startSeq: maxSeq + 1,
  }
}

// ══════════════════════════════════════════════════════════════════
// 내부 헬퍼 — ft_cart_items 1000건 청크 insert (CLAUDE.md 룰 5)
// ══════════════════════════════════════════════════════════════════

async function insertCartItemsChunked(payload: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < payload.length; i += INSERT_CHUNK) {
    const chunk = payload.slice(i, i + INSERT_CHUNK)
    const { error } = await (orderSupabase.from('ft_cart_items') as any).insert(chunk)
    if (error) {
      console.error('[orderSendService:ft_cart_items insert]', error)
      throw error
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// 진입점 1: 개인주문 일괄 전송 (shipment_type=PERSONAL)
// ══════════════════════════════════════════════════════════════════

/**
 * 체크된 PersonalOrderRow[] 를 ft_cart_items 에 일괄 insert
 *
 * 매핑:
 *   item_name        ← r.item_name
 *   option_name      ← r.option_name
 *   order_qty        ← r.shipping_count
 *   barcode          ← r.barcode
 *   vendor_option_id ← r.vendor_item_id
 *   user_id          ← orderUserId
 *   cart_id          ← ft_carts INSERT 반환
 *   cart_name        ← 호출 인자 (사용자 입력)
 *   shipment_type    ← 'PERSONAL'
 *   personal_order_no← r.order_id
 *   cart_seq         ← 1-based 순번
 */
export async function sendPersonalOrdersPre(
  rows: PersonalOrderRow[],
  orderUserId: string,
  target: CartTarget,
): Promise<{ count: number; cartId: string; cartName: string }> {
  // ── 가드 ──────────────────────────────────────────────────────
  if (!isOrderSupabaseConfigured) {
    throw new Error('주문 DB 환경변수가 설정되지 않았습니다.')
  }
  if (!orderUserId) throw new Error('주문 계정(orderUserId)이 없습니다.')
  if (rows.length === 0) throw new Error('전송할 행이 없습니다.')

  // ── (1) 카트 확정 (신규 생성 또는 기존 카트 이어붙이기) ──
  const { cartId, cartName: trimmedName, startSeq } = await resolveCart(orderUserId, target)

  // ── (2) payload 매핑 ──
  const payload = rows.map((r, idx) => ({
    item_name: r.item_name,
    option_name: r.option_name,
    order_qty: r.shipping_count,
    barcode: r.barcode,
    vendor_option_id: r.vendor_item_id,
    user_id: orderUserId,
    cart_id: cartId,
    cart_name: trimmedName,
    shipment_type: 'PERSONAL' as const,
    personal_order_no: r.order_id,
    cart_seq: startSeq + idx,
  }))

  // ── (3) 아이템 insert ──
  await insertCartItemsChunked(payload)

  return { count: rows.length, cartId, cartName: trimmedName }
}

// ══════════════════════════════════════════════════════════════════
// 진입점 2: 사입관리 주문 일괄 전송 (shipment_type=COUPANG)
// ══════════════════════════════════════════════════════════════════

/**
 * input>0 으로 필터된 RgItem[] 을 ft_cart_items 에 일괄 insert
 * (input>0 필터는 호출 측에서 수행)
 *
 * 매핑:
 *   item_name        ← r.seller_product_name
 *   option_name      ← r.option_name
 *   order_qty        ← r.input ([입력] 값)
 *   barcode          ← r.barcode
 *   vendor_option_id ← r.vendor_item_id (옵션 ID)
 *   user_id          ← orderUserId
 *   cart_id          ← ft_carts INSERT 반환
 *   cart_name        ← 호출 인자 (사용자 입력)
 *   shipment_type    ← 'COUPANG'
 *   cart_seq         ← 1-based 순번
 *   그 외 컬럼       ← null (purchase-agent 카트 UI 에서 채움)
 */
export async function sendPurchaseOrdersPre(
  rows: RgItem[],
  orderUserId: string,
  target: CartTarget,
): Promise<{ count: number; cartId: string; cartName: string }> {
  // ── 가드 ──────────────────────────────────────────────────────
  if (!isOrderSupabaseConfigured) {
    throw new Error('주문 DB 환경변수가 설정되지 않았습니다.')
  }
  if (!orderUserId) throw new Error('주문 계정(orderUserId)이 없습니다.')
  if (rows.length === 0) throw new Error('전송할 행이 없습니다.')

  // ── (1) 카트 확정 (신규 생성 또는 기존 카트 이어붙이기) ──
  const { cartId, cartName: trimmedName, startSeq } = await resolveCart(orderUserId, target)

  // ── (2) payload 매핑 ──
  const payload = rows.map((r, idx) => ({
    item_name: r.seller_product_name,
    option_name: r.option_name,
    order_qty: r.input,
    barcode: r.barcode,
    vendor_option_id: r.vendor_item_id,
    user_id: orderUserId,
    cart_id: cartId,
    cart_name: trimmedName,
    shipment_type: 'COUPANG' as const,
    cart_seq: startSeq + idx,
  }))

  // ── (3) 아이템 insert ──
  await insertCartItemsChunked(payload)

  return { count: rows.length, cartId, cartName: trimmedName }
}
