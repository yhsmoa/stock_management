/* ================================================================
   주문 프로젝트 Supabase 클라이언트
   - purchase_agent 프로젝트와 동일한 DB 인스턴스에 접속
   - fulfillment 데이터(입고/포장/취소/출고) 조회 전용
   ================================================================ */

import { createClient } from '@supabase/supabase-js'

const orderUrl = import.meta.env.VITE_ORDER_SUPABASE_URL || ''
const orderKey = import.meta.env.VITE_ORDER_SUPABASE_ANON_KEY || ''

if (!orderUrl || !orderKey) {
  console.warn('[orderSupabase] 주문 DB 환경변수가 설정되지 않았습니다.')
}

export const orderSupabase = createClient(orderUrl, orderKey)
