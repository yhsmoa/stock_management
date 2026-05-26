/* ================================================================
   상품정보 서비스 (si_item_info)
   - 사용자별 상품 정보(모델명/바코드/혼용률/추천연령) 조회·저장
   - 1000-row 페이지네이션 + 청크 upsert (CLAUDE.md 룰 5)
   ================================================================ */

import { supabase } from './supabase'

// ── 상수 ──────────────────────────────────────────────────────────
const PAGE_SIZE = 1000
const UPSERT_CHUNK = 1000

// ══════════════════════════════════════════════════════════════════
// 타입 정의
// ══════════════════════════════════════════════════════════════════

export interface ItemInfoRow {
  id: string
  user_id: string
  model_name: string | null
  barcode: string | null
  composition: string | null         // 혼용률
  recommended_age: string | null     // 추천연령
  created_at?: string
  updated_at?: string
}

/** upsert 페이로드 (id 는 신규 행이면 생략) */
export type ItemInfoUpsert = Partial<ItemInfoRow> & {
  user_id: string
  barcode: string
}

// ══════════════════════════════════════════════════════════════════
// 조회 — 사용자의 모든 si_item_info 행 (1000-row 페이지네이션)
// ══════════════════════════════════════════════════════════════════

export async function fetchItemInfos(userId: string): Promise<ItemInfoRow[]> {
  if (!userId) return []

  const result: ItemInfoRow[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('si_item_info')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error('[fetchItemInfos]', error)
      throw error
    }
    const rows = (data ?? []) as ItemInfoRow[]
    result.push(...rows)
    if (rows.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return result
}

// ══════════════════════════════════════════════════════════════════
// upsert — (user_id, barcode) 충돌 시 update, 없으면 insert
// ══════════════════════════════════════════════════════════════════

/**
 * 변경/신규 행을 일괄 upsert
 * - 1000건 청크 분할 (CLAUDE.md 룰 5)
 * - barcode 가 비어있는 행은 호출 측에서 미리 제외해야 함 (conflict key 필수)
 */
export async function upsertItemInfos(
  rows: ItemInfoUpsert[],
): Promise<{ count: number }> {
  if (rows.length === 0) return { count: 0 }

  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK)
    const { error } = await supabase
      .from('si_item_info')
      .upsert(chunk, { onConflict: 'user_id,barcode' })
    if (error) {
      console.error('[upsertItemInfos]', error)
      throw error
    }
  }
  return { count: rows.length }
}
