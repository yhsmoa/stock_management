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
// 조회 — 바코드 목록의 행만 (라벨 출력 때 직접 입력 혼용률을 덮어쓰기용)
//   바코드를 IN_CHUNK 개씩 in() 조회 (URL 길이), 각 묶음도 1000-row 루프
// ══════════════════════════════════════════════════════════════════

const IN_CHUNK = 100

export async function fetchItemInfosByBarcodes(userId: string, barcodes: string[]): Promise<Map<string, ItemInfoRow>> {
  const map = new Map<string, ItemInfoRow>()
  const unique = Array.from(new Set(barcodes.map((b) => b.trim()).filter(Boolean)))
  if (!userId || unique.length === 0) return map

  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const chunk = unique.slice(i, i + IN_CHUNK)
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('si_item_info')
        .select('*')
        .eq('user_id', userId)
        .in('barcode', chunk)
        .range(from, from + PAGE_SIZE - 1)
      if (error) {
        console.error('[fetchItemInfosByBarcodes]', error)
        throw error
      }
      const rows = (data ?? []) as ItemInfoRow[]
      for (const r of rows) if (r.barcode) map.set(r.barcode, r)
      if (rows.length < PAGE_SIZE) break
    }
  }
  return map
}

// ══════════════════════════════════════════════════════════════════
// 저장 — 기존 행은 id 기준, 신규 행은 (user_id, barcode) 기준 upsert
// ══════════════════════════════════════════════════════════════════

/** 한 묶음을 청크(1000건)로 나눠 upsert */
async function upsertChunks(rows: ItemInfoUpsert[], onConflict: string): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK)
    const { error } = await supabase
      .from('si_item_info')
      // defaultToNull:false — 행에 없는 열은 null 이 아니라 DB 기본값(id 등)을 쓴다
      .upsert(chunk, { onConflict, defaultToNull: false })
    if (error) {
      console.error('[upsertItemInfos]', onConflict, error)
      throw error
    }
  }
}

/**
 * 변경/신규 행 일괄 저장
 * - 기존 행(id 있음): id 기준 — 바코드를 바꿔도 같은 행이 고쳐진다
 *   (바꾼 바코드가 다른 행과 겹치면 unique 오류로 막힌다)
 * - 신규 행(id 없음): (user_id, barcode) 기준 — 이미 있는 바코드면 그 행에 덮어쓴다
 * - 둘을 한 요청에 섞으면 신규 행의 id 가 null 로 채워져 실패하므로 나눠 보낸다
 * - barcode 가 비어있는 행은 호출 측에서 미리 제외해야 함
 */
export async function upsertItemInfos(
  rows: ItemInfoUpsert[],
): Promise<{ count: number }> {
  if (rows.length === 0) return { count: 0 }

  const existing = rows.filter((r) => !!r.id)
  const added = rows.filter((r) => !r.id)

  if (existing.length > 0) await upsertChunks(existing, 'id')
  if (added.length > 0) await upsertChunks(added, 'user_id,barcode')
  return { count: rows.length }
}
