/* ================================================================
   바코드 매칭 서비스
   - 개인주문(일반상품) → 로켓그로스(si_rg_items) 바코드 자동 매칭
   - 6단계 우선순위 규칙으로 매칭
   ================================================================ */

import { supabase } from './supabase'
import type { RgItem } from '../types/purchase'
import type { PersonalOrderRow } from './personalOrderService'

// ── 매칭 결과 타입 ──────────────────────────────────────────────────
export interface BarcodeMatchResult {
  matched: number
  unmatched: number
  updated: number
  errors: string[]
}

// ══════════════════════════════════════════════════════════════════
// 유틸: 토큰 처리
// ══════════════════════════════════════════════════════════════════

/** 공백 분리 → 정렬 → join (규칙 3, 5b) */
function tokenSort(str: string): string {
  return str.trim().split(/\s+/).sort().join(' ')
}

/** 괄호·하이픈 제거 → 공백 분리 → Set (규칙 4) */
function tokenize(str: string): Set<string> {
  return new Set(
    str
      .replace(/[()（）\-\[\]]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  )
}

/** a의 모든 토큰이 b에 포함되는지 (규칙 4) */
function isSubset(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0) return false
  for (const token of a) {
    if (!b.has(token)) return false
  }
  return true
}

// ══════════════════════════════════════════════════════════════════
// 데이터 조회
// ══════════════════════════════════════════════════════════════════

/** si_rg_items 조회 (barcode NOT NULL, 해당 사용자, 페이지네이션) */
export async function fetchRgItemsWithBarcode(userId: string): Promise<RgItem[]> {
  const allData: RgItem[] = []
  const batchSize = 1000
  let from = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await (supabase.from('si_rg_items') as any)
      .select(
        'id, seller_product_id, seller_product_name, vendor_item_id, item_name, barcode, user_id',
      )
      .eq('user_id', userId)
      .not('barcode', 'is', null)
      .range(from, from + batchSize - 1)

    if (error) throw error

    if (data && data.length > 0) {
      allData.push(...data)
      from += batchSize
      if (data.length < batchSize) hasMore = false
    } else {
      hasMore = false
    }
  }

  return allData
}

// ══════════════════════════════════════════════════════════════════
// 메인: 바코드 매칭 (6단계 규칙)
// ══════════════════════════════════════════════════════════════════

/**
 * 개인주문 데이터에 로켓그로스 바코드를 매칭한다.
 *
 * 매칭 규칙 (우선순위):
 *   1. vendor_item_id + option_name 정확 일치
 *   2. seller_product_id + option_name 정확 일치 (다건 → vendor_item_id 정렬)
 *   3. seller_product_id + option_name 토큰정렬 일치
 *   4. seller_product_id + option_name 토큰 subset (1건만)
 *   5. 상품명(seller_product_name) + 옵션명(item_name) 이름 매칭 (ID 무관 폴백)
 *      5a. 정확 일치 (다건 → vendor_item_id 정렬)
 *      5b. 토큰정렬 일치
 *   6. 매칭 불가
 *
 * @param orders   - 바코드 없는 개인주문 행 배열
 * @param rgItems  - si_rg_items (barcode NOT NULL)
 * @returns Map<order.id, barcode>
 */
