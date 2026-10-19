/* ================================================================
   상품관리 화면 공용 포맷 헬퍼
   ================================================================ */

/** 12,900원 */
export function won(n: number | null | undefined): string {
  return n == null ? '—' : `${n.toLocaleString('ko-KR')}원`
}

/** 12,900 */
export function num(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString('ko-KR')
}

/** ISO 시각 → "방금 · 3분 전 · 2시간 전 · 어제 · 3일 전 · 10/02" */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const diff = Math.max(0, now - t)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  const day = Math.floor(hr / 24)
  if (day === 1) return '어제'
  if (day < 7) return `${day}일 전`
  const d = new Date(t)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

/** ISO 시각 → "10/20 09:12" */
export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 쿠팡 호출 수 → 대략 걸리는 시간 (초당 5회) */
export function estimateDuration(calls: number): string {
  const sec = Math.ceil(calls / 5)
  if (sec < 60) return `약 ${sec}초`
  const min = Math.round(sec / 60)
  if (min < 60) return `약 ${min}분`
  const hr = Math.floor(min / 60)
  const rest = min % 60
  return rest ? `약 ${hr}시간 ${rest}분` : `약 ${hr}시간`
}

/** 배송비 종류 코드 → 한글 */
export function deliveryChargeLabel(type: string | null | undefined, charge: number | null | undefined, freeOver: number | null | undefined): string {
  switch (type) {
    case 'FREE': return '무료배송'
    case 'NOT_FREE': return `유료배송 ${num(charge)}원`
    case 'CHARGE_RECEIVED': return '착불'
    case 'CONDITIONAL_FREE': return `조건부 무료 (${num(freeOver)}원 이상)`
    default: return '—'
  }
}
