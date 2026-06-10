/* ================================================================
   주문 전송 서비스
   - 개인주문 행(체크된 행)을 purchase_agent.ft_cart_items 로
     일괄 insert
   - cart_name 은 호출 측(사용자 입력) 으로부터 받음
     · cart_id   : ft_carts INSERT 시 gen_random_uuid() default
     · cart_name : 호출 인자
                   (UNIQUE 위반 23505 시 사용자 친화 메시지로 변환)
   ================================================================ */

import { orderSupabase, isOrderSupabaseConfigured } from './orderSupabase'
import type { PersonalOrderRow } from './personalOrderService'

// ── 상수 ──────────────────────────────────────────────────────────
const INSERT_CHUNK = 1000
const UNIQUE_VIOLATION = '23505'

// ══════════════════════════════════════════════════════════════════
// 메인: 개인주문 일괄 전송 (ft_carts insert + ft_cart_items insert)
// ══════════════════════════════════════════════════════════════════

/**
 * 체크된 PersonalOrderRow[] 를 ft_cart_items 에 일괄 insert
 *
 * 흐름:
 *   1) ft_carts INSERT — cart_name 은 호출 인자, cart_id 는 DB 발급
 *   2) rows.map → payload 생성 (cart_id / cart_name 전체 batch 공유)
 *   3) 1000건 청크 insert (ft_cart_items)
 *
 * 매핑:
 *   item_name        ← r.item_name
 *   option_name      ← r.option_name
 *   order_qty        ← r.shipping_count
 *   barcode          ← r.barcode
 *   vendor_option_id ← r.vendor_item_id (옵션 ID)
 *   user_id          ← orderUserId (ft_users.id)
 *   cart_id          ← ft_carts INSERT 반환 id
 *   cart_name        ← 호출 인자 (사용자 입력)
 *   shipment_type    ← 'PERSONAL' (고정)
 *   personal_order_no← r.order_id (쿠팡 주문번호)
 *   cart_seq         ← 1부터 시작하는 카트 내 순번
 *
 * @param rows         - 체크된 개인주문 행
 * @param orderUserId  - ft_users.id (= si_users.order_user_id)
 * @param cartName     - 사용자가 입력한 카트 이름 (trim 후 non-empty)
 * @returns 처리 결과 (count / cartId / cartName)
 */
export async function sendPersonalOrdersPre(
  rows: PersonalOrderRow[],
  orderUserId: string,
  cartName: string,
): Promise<{ count: number; cartId: string; cartName: string }> {
  // ── 가드 ──────────────────────────────────────────────────────
  if (!isOrderSupabaseConfigured) {
    throw new Error('주문 DB 환경변수가 설정되지 않았습니다.')
  }
  if (!orderUserId) throw new Error('주문 계정(orderUserId)이 없습니다.')
  if (rows.length === 0) throw new Error('전송할 행이 없습니다.')
  const trimmedName = cartName.trim()
  if (!trimmedName) throw new Error('카트 이름이 비어 있습니다.')

  // ── (1) ft_carts INSERT — UNIQUE(user_id, cart_name) 충돌 처리 ─
  const { data: cartRow, error: cartError } = await (orderSupabase.from('ft_carts') as any)
    .insert({ user_id: orderUserId, cart_name: trimmedName })
    .select('id')
    .single()
  if (cartError) {
    console.error('[sendPersonalOrdersPre:ft_carts]', cartError)
    if ((cartError as any).code === UNIQUE_VIOLATION) {
      throw new Error(`이미 "${trimmedName}" 카트가 존재합니다. 다른 이름을 사용해 주세요.`)
    }
    throw cartError
  }
  const cartId = (cartRow as { id?: string })?.id
  if (!cartId) {
    throw new Error('카트 생성에 실패했습니다. (id 반환 없음)')
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
    cart_name: trimmedName,
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

  return { count: rows.length, cartId, cartName: trimmedName }
}
