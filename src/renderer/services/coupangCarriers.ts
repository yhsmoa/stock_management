/* ================================================================
   쿠팡 택배사 코드표 — 송장 업로드(배송지시)용
   - 출처: 쿠팡 개발자센터 "택배사 코드" 페이지 (developers.coupang.com, 2026-11-11 확인)
       코드 · 운송장번호 자릿수 규칙을 그대로 옮겼다. 코드가 바뀌면 이 표만 고친다.
   - 업체직송(DIRECT)은 배송 추적이 없는 NONE_TRACKING 상태가 되므로 [배송준비] 에서 지원하지 않는다.
   - name 은 DB(coupang_personal_orders.delivery_company_name)에 남기는 표시 이름이다.
     다음 [주문 업데이트] 때 쿠팡이 주는 값으로 다시 덮인다.
   ================================================================ */

// ══════════════════════════════════════════════════════════════════
// 타입
// ══════════════════════════════════════════════════════════════════

/** 운송장번호 자릿수 규칙 — 허용 자릿수 목록 또는 범위 */
export type InvoiceLengthRule =
  | { kind: 'set'; lengths: readonly number[] }
  | { kind: 'range'; min: number; max: number }

export interface CoupangCarrier {
  /** 쿠팡 택배사 코드 (deliveryCompanyCode) */
  code: string
  /** 표시 이름 — DB delivery_company_name 형식 */
  name: string
  /** 엑셀 '택배사' 칸에서 받아 줄 다른 이름 (공백·대소문자 무시) */
  aliases: readonly string[]
  invoiceLength: InvoiceLengthRule
}

// ══════════════════════════════════════════════════════════════════
// 지원 택배사 표
// ══════════════════════════════════════════════════════════════════

const lengths = (...values: number[]): InvoiceLengthRule => ({ kind: 'set', lengths: values })
const range = (min: number, max: number): InvoiceLengthRule => ({ kind: 'range', min, max })

export const COUPANG_CARRIERS: readonly CoupangCarrier[] = [
  { code: 'CJGLS',   name: 'CJ 대한통운', aliases: ['CJ대한통운', '대한통운', 'CJ택배', 'CJ'], invoiceLength: lengths(10, 12) },
  { code: 'HANJIN',  name: '한진택배',    aliases: ['한진'],                                            invoiceLength: lengths(10, 12) },
  { code: 'HYUNDAI', name: '롯데택배',    aliases: ['롯데', '롯데글로벌로지스', '현대택배'],              invoiceLength: lengths(10, 12, 13) },
  { code: 'EPOST',   name: '우체국택배',  aliases: ['우체국'],                                          invoiceLength: lengths(13) },
  { code: 'KGB',     name: '로젠택배',    aliases: ['로젠'],                                            invoiceLength: lengths(10, 11) },
  { code: 'KDEXP',   name: '경동택배',    aliases: ['경동'],                                            invoiceLength: range(8, 16) },
  { code: 'CHUNIL',  name: '천일특송',    aliases: ['천일택배', '천일'],                                 invoiceLength: lengths(11) },
  { code: 'DAESIN',  name: '대신택배',    aliases: ['대신'],                                            invoiceLength: lengths(13) },
  { code: 'ILYANG',  name: '일양택배',    aliases: ['일양로지스', '일양'],                               invoiceLength: range(8, 16) },
  { code: 'HDEXP',   name: '합동택배',    aliases: ['합동'],                                            invoiceLength: range(8, 16) },
  { code: 'CVS',     name: 'CVS택배',     aliases: ['편의점택배', 'CVSnet'],                             invoiceLength: lengths(10, 12) },
]

/** 안내 문구용 — 지원 택배사 이름 나열 */
export const SUPPORTED_CARRIER_NAMES = COUPANG_CARRIERS.map((c) => c.name).join(', ')

// ══════════════════════════════════════════════════════════════════
// 엑셀 값 → 택배사
// ══════════════════════════════════════════════════════════════════

/** 비교용 정규화 — 모든 공백 제거 + 소문자 */
function normalizeCarrierText(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}

/** 정규화한 이름·코드·별칭 → 택배사 (모듈 로드 시 1회 생성) */
const CARRIER_LOOKUP: ReadonlyMap<string, CoupangCarrier> = (() => {
  const map = new Map<string, CoupangCarrier>()
  for (const carrier of COUPANG_CARRIERS) {
    for (const key of [carrier.code, carrier.name, ...carrier.aliases]) {
      map.set(normalizeCarrierText(key), carrier)
    }
  }
  return map
})()

/** 엑셀 '택배사' 칸 값 → 지원 택배사 (모르는 이름이면 null) */
export function resolveCarrier(excelValue: string | null | undefined): CoupangCarrier | null {
  if (excelValue == null) return null
  const key = normalizeCarrierText(String(excelValue))
  if (!key) return null
  return CARRIER_LOOKUP.get(key) ?? null
}

// ══════════════════════════════════════════════════════════════════
// 운송장번호 검사
// ══════════════════════════════════════════════════════════════════

/** 자릿수 규칙 → 안내 문구 ('10 또는 12' / '8~16') */
function describeLengthRule(rule: InvoiceLengthRule): string {
  return rule.kind === 'set' ? rule.lengths.join(' 또는 ') : `${rule.min}~${rule.max}`
}

/**
 * 운송장번호가 택배사 규칙(숫자만 + 자릿수)에 맞는지 검사.
 * @param invoice 공백·하이픈을 이미 제거한 값
 * @returns 맞지 않으면 한국어 사유, 맞으면 null
 */
export function validateInvoiceNumber(carrier: CoupangCarrier, invoice: string): string | null {
  if (!/^\d+$/.test(invoice)) {
    return `${carrier.name} 운송장번호는 숫자로만 입력해야 합니다: "${invoice}"`
  }
  const len = invoice.length
  const rule = carrier.invoiceLength
  const ok = rule.kind === 'set' ? rule.lengths.includes(len) : len >= rule.min && len <= rule.max
  if (ok) return null
  return `${carrier.name} 운송장번호는 ${describeLengthRule(rule)}자리여야 합니다 (현재 ${len}자리)`
}
