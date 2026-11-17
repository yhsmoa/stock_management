/* ================================================================
   useProductOrderStatus — 상세 패널 [주문상황] 탭 데이터
   - 탭이 보일 때(enabled) 바코드의 주문 줄을 받는다. 같은 바코드는 다시 받지 않고
     [새로고침]만 다시 받는다.
   - 바코드가 바뀌거나 패널이 닫히면 진행 중이던 응답은 버린다 (늦은 응답이 덮어쓰지 않게).
   ================================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getOrderUserId } from '../../services/supabase'
import { isOrderSupabaseConfigured } from '../../services/orderSupabase'
import { fetchProductOrderLines, type ProductOrderLine } from '../../services/productOrderStatusService'

// ── 상태 ──────────────────────────────────────────────────────────
export type OrderStatusLoad =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'unavailable'; message: string }   // 조회할 수 없는 조건 (바코드·계정·환경변수 없음)
  | { kind: 'error'; message: string }
  | { kind: 'ready'; lines: ProductOrderLine[] }

/** 어느 바코드의 결과인지 함께 둔다 — 바코드가 바뀐 직후 이전 결과가 보이지 않게 */
type KeyedLoad = { barcode: string; load: OrderStatusLoad }

const IDLE: OrderStatusLoad = { kind: 'idle' }

// ══════════════════════════════════════════════════════════════════
// 훅
// ══════════════════════════════════════════════════════════════════
export function useProductOrderStatus(barcode: string | null | undefined, enabled: boolean) {
  const bc = barcode?.trim() ?? ''
  const [state, setState] = useState<KeyedLoad>({ barcode: '', load: IDLE })
  const [nonce, setNonce] = useState(0)          // [새로고침] 마다 +1
  const startedKeyRef = useRef<string | null>(null) // 마지막으로 시작한 요청 (바코드#nonce)

  useEffect(() => {
    const key = `${bc}#${nonce}`
    if (!enabled || startedKeyRef.current === key) return
    startedKeyRef.current = key

    const set = (load: OrderStatusLoad) => setState({ barcode: bc, load })

    // ── 조회할 수 없는 조건 ────────────────────────────────────────
    if (!bc) {
      set({ kind: 'unavailable', message: '바코드가 없어 주문 내역을 찾을 수 없습니다.' })
      return
    }
    if (!isOrderSupabaseConfigured) {
      set({ kind: 'unavailable', message: '주문 DB 가 연결되어 있지 않습니다.' })
      return
    }

    // ── 조회 ──────────────────────────────────────────────────────
    let cancelled = false
    let finished = false
    set({ kind: 'loading' })
    ;(async () => {
      try {
        const orderUserId = await getOrderUserId()
        if (cancelled) return
        if (!orderUserId) {
          set({ kind: 'unavailable', message: '주문 계정(order_user_id)이 연결되지 않은 계정입니다.' })
          return
        }
        const lines = await fetchProductOrderLines(bc, orderUserId)
        if (cancelled) return
        set({ kind: 'ready', lines })
      } catch (e) {
        if (cancelled) return
        console.error('[useProductOrderStatus]', e)
        set({ kind: 'error', message: (e as Error).message || '주문 내역을 불러오지 못했습니다.' })
      } finally {
        finished = true
      }
    })()

    return () => {
      cancelled = true
      // 끝나기 전에 버린 요청은 다음에 다시 받도록 표시를 지운다 (패널을 닫았다 다시 연 경우 등)
      if (!finished && startedKeyRef.current === key) startedKeyRef.current = null
    }
  }, [enabled, bc, nonce])

  // ── [새로고침] ──────────────────────────────────────────────────
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return { load: state.barcode === bc ? state.load : IDLE, reload }
}
