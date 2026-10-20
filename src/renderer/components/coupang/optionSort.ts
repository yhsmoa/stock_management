/* ================================================================
   상품관리 — 옵션명 정렬
   - "검정 L", "회색 FREE2", "아이보리 M" 처럼 [색상] [사이즈] 로 된 옵션명을
     색상끼리 모으고, 같은 색상 안에서는 사이즈를 입는 순서(XS → S → M → L → XL → 2XL …)로 놓는다.
   - 낱말(공백·쉼표·슬래시로 나눔)을 앞에서부터 하나씩 비교한다.
     · 두 낱말이 모두 사이즈면 사이즈 순서로
     · 아니면 한국어 자연 정렬(숫자는 크기순: 90 < 100)
   ================================================================ */

// ── 사이즈 순서 ──────────────────────────────────────────────────
//   XXL 과 2XL 은 같은 크기로 본다. FREE·F·프리는 맨 뒤 (FREE2 같은 꼬리 숫자는 같은 순위 안에서 숫자순)
const SIZE_RANK: Record<string, number> = {
  XXXS: 1, '3XS': 1,
  XXS: 2, '2XS': 2,
  XS: 3,
  S: 4,
  M: 5,
  L: 6,
  XL: 7,
  XXL: 8, '2XL': 8,
  XXXL: 9, '3XL': 9,
  XXXXL: 10, '4XL': 10,
  '5XL': 11,
  '6XL': 12,
  FREE: 20, F: 20, '프리': 20,
}

/** 낱말 → 사이즈 순위 (사이즈가 아니면 null). 'FREE2' 처럼 꼬리 숫자가 붙어도 FREE 로 본다 */
function sizeRank(token: string): number | null {
  const t = token.toUpperCase()
  if (t in SIZE_RANK) return SIZE_RANK[t]
  const m = t.match(/^(FREE|프리)\d+$/)
  return m ? SIZE_RANK[m[1]] : null
}

const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' })

function tokens(name: string): string[] {
  return name.trim().split(/[\s,/]+/).filter(Boolean)
}

/** 옵션명 비교 — Array.sort 비교 함수. 이름이 없으면 뒤로 */
export function compareOptionNames(a: string | null | undefined, b: string | null | undefined): number {
  const an = (a ?? '').trim()
  const bn = (b ?? '').trim()
  if (!an || !bn) return an ? -1 : bn ? 1 : 0

  const at = tokens(an)
  const bt = tokens(bn)
  const len = Math.min(at.length, bt.length)
  for (let i = 0; i < len; i++) {
    const ra = sizeRank(at[i])
    const rb = sizeRank(bt[i])
    if (ra != null && rb != null && ra !== rb) return ra - rb
    const c = collator.compare(at[i], bt[i])
    if (c !== 0) return c
  }
  return at.length - bt.length
}
