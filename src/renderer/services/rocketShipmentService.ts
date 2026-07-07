/* ================================================================
   로켓그로스 출고 (RocketShipment) — 서비스
   - '출고준비' xlsx 파싱 + Supabase 조인으로 테이블 행 생성
   - 조인:
       엑셀 바코드(D)  → si_rg_items.barcode
                         (→ 상품명/옵션명/등록상품id/옵션id)
       옵션id          → si_coupang_shipment_size.option_id
                         (→ 쿠팡사이즈 shipment_size_before)
   - 큰 목록은 500개씩 .in() 배치로 조회 (단일 요청 1000-row 제한 대응)
   ================================================================ */

import * as XLSX from 'xlsx'
import { supabase } from './supabase'

// ── 엑셀 헤더명 (0행 기준 컬럼 탐색) ───────────────────────────────
//   파일 버전에 따라 '옵션id' 열 유무로 컬럼 위치가 밀리므로(예: 바코드가
//   D열↔E열, 출고개수가 J열↔K열), 고정 인덱스가 아니라 헤더명으로 찾는다.
const HEADER_BOX = '박스번호'      // → 위치
const HEADER_BARCODE = '바코드'    // → 바코드
const HEADER_QTY = '출고개수'      // → 입고수량
// 헤더 탐색 실패 시 폴백 인덱스 (구 파일 레이아웃)
const FALLBACK_BOX = 0
const FALLBACK_BARCODE = 3
const FALLBACK_QTY = 9

// .in() 배치 크기 (URL 길이/응답 1000행 안전)
const IN_CHUNK = 500

// ── 파싱 결과 (엑셀 원본 기준) ────────────────────────────────────
export interface ParsedOutboundRow {
  location: string   // 위치 (박스번호)
  barcode: string    // 바코드
  quantity: number   // 입고수량 (엑셀 출고개수 J)
}

// ── 최종 테이블 행 (조인 결과 포함) ───────────────────────────────
export interface RocketShipmentRow {
  location: string     // 위치
  itemName: string     // 상품명 (si_rg_items.seller_product_name)
  optionName: string   // 옵션명 (si_rg_items.option_name)
  itemId: string       // 등록상품id (si_rg_items.seller_product_id)
  optionId: string     // 옵션id (si_rg_items.vendor_item_id)
  quantity: number     // 입고수량
  barcode: string      // 바코드
  coupangSize: string  // 쿠팡사이즈 (si_coupang_shipment_size.shipment_size_before)
}

// ══════════════════════════════════════════════════════════════════
// 엑셀 파싱
// ══════════════════════════════════════════════════════════════════

/**
 * 출고준비 엑셀(aoa) → ParsedOutboundRow[]
 * - 0행 헤더에서 박스번호/바코드/출고개수 컬럼을 이름으로 탐색 (레이아웃 무관)
 * - 1행부터 데이터, 바코드가 비어있는 행은 스킵
 */
export function parseOutboundExcel(rows: any[][]): ParsedOutboundRow[] {
  if (rows.length < 2) return []

  // ── 헤더명으로 컬럼 인덱스 탐색 (미발견 시 폴백 인덱스) ──
  const header = (rows[0] ?? []).map((h) => String(h ?? '').trim())
  const colOf = (name: string, fallback: number) => {
    const i = header.indexOf(name)
    return i >= 0 ? i : fallback
  }
  const boxCol = colOf(HEADER_BOX, FALLBACK_BOX)
  const barcodeCol = colOf(HEADER_BARCODE, FALLBACK_BARCODE)
  const qtyCol = colOf(HEADER_QTY, FALLBACK_QTY)

  const result: ParsedOutboundRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue
    const barcode = String(row[barcodeCol] ?? '').trim()
    if (!barcode) continue
    result.push({
      location: String(row[boxCol] ?? '').trim(),
      barcode,
      quantity: Number(row[qtyCol] ?? 0) || 0,
    })
  }
  return result
}

