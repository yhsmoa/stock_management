/* ================================================================
   홈 화면 상품 랭킹 훅
   - 순위표(기준 넷 × 최대 20위)와 이미지 주소는 이 브라우저에 보관해 두고,
     보관본이 유효하면(같은 계정 · 하루 이내) 조회 없이 바로 보여 준다.
   - 보관본이 없거나 하루가 지났으면, 또는 [새로고침] 을 누르면 원천을 새로 받아 다시 매긴다.
   - 기준(개인/기간/7일/30일)을 바꿀 때는 이미 매겨 둔 순위표를 고르기만 한다.
   - 상품 이미지는 화면에 보이는 순위의 상품 것만 뒤이어 받는다.
   ================================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildAllProductRankings,
  fetchProductImageUrls,
  loadProductRankingSource,
  RANKING_BASES,
  RANKING_SIZE,
  type ProductRankings,
  type RankingBasis,
} from '../services/productRankingService'
import { readRankingSnapshot, writeRankingSnapshot } from '../services/productRankingCache'

// ── 기준 기억 (이 브라우저) ────────────────────────────────────
//   계정과 무관한 화면 취향이라 사용자 구분 없이 둔다 (사입관리의 페이지 크기 기억과 같은 성격).
const BASIS_STORAGE_KEY = 'home_ranking_basis'
const DEFAULT_BASIS: RankingBasis = 'd7'

const readBasis = (): RankingBasis => {
  try {
    const saved = localStorage.getItem(BASIS_STORAGE_KEY)
    return RANKING_BASES.some((b) => b.key === saved) ? (saved as RankingBasis) : DEFAULT_BASIS
  } catch {
    return DEFAULT_BASIS
  }
}

// ── 사용자 ID 조회 ────────────────────────────────────────────
const getUserId = (): string | null => {
  const userStr = localStorage.getItem('user')
  if (!userStr) return null
  try {
    return JSON.parse(userStr)?.id ?? null
  } catch {
    return null
  }
}

export function useProductRanking() {
  // ── 보관본 (화면이 열릴 때 한 번만 읽는다) ───────────────────
  const [snapshot] = useState(() => {
    const userId = getUserId()
    return userId ? readRankingSnapshot(userId) : null
  })

  const [rankings, setRankings] = useState<ProductRankings | null>(snapshot?.rankings ?? null)
  /** 순위를 계산한 시각 (epoch ms) — 보관본에서 왔으면 그때의 시각 */
  const [savedAt, setSavedAt] = useState<number | null>(snapshot?.savedAt ?? null)
  const [loading, setLoading] = useState(!snapshot)
  const [error, setError] = useState<string | null>(null)
  const [basis, setBasisRaw] = useState<RankingBasis>(readBasis)

  const setBasis = useCallback((next: RankingBasis) => {
    setBasisRaw(next)
    try {
      localStorage.setItem(BASIS_STORAGE_KEY, next)
    } catch {
      // 저장소를 못 쓰면 기억만 안 될 뿐이다
    }
  }, [])

  // ── 상품 이미지 상태 ────────────────────────────────────────
  //   null 은 '찾아봤지만 없음'. 한 번 요청한 상품은 기억해 두어 기준을 바꿔도 다시 조회하지 않는다.
  const [imageUrls, setImageUrls] = useState<Record<string, string | null>>(snapshot?.imageUrls ?? {})
  const requestedImageIds = useRef(new Set<string>(Object.keys(snapshot?.imageUrls ?? {})))

  // ── 원천 로드 → 순위 계산 ───────────────────────────────────
  //   화면을 떠난 뒤 늦게 도착한 응답이 상태를 건드리지 않도록 취소 표시를 둔다.
  const load = useCallback(() => {
    const userId = getUserId()
    if (!userId) {
      setError('사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.')
      setLoading(false)
      return () => {}
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    loadProductRankingSource(userId)
      .then((source) => {
        if (cancelled) return
        // 새로 불러올 때는 이미지도 다시 찾는다 (그동안은 예전 이미지를 그대로 보여 준다)
        requestedImageIds.current.clear()
        setRankings(buildAllProductRankings(source))
        setSavedAt(Date.now())
      })
      .catch((e) => {
        console.error('[상품 랭킹] 로드 실패:', e)
        if (!cancelled) setError('상품 랭킹을 불러오지 못했습니다.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // 유효한 보관본이 있으면 조회하지 않는다
  useEffect(() => {
    if (snapshot) return
    return load()
  }, [snapshot, load])

  // ── 순위 · [더보기] ─────────────────────────────────────────
  //   펼치기 전에는 앞의 RANKING_SIZE 개만 내보낸다.
  const [expanded, setExpanded] = useState(false)

  const allRows = useMemo(() => rankings?.[basis] ?? [], [rankings, basis])
  const rows = useMemo(
    () => (expanded ? allRows : allRows.slice(0, RANKING_SIZE)),
    [allRows, expanded],
  )
  /** 접힌 상태에서 더 보여 줄 순위가 남아 있는가 */
  const hasMore = !expanded && allRows.length > RANKING_SIZE
  const showMore = useCallback(() => setExpanded(true), [])

  // ── 상품 이미지 조회 ────────────────────────────────────────
  //   순위가 정해진 뒤에 따로 받는다 (이미지를 기다리느라 순위가 늦게 뜨지 않게).
  //   결과는 상품 ID 로 묶여 있어, 조회 도중 기준이 바뀌어도 버리지 않고 그대로 쓴다.
  useEffect(() => {
    const userId = getUserId()
    const pending = rows.map((r) => r.productId).filter((id) => id && !requestedImageIds.current.has(id))
    if (!userId || pending.length === 0) return

    pending.forEach((id) => requestedImageIds.current.add(id))
    fetchProductImageUrls(userId, pending).then((found) => {
      setImageUrls((prev) => {
        const next = { ...prev }
        for (const id of pending) next[id] = found.get(id) ?? null
        return next
      })
    })
  }, [rows])

  // ── 보관 ────────────────────────────────────────────────────
  //   순위가 새로 계산되거나 이미지 주소가 더 모일 때마다 덮어쓴다.
  useEffect(() => {
    const userId = getUserId()
    if (!userId || !rankings || savedAt == null) return
    writeRankingSnapshot({ userId, savedAt, rankings, imageUrls })
  }, [rankings, savedAt, imageUrls])

  return { rows, imageUrls, basis, setBasis, loading, error, reload: load, hasMore, showMore, savedAt }
}
