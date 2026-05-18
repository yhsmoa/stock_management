/* ================================================================
   주문 전송 서비스
   - 개인주문 행(체크된 행)을 purchase_agent.ft_order_items_pre 에
     사전 카트 형태로 일괄 insert
   - cart_id  : 1 회 전송 = 단일 UUID 공유
   - cart_name: user_id 범위 내에서 비어있는 가장 작은 'cart-N'
   ================================================================ */

import { orderSupabase, isOrderSupabaseConfigured } from './orderSupabase'
import type { PersonalOrderRow } from './personalOrderService'

// ── 상수 ──────────────────────────────────────────────────────────
const PAGE_SIZE = 1000   // Supabase 기본 limit
const INSERT_CHUNK = 1000

// ══════════════════════════════════════════════════════════════════
// 헬퍼: 다음 cart_name 산출
//   - user_id 범위 내 'cart-N' 사용 중인 N 집합 수집
//   - 1 부터 증가하며 비어있는 가장 작은 N 반환
// ══════════════════════════════════════════════════════════════════

async function getNextCartName(orderUserId: string): Promise<string> {
  const used = new Set<number>()

  // ── 1000-row 페이지네이션 루프 ──────────────────────────────────
  let from = 0
  while (true) {
    const { data, error } = await (orderSupabase.from('ft_order_items_pre') as any)
      .select('cart_name')
      .eq('user_id', orderUserId)
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error('[getNextCartName]', error)
      throw error
    }
    const rows = (data ?? []) as { cart_name: string | null }[]
    for (const r of rows) {
      const m = r.cart_name?.match(/^cart-(\d+)$/)
      if (m) used.add(parseInt(m[1], 10))
    }
    if (rows.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  // ── 비어있는 가장 작은 N ───────────────────────────────────────
  let n = 1
  while (used.has(n)) n++
  return `cart-${n}`
}

// ══════════════════════════════════════════════════════════════════
// 메인: 개인주문 일괄 전송 (ft_order_items_pre insert)
// ══════════════════════════════════════════════════════════════════

/**
 * 체크된 PersonalOrderRow[] 를 ft_order_items_pre 에 사전 카트로 일괄 insert
 *
 * 매핑:
 *   item_name        ← r.item_name
 *   option_name      ← r.option_name
 *   order_qty        ← r.shipping_count
 *   barcode          ← r.barcode
 *   vendor_option_id ← r.vendor_item_id (옵션 ID)
 *   user_id          ← orderUserId (ft_users.id)
 *   cart_id          ← 단일 UUID (전체 batch 공통)
 *   cart_name        ← 'cart-N' (비어있는 가장 작은 N)
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

  // ── cart_name / cart_id 산출 ───────────────────────────────────
  const cartName = await getNextCartName(orderUserId)
  const cartId = crypto.randomUUID()

  // ── payload 매핑 ───────────────────────────────────────────────
  const payload = rows.map((r) => ({
    item_name: r.item_name,
    option_name: r.option_name,
    order_qty: r.shipping_count,
    barcode: r.barcode,
    vendor_option_id: r.vendor_item_id,
    user_id: orderUserId,
    cart_id: cartId,
    cart_name: cartName,
  }))

  // ── 1000건 청크 insert ─────────────────────────────────────────
  for (let i = 0; i < payload.length; i += INSERT_CHUNK) {
    const chunk = payload.slice(i, i + INSERT_CHUNK)
    const { error } = await (orderSupabase.from('ft_order_items_pre') as any).insert(chunk)
    if (error) {
      console.error('[sendPersonalOrdersPre:insert]', error)
      throw error
    }
  }

  return { count: rows.length, cartId, cartName }
}
