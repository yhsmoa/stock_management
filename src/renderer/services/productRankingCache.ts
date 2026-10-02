/* ================================================================
   상품 랭킹 보관 (이 브라우저 localStorage)
   - 홈에 들어올 때마다 수만 행을 다시 받지 않도록, 계산이 끝난 순위표와
     이미지 주소·별점을 보관해 두고 다음 접속 때 그대로 보여 준다.
   - 보관한 지 하루(RANKING_CACHE_TTL_MS)가 지났으면 없는 것으로 친다 → 새로 불러온다.
   - 원천(si_rg_items 등 수만 행)은 localStorage 용량(약 5MB)을 넘으므로 보관하지 않는다.
     보관하는 것은 기준 넷 × 최대 20위의 결과뿐이다.
   - 로그인한 계정이 보관본의 계정과 다르면 쓰지 않는다 (PC 를 같이 쓰는 경우).
   ================================================================ */

import { RANKING_BASES, type ProductRankings, type ProductRating } from './productRankingService'

// ══════════════════════════════════════════════════════════════════
// 타입 · 상수
// ══════════════════════════════════════════════════════════════════

/** 보관 모양이 바뀌면 끝의 버전을 올린다 — 예전 보관본은 자동으로 무시된다 */
const CACHE_STORAGE_KEY = 'home_ranking_cache_v1'

/** 보관본 유효 시간 — 하루 */
const RANKING_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export interface ProductRankingSnapshot {
  userId: string
  /** 순위를 계산한 시각 (epoch ms) — 화면의 '○○ 기준' 표시와 만료 판정에 쓴다 */
  savedAt: number
  rankings: ProductRankings
  /** 상품 ID → 이미지 주소 (null = 찾아봤지만 없음) */
  imageUrls: Record<string, string | null>
  /** 상품 ID → 쿠팡 별점 (null = 찾아봤지만 없음). 별점이 생기기 전에 만든 보관본에는 없다 — 없으면 새로 찾는다 */
  ratings?: Record<string, ProductRating | null>
}

// ══════════════════════════════════════════════════════════════════
// 읽기 · 쓰기
// ══════════════════════════════════════════════════════════════════

// ── 모양 확인 — 손상됐거나 예전 모양이면 쓰지 않는다 ────────────────
const isSnapshot = (value: unknown): value is ProductRankingSnapshot => {
  if (!value || typeof value !== 'object') return false
  const s = value as Partial<ProductRankingSnapshot>
  return (
    typeof s.userId === 'string' &&
    typeof s.savedAt === 'number' &&
    !!s.rankings && RANKING_BASES.every((b) => Array.isArray(s.rankings?.[b.key])) &&
    !!s.imageUrls && typeof s.imageUrls === 'object'
  )
}

/**
 * 이 계정의 유효한 보관본을 돌려준다. 없음·다른 계정·하루 경과·손상이면 null.
 * 보관 시각이 지금보다 미래인 경우(PC 시계를 되돌린 경우)도 믿지 않는다.
 */
export function readRankingSnapshot(userId: string): ProductRankingSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isSnapshot(parsed) || parsed.userId !== userId) return null

    const age = Date.now() - parsed.savedAt
    if (age < 0 || age >= RANKING_CACHE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

/** 보관한다. 저장소를 못 쓰면(용량 초과·차단) 보관만 안 될 뿐 화면은 그대로 동작한다. */
export function writeRankingSnapshot(snapshot: ProductRankingSnapshot): void {
  try {
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(snapshot))
  } catch (e) {
    console.warn('[상품 랭킹] 보관 실패:', e)
  }
}