export function matchBarcodes(
  orders: PersonalOrderRow[],
  rgItems: RgItem[],
): Map<string, string> {
  const result = new Map<string, string>()

  // ── 인덱스 구축 (성능 최적화) ──────────────────────────────────
  const byVendorItemId = new Map<string, RgItem[]>()
  const bySellerProductId = new Map<string, RgItem[]>()
  const bySellerProductName = new Map<string, RgItem[]>()

  for (const rg of rgItems) {
    if (!rg.barcode) continue

    if (rg.vendor_item_id) {
      const key = rg.vendor_item_id
      if (!byVendorItemId.has(key)) byVendorItemId.set(key, [])
      byVendorItemId.get(key)!.push(rg)
    }

    if (rg.seller_product_id) {
      const key = rg.seller_product_id
      if (!bySellerProductId.has(key)) bySellerProductId.set(key, [])
      bySellerProductId.get(key)!.push(rg)
    }

    if (rg.seller_product_name) {
      const key = rg.seller_product_name
      if (!bySellerProductName.has(key)) bySellerProductName.set(key, [])
      bySellerProductName.get(key)!.push(rg)
    }
  }

  // ── 주문별 매칭 ─────────────────────────────────────────────────
  for (const order of orders) {
    if (!order.id) continue
    const optName = order.option_name ?? ''

    // ── 규칙 1: vendor_item_id + option_name 정확 일치 ──
    const r1Candidates = byVendorItemId.get(order.vendor_item_id)
    if (r1Candidates) {
      const match = r1Candidates.find((rg) => rg.item_name === optName)
      if (match?.barcode) {
        result.set(order.id, match.barcode)
        continue
      }
    }

    // ── 규칙 2: seller_product_id + option_name 정확 일치 ──
    const r2Candidates = bySellerProductId.get(order.seller_product_id)
    if (r2Candidates) {
      const matches = r2Candidates.filter((rg) => rg.item_name === optName)
      if (matches.length === 1 && matches[0].barcode) {
        result.set(order.id, matches[0].barcode)
        continue
      }
      // 2건 이상이면 vendor_item_id가 큰 것 (최신 등록)
      if (matches.length > 1) {
        const sorted = matches.sort((a, b) =>
          (b.vendor_item_id ?? '').localeCompare(a.vendor_item_id ?? ''),
        )
        if (sorted[0].barcode) {
          result.set(order.id, sorted[0].barcode)
          continue
        }
      }
    }

    // ── 규칙 3: seller_product_id + option_name 토큰정렬 일치 ──
    if (r2Candidates) {
      const sortedOpt = tokenSort(optName)
      const match = r2Candidates.find(
        (rg) => rg.item_name && tokenSort(rg.item_name) === sortedOpt,
      )
      if (match?.barcode) {
        result.set(order.id, match.barcode)
        continue
      }
    }

    // ── 규칙 4: seller_product_id + option_name 토큰 subset ──
    if (r2Candidates) {
      const orderTokens = tokenize(optName)
      const subsetMatches = r2Candidates.filter(
        (rg) => rg.item_name && isSubset(orderTokens, tokenize(rg.item_name)),
      )
      // 1건만 매칭된 경우만 채택 (2건 이상이면 매칭 실패)
      if (subsetMatches.length === 1 && subsetMatches[0].barcode) {
        result.set(order.id, subsetMatches[0].barcode)
        continue
      }
    }

    // ── 규칙 5: 상품명 + 옵션명 이름 매칭 (ID 무관 폴백) ──
    // order.item_name(sellerProductName) ↔ rg.seller_product_name
    // order.option_name ↔ rg.item_name
    const r5Candidates = bySellerProductName.get(order.item_name)
    if (r5Candidates) {
      // 5a: 정확 일치
      const exactMatches = r5Candidates.filter((rg) => rg.item_name === optName)
      if (exactMatches.length === 1 && exactMatches[0].barcode) {
        result.set(order.id, exactMatches[0].barcode)
        continue
      }
      if (exactMatches.length > 1) {
        // 다건 → vendor_item_id가 큰 것 (최신 등록)
        const sorted = exactMatches.sort((a, b) =>
          (b.vendor_item_id ?? '').localeCompare(a.vendor_item_id ?? ''),
        )
        if (sorted[0].barcode) {
          result.set(order.id, sorted[0].barcode)
          continue
        }
      }

      // 5b: 토큰정렬 일치
      const sortedOpt = tokenSort(optName)
      const tokenMatch = r5Candidates.find(
        (rg) => rg.item_name && tokenSort(rg.item_name) === sortedOpt,
      )
      if (tokenMatch?.barcode) {
        result.set(order.id, tokenMatch.barcode)
        continue
      }
    }

    // ── 규칙 6: 매칭 불가 → 건너뜀 ──
  }

  return result
}

// ══════════════════════════════════════════════════════════════════
// 저장: 매칭된 바코드를 coupang_personal_orders에 업데이트
// ══════════════════════════════════════════════════════════════════

/** 매칭 결과를 DB에 저장 (50건 병렬 배치) */
export async function saveBarcodes(
  matches: Map<string, string>,
  userId: string,
): Promise<{ updated: number; errors: string[] }> {
  const BATCH = 50
  const entries = Array.from(matches.entries())
  let updated = 0
  const errors: string[] = []

  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH)

    const results = await Promise.allSettled(
      batch.map(([id, barcode]) =>
        (supabase.from('coupang_personal_orders') as any)
          .update({ barcode })
          .eq('id', id)
          .eq('user_id', userId)
          .then(({ error }: { error: any }) => {
            if (error) throw new Error(`${id}: ${error.message}`)
          }),
      ),
    )

    for (const r of results) {
      if (r.status === 'fulfilled') {
        updated++
      } else {
        errors.push(r.reason?.message ?? 'unknown error')
      }
    }
  }

  return { updated, errors }
}
