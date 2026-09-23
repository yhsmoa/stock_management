/* ================================================================
   라벨 출력 — 상품관리 행 → 인쇄 항목 변환 · 로그인 계정
   - 인쇄 자체는 services/labelPrintService.ts (QZ Tray), 템플릿은 labelTemplateService.ts
   - data 의 키는 utils/label/labelTypes.ts 의 SOURCE_PRODUCT_FIELDS.stock
     (라벨 설정 편집기의 필드 드롭다운)과 반드시 같아야 한다 — 바꾸면 양쪽을 같이 고친다.
   ================================================================ */

import type { AuthUser } from '../types/auth'
import type { LabelPrintItem } from './labelPrintService'

// ══════════════════════════════════════════════════════════════════
// 타입 정의
// ══════════════════════════════════════════════════════════════════

/** 라벨에 쓰는 si_coupang_items 컬럼 — 상품관리의 CoupangItem 이 그대로 들어온다 */
export interface LabelSourceItem {
  barcode?: string | null
  item_name?: string | null
  option_name?: string | null
  product_name?: string | null
  item_code?: string | null
  option_id?: string | null
  item_id?: string | null
  product_id?: string | null
  price?: number | null
  regular_price?: number | null
  stock?: number | null
  season?: string | null
  note?: string | null
  package_type?: string | null
}

/** 로그인 계정 — 템플릿 범위("내 것 + 공용")·인쇄 기록에 쓴다 */
export interface LabelAccount {
  id: string
  username: string | null
}

// ══════════════════════════════════════════════════════════════════
// 로그인 계정
// ══════════════════════════════════════════════════════════════════

/** localStorage['user'] 의 si_users 행에서 id·아이디만 꺼낸다 (없으면 null) */
export function getCurrentLabelAccount(): LabelAccount | null {
  try {
    const raw = localStorage.getItem('user')
    if (!raw) return null
    const u = JSON.parse(raw) as AuthUser
    return u.id ? { id: u.id, username: u.username ?? null } : null
  } catch {
    return null
  }
}

// ══════════════════════════════════════════════════════════════════
// 데이터 변환
// ══════════════════════════════════════════════════════════════════

/**
 * si_coupang_items 행 → 인쇄 항목 (1장씩).
 * 바코드 없는 행은 라벨을 찍을 수 없으므로 제외한다 (호출 측이 건수를 안내).
 */
export function toLabelPrintItems(items: LabelSourceItem[]): { items: LabelPrintItem[]; skipped: number } {
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