// ══════════════════════════════════════════════════════════════════
// 조인 (Supabase)
// ══════════════════════════════════════════════════════════════════

interface RgInfo {
  itemName: string
  optionName: string
  itemId: string
  optionId: string
}

/** 바코드 목록 → si_rg_items 조회 (barcode → RgInfo) */
async function fetchRgByBarcodes(userId: string, barcodes: string[]): Promise<Map<string, RgInfo>> {
  const map = new Map<string, RgInfo>()
  for (let i = 0; i < barcodes.length; i += IN_CHUNK) {
    const chunk = barcodes.slice(i, i + IN_CHUNK)
    const { data, error } = await supabase
      .from('si_rg_items')
      .select('barcode, vendor_item_id, seller_product_id, seller_product_name, option_name')
      .eq('user_id', userId)
      .in('barcode', chunk)
    if (error) throw error
    for (const r of data ?? []) {
      if (r.barcode && !map.has(r.barcode)) {
        map.set(r.barcode, {
          itemName: r.seller_product_name ?? '',
          optionName: r.option_name ?? '',
          itemId: r.seller_product_id ?? '',
          optionId: r.vendor_item_id ?? '',
        })
      }
    }
  }
  return map
}

/** 옵션id 목록 → si_coupang_shipment_size 조회 (option_id → shipment_size_before) */
async function fetchShipmentSizes(userId: string, optionIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (let i = 0; i < optionIds.length; i += IN_CHUNK) {
    const chunk = optionIds.slice(i, i + IN_CHUNK)
    const { data, error } = await supabase
      .from('si_coupang_shipment_size')
      .select('option_id, shipment_size_before')
      .eq('user_id', userId)
      .in('option_id', chunk)
    if (error) throw error
    for (const r of data ?? []) {
      if (r.option_id && !map.has(r.option_id)) {
        map.set(r.option_id, r.shipment_size_before ?? '')
      }
    }
  }
  return map
}

/**
 * 파싱 행 + Supabase 조인 → 최종 테이블 행
 * - 바코드로 si_rg_items 조회 후, 얻은 옵션id로 쿠팡사이즈 조회.
 */
export async function enrichOutboundRows(
  userId: string,
  parsed: ParsedOutboundRow[],
): Promise<RocketShipmentRow[]> {
  if (parsed.length === 0) return []

  // 1) 바코드 → si_rg_items
  const barcodes = Array.from(new Set(parsed.map((p) => p.barcode).filter(Boolean)))
  const rgMap = await fetchRgByBarcodes(userId, barcodes)

  // 2) 옵션id → 쿠팡사이즈
  const optionIds = Array.from(
    new Set(Array.from(rgMap.values()).map((v) => v.optionId).filter(Boolean)),
  )
  const sizeMap = await fetchShipmentSizes(userId, optionIds)

  // 3) 최종 행 조립 (엑셀 순서 유지)
  return parsed.map((p) => {
    const rg = rgMap.get(p.barcode)
    const optionId = rg?.optionId ?? ''
    return {
      location: p.location,
      itemName: rg?.itemName ?? '',
      optionName: rg?.optionName ?? '',
      itemId: rg?.itemId ?? '',
      optionId,
      quantity: p.quantity,
      barcode: p.barcode,
      coupangSize: optionId ? (sizeMap.get(optionId) ?? '') : '',
    }
  })
}

// ══════════════════════════════════════════════════════════════════
// 위치(박스번호) letter ↔ 쿠팡사이즈 검증
//   박스번호 형식: BO-A-01 → 2번째 세그먼트 letter (A/B/C)
//   A=Small, B=Medium, C=Large. 실제 쿠팡사이즈와 다르면 '불일치'.
// ══════════════════════════════════════════════════════════════════

export const SIZES = ['Small', 'Medium', 'Large'] as const
export type SizeTab = (typeof SIZES)[number]

