/* ================================================================
   라벨 서비스(label-service) 연동
   - 라벨 양식 편집·인쇄 엔진은 이 앱에 없다. 별도 서비스(label-service)가
     /print-embed 를 iframe 으로 제공하고, 이 앱은 상품 데이터를 postMessage 로
     보내기만 한다 (서비스는 데이터를 저장하지 않는다).
   - 규약(메시지 형식·필드 이름)은 label-service 저장소 README "호스트 앱 연동".
     여기의 필드 이름은 그쪽 SOURCE_PRODUCT_FIELDS.stock 과 반드시 같아야 한다.
   - 서비스 주소는 VITE_LABEL_SERVICE_URL (Railway 변수 / 로컬 .env).
   ================================================================ */

import type { CoupangItem } from '../pages/CoupangManagement'
import type { AuthUser } from '../types/auth'

/** 이 앱의 출처 식별자 — label-service 의 LabelSource */
export const LABEL_SOURCE = 'stock' as const

// ── 메시지 규약 ────────────────────────────────────────────────────
export const LABEL_MSG_PRINT = 'label-print:print'
export const LABEL_MSG_READY = 'label-print:ready'
export const LABEL_MSG_RESULT = 'label-print:result'

/** 호스트 → 임베드: 항목 1개 */
export interface LabelPrintItem {
  data: Record<string, string | number | null>
  qty: number
  /** 성인/키즈 지정. 없으면 recommanded_age 유무로 서비스가 판정 */
  audience?: 'adult' | 'kids'
}

export interface LabelPrintRequest {
  type: typeof LABEL_MSG_PRINT
  requestId: string
  source: typeof LABEL_SOURCE
  userId: string | null
  labelType: 'barcode' | 'care' | 'both'
  autoPrint: boolean
  items: LabelPrintItem[]
}

/** 임베드 → 호스트: 종류별 인쇄 결과 */
export interface LabelPrintResult {
  type: typeof LABEL_MSG_RESULT
  requestId: string
  labelType: 'barcode' | 'care'
  ok: boolean
  printed: number
  error?: string
}

// ── 서비스 주소 ────────────────────────────────────────────────────

/** 라벨 서비스 주소 (끝 슬래시 제거). 미설정이면 '' */
export function getLabelServiceUrl(): string {
  const raw = (import.meta.env.VITE_LABEL_SERVICE_URL ?? '').trim()
  return raw.replace(/\/+$/, '')
}

/** postMessage origin 검증용 */
export function getLabelServiceOrigin(): string {
  const url = getLabelServiceUrl()
  if (!url) return ''
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

export const labelSettingsUrl = () => `${getLabelServiceUrl()}/label-settings`
export const labelEmbedUrl = () => `${getLabelServiceUrl()}/print-embed`

// ── 로그인 계정 ────────────────────────────────────────────────────

/** 로그인한 si_users.id — 라벨 서비스가 템플릿 선택·계정 정보 바인딩에 쓴다 */
export function getCurrentUserId(): string | null {
  try {
    const raw = localStorage.getItem('user')
    if (!raw) return null
    const u = JSON.parse(raw) as AuthUser
    return u.id ?? null
  } catch {
    return null
  }
}

// ── 데이터 변환 ────────────────────────────────────────────────────

/**
 * si_coupang_items 행 → 라벨 바인딩 데이터.
 * 바코드 없는 행은 라벨을 찍을 수 없으므로 제외한다 (호출 측이 건수를 안내).
 * 키 이름은 label-service SOURCE_PRODUCT_FIELDS.stock 과 동일.
 */
export function toLabelPrintItems(items: CoupangItem[]): { items: LabelPrintItem[]; skipped: number } {
  const out: LabelPrintItem[] = []
  let skipped = 0
  for (const it of items) {
    const barcode = (it.barcode ?? '').trim()
    if (!barcode) {
      skipped++
      continue
    }
    out.push({
      qty: 1,
      data: {
        barcode,
        item_name: it.item_name ?? '',
        option_name: it.option_name ?? '',
        product_name: it.product_name ?? '',
        item_code: it.item_code ?? '',
        option_id: it.option_id ?? '',
        item_id: it.item_id ?? '',
        product_id: it.product_id ?? '',
        price: it.price ?? null,
        regular_price: it.regular_price ?? null,
        stock: it.stock ?? null,
        season: it.season ?? '',
        note: it.note ?? '',
        package_type: it.package_type ?? '',
      },
    })
  }
  return { items: out, skipped }
}

export function buildLabelPrintRequest(items: LabelPrintItem[]): LabelPrintRequest {
  return {
    type: LABEL_MSG_PRINT,
    requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: LABEL_SOURCE,
    userId: getCurrentUserId(),
    labelType: 'both',
    autoPrint: false,
    items,
  }
}
