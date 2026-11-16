// ═══════════════════════════════════════════════════════════════════
// outboundPrepService — 개인주문 [출고준비] 배정 (순수 함수, DB 없음)
//   - 주문(바코드 · 수량)에 ① 쉽먼트 입고분 → ② 재고(si_stocks) 순서로 배정한다
//     · 단계마다 주문 전체를 주문일 오름차순(선착순)으로 한 번씩 돈다 —
//       쉽먼트를 모든 주문에 먼저 나눠 준 뒤 남은 수량에만 재고를 쓴다
//     · 한 주문에 여러 박스 · 여러 위치를 나눠 쓸 수 있고, 모자라면 '추가★'
//   - 재고 방식 (OutboundStockMode)
//     · all            : 남은 수량 전부에 재고를 쓴다
//     · uncoveredOnly  : 중국 주문으로 채워지지 않는 수량(uncoveredUnits)까지만 —
//                        미주문 · 전량취소 · 일부 취소분. 주문이 진행 중인 수량은
//                        다음 입고 때 들어오므로 재고를 쓰지 않는다
//   - 표시 (OutboundAlloc)
//     · displayStr : 'SHHI261107 [HI-P-01 - 1] 재고 [A-01 - 1]' — 화면 전용, 출처별 묶음
//     · boxStr     : '[HI-P-01 - 1, 재고 A-01 - 1]' — 출고엑셀 등록상품명 접두.
//                    쉽먼트 박스 부분은 예전 형식 그대로, 재고 위치는 '재고 ' 를 붙여 구분한다
// ═══════════════════════════════════════════════════════════════════

import type { ShipmentDetailRow } from './orderFulfillmentService'
import type { Stock } from '../types/stock'

// ── 상수 ──────────────────────────────────────────────────────────
/** 배정이 모자란 주문 표시 — boxStr 끝 · displayStr 마지막 묶음 괄호 안 끝 */
export const OUTBOUND_SHORTAGE_MARK = '추가★'
/** 재고 묶음 이름 (displayStr) · 재고 위치 앞말 (boxStr) */
export const STOCK_SOURCE_LABEL = '재고'
/** 재고 행의 위치가 비어 있을 때 */
const EMPTY_LOCATION_LABEL = '위치없음'
/** 출고준비 모달의 쉽먼트 목록 기간 (일, created_at 기준) */
export const OUTBOUND_SHIPMENT_DAYS = 31
/** 쉽먼트 상세 중 배정 대상 — 개인주문용 입고분만 (DIRECT/COUPANG 제외) */
const PERSONAL_SHIPMENT_TYPE = 'PERSONAL'

export type OutboundStockMode = 'all' | 'uncoveredOnly'

export const OUTBOUND_STOCK_MODE_OPTIONS: { value: OutboundStockMode; label: string; desc: string }[] = [
  { value: 'all', label: '재고 전체', desc: '쉽먼트로 채우지 못한 수량에 재고를 모두 씁니다.' },
  {
    value: 'uncoveredOnly',
    label: '재고 — 미주문건만',
    desc: '미주문 · 취소로 더 들어올 수 없는 수량에만 재고를 씁니다. 주문이 진행 중인 건은 다음 입고를 기다립니다.',
  },
]

// ── 타입 ──────────────────────────────────────────────────────────

/** 출고준비 모달에서 고른 값 — 쉽먼트 0개 이상 + 재고(null = 쓰지 않음). 둘 중 하나는 있어야 한다 */
export interface OutboundPrepSelection {
  shipmentIds: string[]
  stockMode: OutboundStockMode | null
}

/** 재고 배정에 쓰는 si_stocks 열 */
export type OutboundStockRow = Pick<Stock, 'id' | 'location' | 'barcode' | 'item_name' | 'option_name' | 'qty'>

/** 배정할 주문 한 줄 */
export interface OutboundDemand {
  /** 화면 행 키 (결과 Map 의 키) */
  key: string
  barcode: string
  qty: number
  /** 주문일 (ms) — 선착순 기준. 없으면 0 (가장 먼저) */
  orderedAt: number
  /** 중국 주문으로 채워지지 않는 수량 (0 ~ qty) — uncoveredOnly 의 재고 상한 */
  uncoveredUnits: number
}

export interface OutboundAlloc {
  boxStr: string
  displayStr: string
  /** 1개 이상 배정됨 — 출고엑셀 대상 */
  matched: boolean
}

export interface OutboundAllocationInput {
  demands: readonly OutboundDemand[]
  shipmentDetails: readonly ShipmentDetailRow[]
  /** null = 재고를 쓰지 않음 */
  stock: { rows: readonly OutboundStockRow[]; mode: OutboundStockMode } | null
}

export interface OutboundAllocationResult {
  allocMap: Map<string, OutboundAlloc>
  /** shipmentDetails 의 같은 위치 → 배정 수량 */
  shipmentAllocated: number[]
  /** si_stocks.id → 배정 수량 (배정된 행만) */
  stockAllocated: Map<string, number>
}

// ── 내부: 배정 원천 단위 ──────────────────────────────────────────
interface SourceUnit {
  /** 묶음 이름 — 쉽먼트 번호(없으면 null) · 재고는 STOCK_SOURCE_LABEL */
  group: string | null
  /** 박스 코드 · 재고 위치 */
  code: string
  remaining: number
  /** boxStr 에서 code 앞에 붙는 말 */
  boxPrefix: string
  /** 배정 수량 기록 */
  record: (qty: number) => void
}

interface AllocPart {
  group: string | null
  code: string
  boxPrefix: string
  qty: number
}

const normBarcode = (v: string | null | undefined) => (v ?? '').trim()