export const SIZE_BY_LETTER: Record<string, SizeTab> = { A: 'Small', B: 'Medium', C: 'Large' }

/** 위치(박스번호)에서 사이즈 letter 추출 (BO-A-01 → 'A') */
export function locationLetter(location: string): string {
  const parts = (location ?? '').split('-')
  return (parts[1] ?? '').trim().toUpperCase().charAt(0)
}

/** 위치 기준 기대 사이즈 (없으면 '') */
export function expectedSize(location: string): string {
  return SIZE_BY_LETTER[locationLetter(location)] ?? ''
}

/** 위치가 가리키는 사이즈와 실제 쿠팡사이즈 불일치 여부 (둘 다 있을 때만 판정) */
export function isSizeMismatch(row: RocketShipmentRow): boolean {
  const exp = expectedSize(row.location)
  if (!exp || !row.coupangSize) return false
  return exp.toLowerCase() !== row.coupangSize.trim().toLowerCase()
}

// ══════════════════════════════════════════════════════════════════
// 그로스 입고 xlsx 생성 (쿠팡 '로켓그로스 입고' 양식)
//   - 시트명/헤더 원본 동일: 1·2행 비움, 3행 헤더명, 4행 예시/설명, 5행~ 데이터
//   - 데이터 매핑 (0-based col): 0 No., 1 등록상품명, 2 옵션명, 5 등록상품ID,
//       6 옵션ID, 7 판매방식('로켓그로스'), 21 입고수량, 27 상품바코드,
//       28 상품사이즈, 29 취급주의여부('해당아님')
//   - 숨김 열은 원본과 동일하게 처리
// ══════════════════════════════════════════════════════════════════

const GROWTH_SHEET_NAME = '로켓그로스 입고'

// 원본 3행(헤더명) — 35열
const GROWTH_HEADER_ROW: (string | number)[] = ['No.','등록상품명','옵션명','판매가','노출상품 ID','등록상품 ID','옵션 ID','판매 방식','24년 총계','25년 총계','25년 06월','25년 07월','25년 08월','지난 14일','2주간\n판매수량','1주간\n판매수량','판매자\n수수료율','판매자\n수수료','쿠팡풀필먼트서비스\n예상 요금(개당)\n(입출고요금+배송료 / 보관료 미포함)','기본 할인액','할인 적용 예상 요금','입고 수량 입력\n(필수)','입고수량에 따른\n2주간 예상 매출','유통기간 입력\n(해당 시 필수)','유통(소비)기한\n(필수)','제조일자\n(필수)','생산년도\n(필수)','상품바코드\n(필수)','상품 사이즈\n(필수)','취급주의여부\n(필수)','판매가능재고','예상 재고 소진일','카테고리','병행수입\n여부','과세유형']

// 원본 4행(예시 및 설명)
const GROWTH_EXAMPLE_ROW: (string | number)[] = ['예시 및 설명','스누피 티셔츠','블랙 S','25000','7269865933','14047501199','85676422188','판매자배송','동일상품 기준\n합산 매출\n(로켓그로스 포함)','동일상품 기준\n합산 매출\n(로켓그로스 포함)','동일상품 기준\n합산 매출\n(로켓그로스 포함)','동일상품 기준\n합산 매출\n(로켓그로스 포함)','동일상품 기준\n합산 매출\n(로켓그로스 포함)','이전 14일 기준\n(단위: 개)','이전 7일 기준\n(단위: 개)','(단위: 원)','입고수량을 입력하고\n예상 수수료를 알아보세요\n물류센터의 상품 실측 이후 요금은 달라질 수 있습니다.','판매기간 2주 기준 추천된 수량이며, 판매자가 변경할 수 있습니다.','입고수량 X 판매가','일 단위로 입력','상품별 기한이 다를 경우, 가장 빠른 날짜로 입력해 주세요.','상품별 기한이 다를 경우, 가장 빠른 날짜로 입력해 주세요.','상품별 기한이 다를 경우, 가장 빠른 날짜로 입력해 주세요.','미입력시 쿠팡 바코드가 자동 생성되며, 상품마다 바코드를 출력해서 부착해야 합니다.','상품 사이즈 분류 기준이 궁금하세요? 바로가기','취급주의 상품(유리 제품, 칼, 페인트)에 해당할 시 표기해주세요.','','','','','','','','']

