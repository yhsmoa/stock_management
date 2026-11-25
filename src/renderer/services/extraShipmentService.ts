// ═══════════════════════════════════════════════════════════════════
// extraShipmentService — 개인주문 '추가발송' (순수 규칙, DB 는 saveOrderRowPatches)
//   출고준비에서 수량이 모자란 줄(추가★): 배정된 수량은 그날 출고하고(쿠팡 송장 등록 —
//   쿠팡은 줄의 수량을 나눠 받지 않으므로 줄 전체가 배송지시로 넘어간다),
//   남은 수량은 coupang_personal_orders.extra_ship_qty 에 적어 두었다가
//   다음에 물건이 들어오면 더 보낸다. 쿠팡에는 없는 값 — 이 앱만의 기록이다.
//
//   상태 두 가지 (extra_ship_qty > 0 인 줄)
//     · 예정 — 아직 송장 전(결제완료 · 상품준비중). 출고엑셀을 받을 때마다 다시 계산해 덮는다.
//              출고준비에서는 주문 수량 전체가 배정 대상이다.
//     · 진행 — 송장이 나간 뒤(배송지시 ~). 배정분은 이미 출고됐고 남은 수량만 배정 대상이다.
//              쿠팡 상태와 무관하게 상품준비중 탭에 계속 보인다 (isExtraShipPending).
//   기록 시점: [출고엑셀] 을 받을 때 자동 (planExtraShipPatches)
//   해제: 사람이 [추가발송 N] 표시를 눌러서만. 다 채워져도 자동으로 풀지 않는다
//         (실제로 보낸 뒤 확인하고 지우도록). 일부만 채워지면 남은 수량으로 줄인다.
// ═══════════════════════════════════════════════════════════════════

import type { OrderRowPatch, PersonalOrderRow } from './personalOrderService'
import type { OutboundAlloc } from './outboundPrepService'

// ── 상수 ──────────────────────────────────────────────────────────
/** 화면 표시 이름 */
export const EXTRA_SHIP_LABEL = '추가발송'
/** 출고엑셀 등록상품명 맨 앞 — 이미 송장이 나간 주문의 남은 수량을 보내는 행 */
export const EXTRA_SHIP_EXCEL_PREFIX = '[추가출고건]'
/** 송장 전 상태 — 이 상태의 줄은 주문 수량 전체가 아직 출고 대상이다 */
const PRE_INVOICE_STATUSES: ReadonlySet<string> = new Set(['ACCEPT', 'INSTRUCT'])
/** 진행 중인 추가발송 줄을 보여 줄 탭의 상태 코드 (상품준비중) */
export const EXTRA_SHIP_TAB_STATUS = 'INSTRUCT'

type ExtraShipRow = Pick<PersonalOrderRow, 'status' | 'canceled' | 'extra_ship_qty'>

// ── 판정 ──────────────────────────────────────────────────────────

/** 송장 전(결제완료 · 상품준비중) 줄인지 */
export const isPreInvoiceStatus = (status: string) => PRE_INVOICE_STATUSES.has(status)

/** 추가발송 남은 수량 (없으면 0) */
export const extraShipQtyOf = (row: Pick<PersonalOrderRow, 'extra_ship_qty'>): number => {
  const qty = row.extra_ship_qty ?? 0
  return Number.isInteger(qty) && qty > 0 ? qty : 0
}

/** 진행 중인 추가발송 — 배정분은 이미 송장이 나갔고 남은 수량만 보내면 되는 줄 */
export const isExtraShipPending = (row: ExtraShipRow): boolean =>
  !row.canceled && extraShipQtyOf(row) > 0 && !isPreInvoiceStatus(row.status)

// ── 기록 계획 ─────────────────────────────────────────────────────

export interface ExtraShipPlanInput {
  rows: readonly PersonalOrderRow[]
  /** 화면 행 키 */
  rowKeyOf: (row: PersonalOrderRow) => string
  /** 이번 출고준비 배정 결과 (행 키 → 배정) */
  allocMap: ReadonlyMap<string, OutboundAlloc>
  /** 이번 출고준비에서 배정 대상이었던 행 키 — 대상이 아니었던 줄은 건드리지 않는다 */
  demandKeys: ReadonlySet<string>
}

/**
 * 출고준비 배정 결과 → extra_ship_qty 를 고칠 줄.
 *   - 송장 전 줄(예정): 모자란 수량으로 덮는다. 다 채워졌거나 하나도 배정되지 않았으면(출고엑셀에
 *     없는 줄 — 이번에 보내지 않는다) 비운다.
 *   - 진행 중인 추가발송 줄: 일부만 채워졌으면 남은 수량으로 줄인다. 다 채워졌거나 배정이 없으면 그대로
 *     (해제는 사람이 한다).
 * 같은 배정 결과로 여러 번 불러도 결과가 같다 (엑셀을 다시 받아도 수량이 또 줄지 않는다).
 */
export function planExtraShipPatches(input: ExtraShipPlanInput): OrderRowPatch[] {
  const { rows, rowKeyOf, allocMap, demandKeys } = input
  const patches: OrderRowPatch[] = []

  for (const row of rows) {
    const key = rowKeyOf(row)
    if (!demandKeys.has(key) || row.canceled) continue
    const alloc = allocMap.get(key)
    const current = extraShipQtyOf(row)

    let next: number | null
    if (isExtraShipPending(row)) {
      if (!alloc || alloc.shortageQty <= 0) continue
      next = alloc.shortageQty
    } else if (isPreInvoiceStatus(row.status)) {
      next = alloc && alloc.shortageQty > 0 ? alloc.shortageQty : null
    } else {
      continue
    }

    if ((next ?? 0) === current) continue
    patches.push({
      shipmentBoxId: row.shipment_box_id,
      vendorItemId: row.vendor_item_id,
      patch: { extra_ship_qty: next },
    })
  }
  return patches
}

/** 추가발송 해제 patch (사람이 표시를 눌렀을 때) */
export const releaseExtraShipPatch = (
  row: Pick<PersonalOrderRow, 'shipment_box_id' | 'vendor_item_id'>,
): OrderRowPatch => ({
  shipmentBoxId: row.shipment_box_id,
  vendorItemId: row.vendor_item_id,
  patch: { extra_ship_qty: null },
})