/** 바코드 → 원천 단위 (code 오름차순, 같으면 들어온 순서) */
function groupByBarcode(units: Array<SourceUnit & { barcode: string }>): Map<string, SourceUnit[]> {
  const map = new Map<string, SourceUnit[]>()
  for (const u of units) {
    const arr = map.get(u.barcode) ?? []
    arr.push(u)
    map.set(u.barcode, arr)
  }
  // Array.prototype.sort 는 안정 정렬 — code 가 같으면 입력 순서 유지
  for (const arr of map.values()) arr.sort((a, b) => a.code.localeCompare(b.code))
  return map
}

/** limit 까지 units 에서 꺼내 parts 에 담는다 — 꺼낸 수량 반환 */
function takeFrom(units: SourceUnit[] | undefined, limit: number, parts: AllocPart[]): number {
  if (!units || limit <= 0) return 0
  let taken = 0
  for (const u of units) {
    if (taken >= limit) break
    if (u.remaining <= 0) continue
    const take = Math.min(limit - taken, u.remaining)
    u.remaining -= take
    u.record(take)
    taken += take
    parts.push({ group: u.group, code: u.code, boxPrefix: u.boxPrefix, qty: take })
  }
  return taken
}

/** 배정 조각 → 표시 문자열 (형식은 파일 머리 설명) */
function formatAlloc(rawParts: AllocPart[], shortage: boolean): OutboundAlloc {
  // 같은 묶음 · 같은 code 가 여러 원천 행(같은 박스에 같은 바코드 2줄 등)에서 오면 한 조각으로 합친다
  const merged = new Map<string, AllocPart>()
  for (const p of rawParts) {
    const k = `${p.group ?? ''}\u0000${p.boxPrefix}\u0000${p.code}`
    const prev = merged.get(k)
    if (prev) prev.qty += p.qty
    else merged.set(k, { ...p })
  }
  const parts = Array.from(merged.values())

  const boxParts = parts.map(p => `${p.boxPrefix}${p.code} - ${p.qty}`)
  // 묶음은 처음 나온 순서 (쉽먼트들 → 재고)
  const groups = new Map<string | null, string[]>()
  for (const p of parts) {
    const arr = groups.get(p.group) ?? []
    arr.push(`${p.code} - ${p.qty}`)
    groups.set(p.group, arr)
  }
  if (shortage) {
    boxParts.push(OUTBOUND_SHORTAGE_MARK)
    Array.from(groups.values()).pop()?.push(OUTBOUND_SHORTAGE_MARK)
  }
  const displayStr = Array.from(groups.entries())
    .map(([group, groupParts]) => (group ? `${group} ` : '') + `[${groupParts.join(', ')}]`)
    .join(' ')
  return { boxStr: `[${boxParts.join(', ')}]`, displayStr, matched: true }
}

// ══════════════════════════════════════════════════════════════════
// 배정
// ══════════════════════════════════════════════════════════════════

export function allocateOutbound(input: OutboundAllocationInput): OutboundAllocationResult {
  const { demands, shipmentDetails, stock } = input

  // ── ① 쉽먼트 입고분 ──
  const shipmentAllocated = new Array<number>(shipmentDetails.length).fill(0)
  const shipmentUnits = groupByBarcode(
    shipmentDetails.flatMap((d, idx) => {
      const barcode = normBarcode(d.barcode)
      const qty = d.quantity ?? 0
      if (d.shipment_type !== PERSONAL_SHIPMENT_TYPE || !barcode || qty <= 0) return []
      return [{
        barcode,
        group: (d.shipment_no ?? '').trim() || null,
        code: d.box_code ?? '',
        remaining: qty,
        boxPrefix: '',
        record: (n: number) => { shipmentAllocated[idx] += n },
      }]
    }),
  )

  // ── ② 재고 ──
  const stockAllocated = new Map<string, number>()
  const stockUnits = groupByBarcode(
    (stock?.rows ?? []).flatMap(s => {
      const barcode = normBarcode(s.barcode)
      const qty = s.qty ?? 0
      if (!barcode || qty <= 0) return []
      return [{
        barcode,
        group: STOCK_SOURCE_LABEL,
        code: (s.location ?? '').trim() || EMPTY_LOCATION_LABEL,
        remaining: qty,
        boxPrefix: `${STOCK_SOURCE_LABEL} `,
        record: (n: number) => { stockAllocated.set(s.id, (stockAllocated.get(s.id) ?? 0) + n) },
      }]
    }),
  )

  // ── 선착순 (주문일 오름차순, 같으면 입력 순서) ──
  const ordered = demands
    .filter(d => normBarcode(d.barcode) && d.qty > 0)
    .slice()
    .sort((a, b) => a.orderedAt - b.orderedAt)
  const state = ordered.map(d => ({ demand: d, barcode: normBarcode(d.barcode), need: d.qty, parts: [] as AllocPart[] }))

  // 1단계: 쉽먼트를 모든 주문에 먼저
  for (const s of state) s.need -= takeFrom(shipmentUnits.get(s.barcode), s.need, s.parts)

  // 2단계: 남은 수량에 재고
  if (stock) {
    for (const s of state) {
      const cap = stock.mode === 'all'
        ? s.need
        : Math.min(s.need, Math.max(0, Math.min(s.demand.uncoveredUnits, s.demand.qty)))
      s.need -= takeFrom(stockUnits.get(s.barcode), cap, s.parts)
    }
  }

  const allocMap = new Map<string, OutboundAlloc>()
  for (const s of state) {
    if (s.parts.length > 0) allocMap.set(s.demand.key, formatAlloc(s.parts, s.need > 0))
  }
  return { allocMap, shipmentAllocated, stockAllocated }
}
