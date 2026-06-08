/* ================================================================
   주문 전송 서비스
   - 개인주문 행(체크된 행)을 purchase_agent.ft_cart_items 로
     일괄 insert
   - cart_id / cart_name 은 Postgres RPC(create_cart)가 발급
     · cart_id   : DB 가 gen_random_uuid() 로 생성
     · cart_name : user_id 범위 내 비어있는 가장 작은 'cart-N'
                   (UNIQUE 위반 예외 캐치 → 다음 N 재시도)
   ================================================================ */

import { orderSupabase, isOrderSupabaseConfigured } from './orderSupabase'
import type { PersonalOrderRow } from './personalOrderService'

// ── 상수 ──────────────────────────────────────────────────────────
const INSERT_CHUNK = 1000

// ══════════════════════════════════════════════════════════════════
// 메인: 개인주문 일괄 전송 (ft_cart_items insert)
// ══════════════════════════════════════════════════════════════════

/**
 * 체크된 PersonalOrderRow[] 를 ft_cart_items 에 일괄 insert
 *
 * 흐름:
 *   1) RPC `create_cart(p_user_id)` 호출 → cart_id / cart_name 발급
 *   2) rows.map → payload 생성 (cart_id / cart_name 전체 batch 공유)
 *   3) 1000건 청크 insert
 *
 * 매핑:
 *   item_name        ← r.item_name
 *   option_name      ← r.option_name
 *   order_qty        ← r.shipping_count
 *   barcode          ← r.barcode
 *   vendor_option_id ← r.vendor_item_id (옵션 ID)
 *   user_id          ← orderUserId (ft_users.id)
 *   cart_id          ← create_cart 반환값
 *   cart_name        ← create_cart 반환값
 *   shipment_type    ← 'PERSONAL' (고정)
 *   personal_order_no← r.order_id (쿠팡 주문번호)
 *   cart_seq         ← 1부터 시작하는 카트 내 순번
 *
 * @param rows         - 체크된 개인주문 행
 * @param orderUserId  - ft_users.id (= si_users.order_user_id)
 * @returns 처리 결과 (count / cartId / cartName)
 */
export async function sendPersonalOrdersPre(
  rows: PersonalOrderRow[],
  orderUserId: string,
): Promise<{ count: number; cartId: string; cartName: string }> {
  // ── 가드 ──────────────────────────────────────────────────────
  if (!isOrderSupabaseConfigured) {
    throw new Error('주문 DB 환경변수가 설정되지 않았습니다.')
  }
  if (!orderUserId) throw new Error('주문 계정(orderUserId)이 없습니다.')
  if (rows.length === 0) throw new Error('전송할 행이 없습니다.')

  // ── (1) RPC: 카트 생성 ────────────────────────────────────────
  const { data, error: rpcError } = await (orderSupabase as any).rpc('create_cart', {
    p_user_id: orderUserId,
  })
  if (rpcError) {
    console.error('[sendPersonalOrdersPre:create_cart]', rpcError)
    throw rpcError
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { cart_id: string; cart_name: string }
    | undefined
  const cartId = row?.cart_id
  const cartName = row?.cart_name
  if (!cartId || !cartName) {
    throw new Error('카트 생성에 실패했습니다. (RPC 응답 비정상)')
  }

  // ── (1-1) ft_carts.status = 'NEW' 업데이트 ───────────────────
  const { error: cartUpdateError } = await (orderSupabase
    .from('ft_carts') as any)
    .update({ status: 'NEW' })
    .eq('id', cartId)
  if (cartUpdateError) {
    console.error('[sendPersonalOrdersPre:ft_carts update]', cartUpdateError)
    throw cartUpdateError
  }

  // ── (2) payload 매핑 ──────────────────────────────────────────
  //   cart_seq 는 rows 전체 길이 기준 1-based 순번
  //   (1000건 청크 분할은 이 payload 이후라 청크 경계 영향 없음)
  const payload = rows.map((r, idx) => ({
    item_name: r.item_name,
    option_name: r.option_name,
    order_qty: r.shipping_count,
    barcode: r.barcode,
    vendor_option_id: r.vendor_item_id,
    user_id: orderUserId,
    cart_id: cartId,
    cart_name: cartName,
    shipment_type: 'PERSONAL' as const,
    personal_order_no: r.order_id,
    cart_seq: idx + 1,
  }))

  // ── (3) ft_cart_items 1000건 청크 insert ──────────────────────
  for (let i = 0; i < payload.length; i += INSERT_CHUNK) {
    const chunk = payload.slice(i, i + INSERT_CHUNK)
    const { error } = await (orderSupabase.from('ft_cart_items') as any).insert(chunk)
    if (error) {
      console.error('[sendPersonalOrdersPre:insert]', error)
      throw error
    }
  }

  return { count: rows.length, cartId, cartName }
}