// 숨김 열 (1-based, 원본 <cols hidden> 그대로)
const GROWTH_HIDDEN_COLS_1BASED = new Set([4,5,9,10,11,12,13,14,15,16,17,18,19,20,21,24,25,26,27,31,32,33,34,35])

/**
 * 중복 상품 합산 — 같은 상품(바코드 기준)이 여러 위치(location)에 나뉘어 있으면
 * 출력 양식에는 위치가 빠지므로 동일 행이 중복된다. 바코드로 묶어 입고수량을 합산한다.
 * - 바코드가 비면 옵션id, 그것도 없으면 병합하지 않음(고유 키).
 * - 첫 등장 순서 보존, 나머지 필드는 첫 행 값 유지(동일 상품이면 값이 같다).
 */
function mergeByProduct(rows: RocketShipmentRow[]): RocketShipmentRow[] {
  const map = new Map<string, RocketShipmentRow>()
  const merged: RocketShipmentRow[] = []
  rows.forEach((r, i) => {
    const key = r.barcode?.trim() || r.optionId?.trim() || `__row_${i}`
    const found = map.get(key)
    if (found) {
      found.quantity += r.quantity
    } else {
      const copy = { ...r }
      map.set(key, copy)
      merged.push(copy)
    }
  })
  return merged
}

/** 선택 행 → 그로스 입고 워크북 생성 (중복 상품은 수량 합산) */
export function buildGrowthInboundWorkbook(rows: RocketShipmentRow[]): XLSX.WorkBook {
  const ncols = GROWTH_HEADER_ROW.length // 35

  const dataRows: (string | number)[][] = mergeByProduct(rows).map((r, i) => {
    const arr: (string | number)[] = new Array(ncols).fill('')
    arr[0] = i + 1              // No.
    arr[1] = r.itemName         // 등록상품명
    arr[2] = r.optionName       // 옵션명
    arr[5] = r.itemId           // 등록상품 ID
    arr[6] = r.optionId         // 옵션 ID
    arr[7] = '로켓그로스'        // 판매 방식
    arr[21] = r.quantity        // 입고 수량 입력
    arr[27] = r.barcode         // 상품바코드
    arr[28] = r.coupangSize     // 상품 사이즈
    arr[29] = '해당아님'         // 취급주의여부
    return arr
  })

  // 3행 헤더 · 4행 예시 · 5행~ 데이터 (origin A3 → 1·2행은 자동으로 빈 행)
  const aoa = [GROWTH_HEADER_ROW, GROWTH_EXAMPLE_ROW, ...dataRows]
  const ws = XLSX.utils.aoa_to_sheet(aoa, { origin: 'A3' })

  // 숨김 열 재현 — 숨길 열에만 ColInfo 설정하고 표시 열은 비움(undefined).
  //   (표시 열에 빈 {} 를 넣으면 width 0 <col>이 생성돼 Excel에서 숨김처럼 보임.
  //    원본 템플릿도 숨김 열에만 <col hidden>을 두므로 동일하게 처리한다.)
  const cols: XLSX.ColInfo[] = new Array(ncols)
  for (let c = 1; c <= ncols; c++) {
    if (GROWTH_HIDDEN_COLS_1BASED.has(c)) cols[c - 1] = { hidden: true }
  }
  ws['!cols'] = cols

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, GROWTH_SHEET_NAME)
  return wb
}
