/* ================================================================
   라벨 정보 규칙 — 키즈 판정 · 사이즈 → 권장연령 · 출력 조건 (DB 없음, 2026-11-26)

   ── 키즈 판정 ──
     쿠팡 고시정보 분류가 '어린이제품' 이거나, 권장연령이 입력된 상품.
     · '어린이제품' 은 쿠팡에 어린이제품으로 등록해야 붙는 분류다 (이 분류에만 사용연령 · KC 인증정보 항목이 있다).
       sulon 29,688행 대조(2026-11-26): 이 분류인데 상품명이 여성·남성인 행 0, 한 상품 안에서 분류가 섞인 경우 0.
     · 상품명(아동·여아…)으로는 가르지 않는다 — "공용"·"가족" 처럼 시작하는 키즈 상품, "부츠컷" 처럼 낱말로 품목을
       가르면 틀리는 경우가 있다.
     · 분류가 어린이제품이 아니어도 권장연령을 직접 넣으면 키즈 양식으로 나간다 (쿠팡에 '의류' 로 등록된 아동복).

   ── 권장연령 (아이엠몽 로켓 compAge.js 와 같은 표) ──
     옵션명에 숫자 사이즈가 정확히 하나 있고 표에 있을 때만. 범위("120~130")는 큰 숫자, cm 는 허용, mm(신발)는 제외.
     표에 없는 숫자(110 · 170 …)는 정하지 않는다 — 추측해서 넣지 않는다.

   ── 출력 조건 ──
     성인: 혼용률  /  키즈: 혼용률 + 권장연령.  하나라도 없으면 라벨을 찍지 않는다.
     혼용률 = 상품정보 화면 직접 입력값(si_item_info) 우선, 없으면 쿠팡 고시정보 값. 안내 문구("상세페이지 참조")는 없는 값.
   ================================================================ */

import { isRealComposition } from './coupangNotices'
import type { LabelAudience } from '../utils/label/labelTypes'

// ── 상수 ──────────────────────────────────────────────────────────
/** 쿠팡 고시정보 분류 — 어린이제품 */
export const KIDS_NOTICE_CATEGORY = '어린이제품'

/** 사이즈(큰 쪽 숫자) → 권장연령 */
export const AGE_BY_SIZE: Readonly<Record<number, string>> = {
  120: '5-7세',
  130: '7-9세',
  140: '9-11세',
  150: '11-12세',
  160: '12-14세',
}

/** 옵션명의 한 조각이 숫자 사이즈인지 — "130" · "120~130" · "120-130" · "130cm" · "170mm" */
const SIZE_TOKEN = /^(\d{2,3})(?:[~-](\d{2,3}))?(cm|mm)?$/i

// ══════════════════════════════════════════════════════════════════
// 키즈 판정 · 권장연령
// ══════════════════════════════════════════════════════════════════

export function isKidsCategory(noticeCategory: string | null | undefined): boolean {
  return (noticeCategory ?? '').trim() === KIDS_NOTICE_CATEGORY
}

/** 옵션명 → 권장연령. 숫자 사이즈가 없거나 둘 이상이거나, mm 단위거나, 표에 없으면 null */
export function ageFromOptionName(optionName: string | null | undefined): string | null {
  const hits = (optionName ?? '')
    .trim()
    .split(/\s+/)
    .map((token) => SIZE_TOKEN.exec(token))
    .filter((m): m is RegExpExecArray => m !== null)
  if (hits.length !== 1) return null
  const [, from, to, unit] = hits[0]
  if (unit?.toLowerCase() === 'mm') return null
  return AGE_BY_SIZE[Number(to ?? from)] ?? null
}

// ══════════════════════════════════════════════════════════════════
// 출력 조건
// ══════════════════════════════════════════════════════════════════

/** 그 대상의 라벨에 필요한데 빠진 값의 이름 (다 있으면 빈 배열) */
export function missingLabelFields(audience: LabelAudience, composition: string, recommendedAge: string): string[] {
  const missing: string[] = []
  if (!isRealComposition(composition)) missing.push('혼용률')
  if (audience === 'kids' && !recommendedAge.trim()) missing.push('권장연령')
  return missing
}

/** 대상과 값으로 출력을 막는 사유 (없으면 null) */
export function labelBlockReason(audience: LabelAudience, composition: string, recommendedAge: string): string | null {
  const missing = missingLabelFields(audience, composition, recommendedAge)
  if (missing.length === 0) return null
  return `${audience === 'kids' ? '키즈' : '성인'} 라벨에 필요한 ${missing.join(' · ')} 값이 없습니다`
}

/** 라벨 정보의 원천 값 */
export interface LabelInfoSource {
  /** 쿠팡 고시정보 분류 (si_coupang_items.notices 첫 항목의 category) */
  noticeCategory?: string | null
  /** 쿠팡 고시정보 혼용률 (si_coupang_items.composition) */
  coupangComposition?: string | null
  /** 직접 입력 혼용률 (si_item_info.composition) */
  manualComposition?: string | null
  /** 권장연령 (si_item_info.recommended_age) */
  recommendedAge?: string | null
}

export interface ResolvedLabelInfo {
  audience: LabelAudience
  /** 라벨에 찍힐 혼용률 (없으면 '') */
  composition: string
  /** 라벨에 찍힐 권장연령 (없으면 '') */
  recommendedAge: string
  /** 빠진 값의 이름 (다 있으면 빈 배열) */
  missing: string[]
  /** 출력할 수 없는 사유 (출력할 수 있으면 null) */
  blockReason: string | null
}

/** 원천 값 → 대상 · 라벨 값 · 출력 가능 여부 (목록의 🖨 잠금 · 라벨 탭 · 인쇄 직전 확인이 같이 쓴다) */
export function resolveLabelInfo(src: LabelInfoSource): ResolvedLabelInfo {
  const recommendedAge = (src.recommendedAge ?? '').trim()
  const composition = isRealComposition(src.manualComposition)
    ? src.manualComposition!.trim()
    : isRealComposition(src.coupangComposition)
      ? src.coupangComposition!.trim()
      : ''
  const audience: LabelAudience = isKidsCategory(src.noticeCategory) || recommendedAge ? 'kids' : 'adult'
  return {
    audience,
    composition,
    recommendedAge,
    missing: missingLabelFields(audience, composition, recommendedAge),
    blockReason: labelBlockReason(audience, composition, recommendedAge),
  }
}
