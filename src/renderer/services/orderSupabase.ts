/* ================================================================
   주문 프로젝트 Supabase 클라이언트
   - purchase_agent 프로젝트와 동일한 DB 인스턴스에 접속
   - fulfillment 데이터(입고/포장/취소/출고) 조회 전용
   - 환경변수 미설정 시에도 모듈 로드 실패 방지 (placeholder 사용)
   ================================================================ */

import { createClient } from '@supabase/supabase-js'

// ── 환경변수 로드 ─────────────────────────────────────────────
const orderUrl = import.meta.env.VITE_ORDER_SUPABASE_URL || ''
const orderKey = import.meta.env.VITE_ORDER_SUPABASE_ANON_KEY || ''

// ── 환경변수 누락 시 placeholder 사용 (createClient validation 통과용) ──
// 실제 쿼리 시점에는 isOrderSupabaseConfigured 로 가드 처리
const PLACEHOLDER_URL = 'https://placeholder.supabase.co'
const PLACEHOLDER_KEY = 'placeholder-anon-key'

export const isOrderSupabaseConfigured = Boolean(orderUrl && orderKey)

if (!isOrderSupabaseConfigured) {
  console.warn('[orderSupabase] 주문 DB 환경변수가 설정되지 않아 비활성화됩니다.')
}

export const orderSupabase = createClient(
  orderUrl || PLACEHOLDER_URL,
  orderKey || PLACEHOLDER_KEY,
)
