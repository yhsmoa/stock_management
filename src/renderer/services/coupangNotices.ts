/* ================================================================
   상품관리 — 고시정보 · 혼용률 (순수 함수)
   - 쿠팡 상품 조회 API items[].notices[] → 저장용 모양 (CoupangNotice[])
   - 혼용률 = 고시정보 중 소재 항목의 값. 분류마다 항목명이 다르다
     (실측 2026-10-20: 의류 → "제품 소재", 패션잡화 → "소재")
   - "상세페이지 참조" 처럼 값이 아니라 안내 문구인 경우는 혼용률로 쓰지 않는다 (라벨에 그 글자가 찍히면 안 됨)
   ================================================================ */

import type { ApiDetailNotice, CoupangNotice } from '../types/coupangProduct'

/** 혼용률로 보는 고시정보 항목명 — 앞에 있는 것이 우선 */
const COMPOSITION_NOTICE_NAMES = ['제품 소재', '제품소재', '소재']

/**
 * 값이 아니라 "다른 곳을 보라" 는 안내 문구 — 공백을 뺀 뒤 이 글자를 포함하면 혼용률 없음으로 본다.
 * (실측 값: "상세페이지 참조". 판매자마다 "상세 설명 참조" · "상품상세 참조" 등으로 쓴다)
 */
const PLACEHOLDER_PATTERNS = ['상세페이지참조', '상세설명참조', '상세페이지참고', '상품상세참조', '상세정보참조', '상세참조', '별도표기', '해당없음']

/** 혼용률 항목인지 (상세 패널에서 강조할 때) */
export function isCompositionNoticeName(name: string): boolean {
  return COMPOSITION_NOTICE_NAMES.includes(name.trim())
}

/** 쿠팡 notices[] → 저장용 (빈 칸 · 이름 없는 칸은 버린다). 응답에 notices 가 없으면 [] */
export function toCoupangNotices(notices: ApiDetailNotice[] | null | undefined): CoupangNotice[] {
  if (!Array.isArray(notices)) return []
  const out: CoupangNotice[] = []
  for (const n of notices) {
    const name = (n?.noticeCategoryDetailName ?? '').trim()
    if (!name) continue
    out.push({
      category: (n?.noticeCategoryName ?? '').trim(),
      name,
      content: (n?.content ?? '').trim(),
    })
  }
  return out
}

/** 혼용률 값이 실제 값인지 (안내 문구 · 빈 값이면 false) */
export function isRealComposition(value: string | null | undefined): boolean {
  const compact = (value ?? '').replace(/\s+/g, '')
  if (!compact) return false
  return !PLACEHOLDER_PATTERNS.some((p) => compact.includes(p))
}

/** 고시정보에서 혼용률 — 없거나 안내 문구뿐이면 null */
export function extractComposition(notices: CoupangNotice[]): string | null {
  for (const wanted of COMPOSITION_NOTICE_NAMES) {
    const hit = notices.find((n) => n.name === wanted)
    if (hit) return isRealComposition(hit.content) ? hit.content : null
  }
  return null
}
