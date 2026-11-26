/* ================================================================
   권장연령 자동 입력 — 키즈 상품의 빈 권장연령을 사이즈로 채운다 (2026-11-26)
   - 규칙은 services/labelInfoRules.ts (쿠팡 고시정보 '어린이제품' + 옵션명 숫자 사이즈 → 표)
   - 저장은 si_item_info.recommended_age (바코드 기준). **빈칸만** 채운다 — 직접 넣은 값은 건드리지 않는다
   - 부르는 곳: 상품 상세를 받은 직후(coupangProductService.syncProductDetails — 새 상품 · [상세 받기] · 이 상품 다시 받기).
     itemIds 를 생략하면 계정 전체 (처음 한 번 채울 때)
   - 라벨은 바코드가 있는 옵션만 찍으므로 바코드 있는 행만 본다
   ================================================================ */

import { supabase } from './supabase'
import { fetchItemInfosByBarcodes } from './itemInfoService'
import { ageFromOptionName, isKidsCategory } from './labelInfoRules'

// ── 상수 ──────────────────────────────────────────────────────────
const PAGE_ROWS = 1000        // Supabase 한 요청 최대 행
const IN_CHUNK = 100          // in() 한 번에 보낼 ID 수 (URL 길이 보호)
const INSERT_BATCH = 500

/** 고시정보 JSON 전체가 아니라 첫 항목의 분류만 읽는다 (옵션당 ~1KB JSON 을 받지 않게) */
const KIDS_SCAN_COLUMNS = 'barcode, option_name, notice_category:notices->0->>category'

interface KidsScanRow {
  barcode: string | null
  option_name: string | null
  notice_category: string | null
}

export interface AgeFillResult {
  /** 사이즈로 권장연령을 정한 바코드 수 (이미 값이 있는 것 포함) */
  resolved: number
  /** 이번에 채운 수 — 기존 상품정보 행의 빈칸 */
  filled: number
  /** 이번에 채운 수 — 상품정보에 행이 없어 새로 만든 것 */
  created: number
  /** 같은 바코드의 옵션들이 서로 다른 권장연령이 되어 건너뛴 바코드 수 */
  conflicts: number
}

function chunk<T>(arr: readonly T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// ══════════════════════════════════════════════════════════════════
// 조회 — 바코드가 있는 옵션의 (바코드 · 옵션명 · 고시 분류)
//   항상 등록상품 ID 묶음(in)으로 읽는다 — (user_id, item_id) 인덱스로 그 상품의 행만 읽고 끝난다.
//   계정 전체를 "바코드 있는 행 · 분류 = 어린이제품" 조건으로 한 번에 훑으면, 행이 굵고(고시정보 JSON) 조건이
//   인덱스 밖이라 페이지마다 수 초가 걸리다 statement timeout 이 난다 (2026-11-26 실측).
//   분류는 받은 뒤 여기서 거른다.
// ══════════════════════════════════════════════════════════════════

/** 계정의 등록상품 ID 전부 (인덱스 순서 그대로 — item_id 만 읽는다) */
async function fetchAllItemIds(userId: string): Promise<string[]> {
  const ids = new Set<string>()
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await supabase
      .from('si_coupang_items')
      .select('item_id')
      .eq('user_id', userId)
      .not('item_id', 'is', null)
      .order('item_id', { ascending: false })
      .order('option_id', { ascending: true })
      .range(from, from + PAGE_ROWS - 1)
    if (error) {
      console.error('[fillRecommendedAges] 상품 ID 조회 오류:', error)
      throw error
    }
    for (const r of (data ?? []) as { item_id: string | null }[]) if (r.item_id) ids.add(r.item_id)
    if (!data || data.length < PAGE_ROWS) break
  }
  return [...ids]
}

async function fetchBarcodedRows(userId: string, itemIds: string[]): Promise<KidsScanRow[]> {
  const rows: KidsScanRow[] = []
  for (const scope of chunk(itemIds, IN_CHUNK)) {
    for (let from = 0; ; from += PAGE_ROWS) {
      const { data, error } = await supabase
        .from('si_coupang_items')
        .select(KIDS_SCAN_COLUMNS)
        .eq('user_id', userId)
        .in('item_id', scope)
        .not('barcode', 'is', null)
        .order('option_id')
        .range(from, from + PAGE_ROWS - 1)
      if (error) {
        console.error('[fillRecommendedAges] 옵션 조회 오류:', error)
        throw error
      }
      rows.push(...((data ?? []) as unknown as KidsScanRow[]))
      if (!data || data.length < PAGE_ROWS) break
    }
  }
  return rows
}

// ══════════════════════════════════════════════════════════════════
// 채우기
// ══════════════════════════════════════════════════════════════════

/**
 * 키즈 상품의 빈 권장연령을 사이즈로 채운다.
 * @param itemIds 등록상품 ID 범위 (생략하면 계정 전체)
 */
export async function fillRecommendedAges(userId: string, itemIds?: string[]): Promise<AgeFillResult> {
  const result: AgeFillResult = { resolved: 0, filled: 0, created: 0, conflicts: 0 }
  if (!userId || (itemIds && itemIds.length === 0)) return result

  // ── ① 바코드 → 권장연령 (같은 바코드가 다른 연령이면 정하지 않는다) ──
  const ageByBarcode = new Map<string, string | null>()
  const scope = itemIds ?? await fetchAllItemIds(userId)
  for (const row of await fetchBarcodedRows(userId, scope)) {
    const barcode = (row.barcode ?? '').trim()
    if (!barcode || !isKidsCategory(row.notice_category)) continue
    const age = ageFromOptionName(row.option_name)
    if (!age) continue
    const prev = ageByBarcode.get(barcode)
    if (prev === undefined) ageByBarcode.set(barcode, age)
    else if (prev !== age) ageByBarcode.set(barcode, null)
  }
  const targets = new Map<string, string>()
  for (const [barcode, age] of ageByBarcode) {
    if (age) targets.set(barcode, age)
    else result.conflicts++
  }
  result.resolved = targets.size
  if (targets.size === 0) return result

  // ── ② 상품정보(si_item_info)의 지금 값 ──
  const infos = await fetchItemInfosByBarcodes(userId, [...targets.keys()])

  // ── ③ 기존 행 — 빈칸인 것만, 저장 순간에도 빈칸일 때만 (그사이 직접 넣은 값을 덮지 않는다) ──
  const idsByAge = new Map<string, string[]>()
  const toCreate: { user_id: string; barcode: string; recommended_age: string }[] = []
  for (const [barcode, age] of targets) {
    const info = infos.get(barcode)
    if (!info) { toCreate.push({ user_id: userId, barcode, recommended_age: age }); continue }
    if ((info.recommended_age ?? '').trim()) continue
    const ids = idsByAge.get(age) ?? []
    ids.push(info.id)
    idsByAge.set(age, ids)
  }
  for (const [age, ids] of idsByAge) {
    for (const part of chunk(ids, IN_CHUNK)) {
      const { data, error } = await supabase
        .from('si_item_info')
        .update({ recommended_age: age })
        .eq('user_id', userId)
        .in('id', part)
        .or('recommended_age.is.null,recommended_age.eq.')
        .select('id')
      if (error) {
        console.error('[fillRecommendedAges] 저장 오류:', error)
        throw error
      }
      result.filled += data?.length ?? 0
    }
  }

  // ── ④ 행이 없는 바코드 — 새로 만든다 (그사이 생긴 행은 건드리지 않는다) ──
  for (const batch of chunk(toCreate, INSERT_BATCH)) {
    const { data, error } = await supabase
      .from('si_item_info')
      .upsert(batch, { onConflict: 'user_id,barcode', ignoreDuplicates: true, defaultToNull: false })
      .select('id')
    if (error) {
      console.error('[fillRecommendedAges] 새 행 저장 오류:', error)
      throw error
    }
    result.created += data?.length ?? 0
  }

  console.log(`[fillRecommendedAges] 대상 ${result.resolved} · 채움 ${result.filled} · 새 행 ${result.created} · 충돌 ${result.conflicts}`)
  return result
}
