/* ================================================================
   사입관리 (PurchaseManagement) 서비스
   - Vite 프록시를 통한 쿠팡 로켓그로스 API 호출
   - nextToken 순회로 전체 상품 수집
   - 큐 기반 동시 상세 조회 (초당 5회 제한 준수, retry with backoff)
   - Supabase si_rg_items 테이블 CRUD
   ================================================================ */

import * as XLSX from 'xlsx'
import { supabase } from './supabase'
import type {
  RgItem,
  RgItemData,
  ShipmentSize,
  CoupangProductListItem,
  CoupangProductDetail,
} from '../types/purchase'
import type { AuthUser } from '../types/auth'

// ── 상수 ──────────────────────────────────────────────────────────
const DETAIL_CONCURRENCY = 5     // 상세 조회 동시 요청 수 (쿠팡 초당 5회 제한 준수)
const REQUEST_INTERVAL_MS = 200  // 요청 간 최소 간격 (1000ms / 5 = 200ms)
const RETRY_MAX = 3              // 실패 시 최대 재시도 횟수
const RETRY_BASE_MS = 1000       // 재시도 대기 기본 시간 (exponential backoff)
const LIST_PAGE_SIZE = 100       // 상품 목록 한 페이지 크기
const SUPABASE_BATCH_SIZE = 500  // Supabase insert 배치 크기

// ══════════════════════════════════════════════════════════════════
// 쿠팡 인증 키 조회 (localStorage → si_users)
// ══════════════════════════════════════════════════════════════════

/** localStorage에서 로그인 사용자의 쿠팡 API 키를 조회 */
function getCoupangCredentials(): { accessKey: string; secretKey: string; vendorCode: string } {
  const raw = localStorage.getItem('user')
  if (!raw) throw new Error('로그인 정보가 없습니다. 다시 로그인해 주세요.')

  const user: AuthUser = JSON.parse(raw)

  if (!user.coupang_access_key || !user.coupang_secret_key || !user.vendor_id) {
    throw new Error('쿠팡 API 키가 설정되지 않았습니다. 관리자에게 문의하세요.')
  }

  return {
    accessKey: user.coupang_access_key,
    secretKey: user.coupang_secret_key,
    vendorCode: user.vendor_id,
  }
}

/** 쿠팡 프록시 호출 시 포함할 인증 헤더 생성 */
function getCoupangHeaders(): Record<string, string> {
  const { accessKey, secretKey, vendorCode } = getCoupangCredentials()
  return {
    'X-Coupang-Access-Key': accessKey,
    'X-Coupang-Secret-Key': secretKey,
    'X-Vendor-Code': vendorCode,
  }
}

// ══════════════════════════════════════════════════════════════════
// 쿠팡 프록시 API
// ══════════════════════════════════════════════════════════════════

// ── 상품 목록 (단일 페이지) ──────────────────────────────────────────

/** 상품 목록 한 페이지 조회 (nextToken 기반) */
async function fetchRgProductPage(
  nextToken?: string,
  pageSize = LIST_PAGE_SIZE,
): Promise<{ items: CoupangProductListItem[]; nextToken: string | null }> {
  const params = new URLSearchParams({ pageSize: String(pageSize) })
  if (nextToken) params.set('nextToken', nextToken)

  const res = await fetch(`/api/coupang/rg-products?${params}`, {
    headers: getCoupangHeaders(),
  })
  const json = await res.json()

  if (!json.success || json.data?.code !== 'SUCCESS') {
    throw new Error(json.error || json.data?.message || 'API 호출 실패')
  }

  const data = json.data.data
  const items = Array.isArray(data) ? data : data ? [data] : []

  return {
    items,
    nextToken: json.data.nextToken || null,
  }
}

// ── 전체 상품 목록 수집 ─────────────────────────────────────────────

/**
 * nextToken을 순회하며 전체 로켓그로스 상품 목록 수집
 * @param onProgress - 진행 콜백 (수집된 상품 수)
 */
export async function fetchAllRgProducts(
  onProgress?: (count: number) => void,
): Promise<CoupangProductListItem[]> {
  const pages: CoupangProductListItem[][] = []
  let nextToken: string | undefined
  let page = 0

  do {
    const result = await fetchRgProductPage(nextToken, LIST_PAGE_SIZE)
    pages.push(result.items)
    nextToken = result.nextToken ?? undefined
    page++

    const total = pages.reduce((sum, p) => sum + p.length, 0)
    console.log(`[fetchAllRgProducts] 페이지 ${page}: ${result.items.length}건 (누적 ${total}건)`)
    onProgress?.(total)
  } while (nextToken)

  // 페이지별 배열을 한 번에 병합 (spread 반복 방지)
  const allProducts = pages.flat()
  console.log(`[fetchAllRgProducts] 전체 완료: ${allProducts.length}개 상품`)
  return allProducts
}

// ── 유틸: 딜레이 ────────────────────────────────────────────────────

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// ── 상품 상세 조회 (단건, retry with exponential backoff) ──────────────

/**
 * 로켓그로스 상품 상세 조회 (단건)
 * - 쿠팡 rate limit(초당 5회) 초과 시 500 반환 → 재시도
 * - 최대 3회, 대기 시간 1초 → 2초 → 4초 (exponential backoff)
 */
export async function fetchRgProductDetail(
  sellerProductId: number,
): Promise<CoupangProductDetail> {
  for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
    const res = await fetch(`/api/coupang/rg-product/${sellerProductId}`, {
      headers: getCoupangHeaders(),
    })
    const json = await res.json()

    // 성공
    if (json.success && json.data?.code === 'SUCCESS') {
      return json.data.data
    }

    // 마지막 시도였으면 에러 throw
    if (attempt === RETRY_MAX) {
      throw new Error(json.error || json.data?.message || '상품 상세 조회 실패')
    }

    // 재시도 대기 (exponential backoff: 1s → 2s → 4s)
    const waitMs = RETRY_BASE_MS * Math.pow(2, attempt)
    console.warn(`[fetchRgProductDetail] ${sellerProductId} 재시도 ${attempt + 1}/${RETRY_MAX} (${waitMs}ms 후)`)
    await delay(waitMs)
  }

  // TypeScript 타입 안전성용 (실제로 도달하지 않음)
  throw new Error('상품 상세 조회 실패')
}

// ══════════════════════════════════════════════════════════════════
// 큐 기반 상세 조회 + 매핑
// ══════════════════════════════════════════════════════════════════

/**
 * 큐 기반 동시 처리로 전체 상품 상세 조회 후 DB 행 변환
 * - 쿠팡 초당 5회 제한 준수: 동시 5슬롯 + 요청 간 200ms 간격
 * - 실패 시 retry with exponential backoff (fetchRgProductDetail 내부)
 * - 3회 재시도 후에도 실패하면 목록 데이터로 폴백
 * @param products - 상품 목록 (sellerProductId 포함)
 * @param userId   - 사용자 ID (si_rg_items.user_id)
 * @param onProgress - 진행 콜백 (완료 수, 전체 수)
 */
export async function fetchDetailsAndMap(
  products: CoupangProductListItem[],
  userId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Omit<RgItem, 'id' | 'created_at'>[]> {
  const allRows: Omit<RgItem, 'id' | 'created_at'>[] = []
  const inFlight = new Set<Promise<void>>()
  let done = 0

  for (const product of products) {
    // 슬롯이 가득 차면 가장 빠른 1건 완료 대기
    if (inFlight.size >= DETAIL_CONCURRENCY) {
      await Promise.race(inFlight)
    }

    // 초당 5회 제한 준수: 요청 간 최소 200ms 간격
    await delay(REQUEST_INTERVAL_MS)

    // 새 요청 시작
    const task = (async () => {
      try {
        const detail = await fetchRgProductDetail(product.sellerProductId)
        allRows.push(...mapToRgItems(detail, userId))
      } catch {
        // 3회 재시도 후에도 실패 → 목록 데이터로 폴백
        allRows.push(...mapListItemToRgItems(product, userId))
      } finally {
        done++
        onProgress?.(done, products.length)
      }
    })()

    inFlight.add(task)
    task.finally(() => inFlight.delete(task))
  }

  // 남은 요청 모두 완료 대기
  await Promise.all(inFlight)
  return allRows
}

// ══════════════════════════════════════════════════════════════════
// 데이터 매핑
// ══════════════════════════════════════════════════════════════════

// ── 상세 API 응답 → si_rg_items 행 ──────────────────────────────────

/**
 * 상품 상세 데이터를 si_rg_items 행(들)으로 변환
 * - 하나의 상품에 여러 아이템(옵션)이 있으므로 배열 반환
 * - 대표 이미지(REPRESENTATION)를 img_url로 사용
 */
export function mapToRgItems(
  detail: CoupangProductDetail,
  userId: string,
): Omit<RgItem, 'id' | 'created_at'>[] {
  return detail.items.map((item) => {
    // 대표 이미지 URL 추출
    const repImage = item.images?.find(
      (img) => img.imageType === 'REPRESENTATION' || img.imageOrder === 0,
    )
    const imgUrl = repImage?.cdnPath
      ? `https://thumbnail6.coupangcdn.com/thumbnails/remote/230x230ex/image/${repImage.cdnPath}`
      : null

    return {
      seller_product_id: String(detail.sellerProductId),
      status_name: detail.statusName ?? null,
      seller_product_name: detail.sellerProductName ?? null,
      sale_started_at: detail.saleStartedAt ?? null,
      display_product_name: detail.displayProductName ?? null,
      general_product_name: detail.generalProductName ?? null,
      option_name: item.itemName ?? null,
      img_url: imgUrl,
      seller_product_item_id: (item.sellerProductItemId ?? item.rocketGrowthItemData?.sellerProductItemId) != null
        ? String(item.sellerProductItemId ?? item.rocketGrowthItemData!.sellerProductItemId) : null,
      vendor_item_id: (item.vendorItemId ?? item.rocketGrowthItemData?.vendorItemId) != null
        ? String(item.vendorItemId ?? item.rocketGrowthItemData!.vendorItemId) : null,
      barcode: item.barcode ?? item.rocketGrowthItemData?.barcode ?? null,
      external_vendor_sku: item.externalVendorSku ?? item.rocketGrowthItemData?.externalVendorSku ?? null,
      sale_price: item.salePrice ?? item.rocketGrowthItemData?.priceData?.salePrice ?? null,
      input: null,
      weight: item.rocketGrowthItemData?.skuInfo?.weight ?? null,
      width: item.rocketGrowthItemData?.skuInfo?.width ?? null,
      length: item.rocketGrowthItemData?.skuInfo?.length ?? null,
      height: item.rocketGrowthItemData?.skuInfo?.height ?? null,
      user_id: userId,
    }
  })
}

// ── 목록 API 응답 → si_rg_items 행 (폴백용) ─────────────────────────

/**
 * 상세 조회 실패 시 목록 데이터만으로 기본 행 생성
 * - barcode, salePrice, imgUrl 등은 null
 */
export function mapListItemToRgItems(
  listItem: CoupangProductListItem,
  userId: string,
): Omit<RgItem, 'id' | 'created_at'>[] {
  return listItem.items.map((item) => ({
    seller_product_id: String(listItem.sellerProductId),
    status_name: listItem.statusName ?? null,
    seller_product_name: listItem.sellerProductName ?? null,
    sale_started_at: listItem.saleStartedAt ?? null,
    display_product_name: null,
    general_product_name: null,
    option_name: item.itemName ?? null,
    img_url: null,
    seller_product_item_id: item.rocketGrowthItemData
      ? String(item.rocketGrowthItemData.sellerProductItemId)
      : null,
    vendor_item_id: item.rocketGrowthItemData
      ? String(item.rocketGrowthItemData.vendorItemId)
      : null,
    barcode: null,
    external_vendor_sku: null,
    sale_price: null,
    input: null,
    weight: null,
    width: null,
    length: null,
    height: null,
    user_id: userId,
  }))
}

// ══════════════════════════════════════════════════════════════════
// Supabase CRUD
// ══════════════════════════════════════════════════════════════════

// ── 사용자별 전체 조회 ──────────────────────────────────────────────

/** si_rg_items에서 사용자별 전체 조회 (1000건 배치 패턴) */
export async function fetchRgItems(userId: string): Promise<RgItem[]> {
  const batches: RgItem[][] = []
  let from = 0
  const batchSize = 1000
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from('si_rg_items')
      .select('*')
      .eq('user_id', userId)
      .range(from, from + batchSize - 1)

    if (error) {
      console.error('si_rg_items 조회 오류:', error)
      throw error
    }

    if (data && data.length > 0) {
      batches.push(data)
      from += batchSize
      if (data.length < batchSize) hasMore = false
    } else {
      hasMore = false
    }
  }

  const allData = batches.flat()
  console.log(`[purchaseService] si_rg_items ${allData.length}건 조회`)
  return allData
}

// ── si_rg_item_data 사용자별 전체 조회 ───────────────────────────────

/** si_rg_item_data에서 사용자별 전체 조회 (1000건 배치 패턴) */
export async function fetchRgItemData(userId: string): Promise<RgItemData[]> {
  const batches: RgItemData[][] = []
  let from = 0
  const batchSize = 1000
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from('si_rg_item_data')
      .select('*')
      .eq('user_id', userId)
      .range(from, from + batchSize - 1)

    if (error) {
      console.error('si_rg_item_data 조회 오류:', error)
      throw error
    }

    if (data && data.length > 0) {
      batches.push(data)
      from += batchSize
      if (data.length < batchSize) hasMore = false
    } else {
      hasMore = false
    }
  }

  const allData = batches.flat()
  console.log(`[purchaseService] si_rg_item_data ${allData.length}건 조회`)
  return allData
}

// ── 데이터 저장 (delete → 병렬 batch insert) ────────────────────────

/**
 * si_rg_items에 데이터 저장
 * - PK가 auto-generated uuid → delete 후 insert 방식
 * - 500건씩 배치를 병렬 삽입하여 속도 향상
 */
export async function saveRgItems(
  items: Omit<RgItem, 'id' | 'created_at'>[],
  userId: string,
): Promise<{ success: number; errors: number }> {
  // STEP 1: 기존 데이터 삭제
  const { error: deleteError } = await supabase
    .from('si_rg_items')
    .delete()
    .eq('user_id', userId)

  if (deleteError) {
    console.error('si_rg_items 삭제 오류:', deleteError)
  }

  // STEP 2: 배치 분할
  const batches: Omit<RgItem, 'id' | 'created_at'>[][] = []
  for (let i = 0; i < items.length; i += SUPABASE_BATCH_SIZE) {
    batches.push(items.slice(i, i + SUPABASE_BATCH_SIZE))
  }

  // STEP 3: 모든 배치 병렬 삽입
  const results = await Promise.allSettled(
    batches.map((batch, idx) =>
      supabase
        .from('si_rg_items')
        .insert(batch)
        .then(({ error }) => {
          if (error) {
            console.error(`si_rg_items insert 오류 (batch ${idx + 1}):`, error)
            throw error
          }
          return batch.length
        }),
    ),
  )

  // STEP 4: 결과 집계
  let success = 0
  let errors = 0
  for (const result of results) {
    if (result.status === 'fulfilled') {
      success += result.value
    } else {
      errors += SUPABASE_BATCH_SIZE // 최대치로 집계
    }
  }

  console.log(`[purchaseService] si_rg_items 저장 완료 — 성공: ${success}, 실패: ${errors}`)
  return { success, errors }
}

// ══════════════════════════════════════════════════════════════════
// 재고건강 SKU 엑셀 업로드 (si_rg_item_data)
// ══════════════════════════════════════════════════════════════════

// ── 필수 헤더 목록 ──────────────────────────────────────────────────
const REQUIRED_ITEM_DATA_HEADERS = [
  'Inventory ID',
  'Option ID',
  'SKU ID',
  'Product name',
  'Option name',
]

// ── 헤더 검증 ───────────────────────────────────────────────────────

/**
 * 재고건강 SKU 엑셀 헤더 검증
 * - Row 0에서 필수 헤더 존재 확인
 */
export function validateItemDataExcel(headers: any[]): boolean {
  const headerStrings = headers.map((h) => String(h ?? '').trim())
  return REQUIRED_ITEM_DATA_HEADERS.every((required) =>
    headerStrings.some((h) => h === required),
  )
}

// ── 엑셀 데이터 파싱 ────────────────────────────────────────────────

/**
 * 재고건강 SKU 엑셀 데이터를 RgItemData 배열로 변환
 * - Row 0: 헤더, Row 1: 서브헤더(스킵), Row 2~: 데이터
 * - 인덱스 0(No.) 스킵, 인덱스 1~26 매핑
 */
export function parseItemDataExcel(
  rows: any[][],
  userId: string,
): Omit<RgItemData, 'id' | 'created_at'>[] {
  const result: Omit<RgItemData, 'id' | 'created_at'>[] = []

  // Row 2부터 데이터 행
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue

    // item_id(인덱스 1)가 없으면 빈 행 → 스킵
    const itemId = row[1]
    if (itemId == null || String(itemId).trim() === '') continue

    const toNum = (v: any): number | null => {
      if (v == null || String(v).trim() === '') return null
      const n = Number(v)
      return isNaN(n) ? null : n
    }

    const toStr = (v: any): string | null => {
      if (v == null || String(v).trim() === '') return null
      return String(v).trim()
    }

    result.push({
      user_id: userId,
      item_id: toNum(row[1]),
      option_id: toNum(row[2]),
      sku_id: toNum(row[3]),
      item_name: toStr(row[4]),
      option_name: toStr(row[5]),
      offer_condition: toStr(row[6]),
      orderable_qty: toNum(row[7]),
      pending_inbounds: toNum(row[8]),
      item_winner: toStr(row[9]),
      recent_sales_7d: toNum(row[10]),
      recent_sales_30d: toNum(row[11]),
      recent_sales_qty_7d: toNum(row[12]),
      recent_sales_qty_30d: toNum(row[13]),
      recommended_inbound_qty: toNum(row[14]),
      recommended_inbound_date: toStr(row[15]),
      days_of_cover: toStr(row[16]),
      monthly_storage_fee: toNum(row[17]),
      sku_age_1_30d: toNum(row[18]),
      sku_age_31_45d: toNum(row[19]),
      sku_age_46_60d: toNum(row[20]),
      sku_age_61_120d: toNum(row[21]),
      sku_age_121_180d: toNum(row[22]),
      sku_age_181_plus: toNum(row[23]),
      customer_returns_30d: toNum(row[24]),
      season: toStr(row[25]),
      product_listing_date: toStr(row[26]),
    })
  }

  console.log(`[parseItemDataExcel] ${result.length}건 파싱 완료`)
  return result
}

// ── 데이터 저장 (delete → 병렬 batch insert) ────────────────────────

/**
 * si_rg_item_data에 데이터 저장
 * - 해당 user_id의 기존 데이터 전체 삭제 → 500건씩 배치 insert
 */
export async function saveRgItemData(
  items: Omit<RgItemData, 'id' | 'created_at'>[],
  userId: string,
): Promise<{ success: number; errors: number }> {
  // STEP 1: 기존 데이터 삭제
  const { error: deleteError } = await supabase
    .from('si_rg_item_data')
    .delete()
    .eq('user_id', userId)

  if (deleteError) {
    console.error('si_rg_item_data 삭제 오류:', deleteError)
  }

  // STEP 2: 배치 분할
  const batches: Omit<RgItemData, 'id' | 'created_at'>[][] = []
  for (let i = 0; i < items.length; i += SUPABASE_BATCH_SIZE) {
    batches.push(items.slice(i, i + SUPABASE_BATCH_SIZE))
  }

  // STEP 3: 모든 배치 병렬 삽입
  const results = await Promise.allSettled(
    batches.map((batch, idx) =>
      supabase
        .from('si_rg_item_data')
        .insert(batch)
        .then(({ error }) => {
          if (error) {
            console.error(`si_rg_item_data insert 오류 (batch ${idx + 1}):`, error)
            throw error
          }
          return batch.length
        }),
    ),
  )

  // STEP 4: 결과 집계
  let success = 0
  let errors = 0
  for (const result of results) {
    if (result.status === 'fulfilled') {
      success += result.value
    } else {
      errors += SUPABASE_BATCH_SIZE
    }
  }

  console.log(`[purchaseService] si_rg_item_data 저장 완료 — 성공: ${success}, 실패: ${errors}`)
  return { success, errors }
}

// ══════════════════════════════════════════════════════════════════
// 신규 아이템만 추가 (기존 데이터 유지)
// ══════════════════════════════════════════════════════════════════

/**
 * vendor_item_id 기준으로 기존에 없는 아이템만 insert
 * - 기존 데이터(barcode, input 등)는 유지
 * - 삭제하지 않고 신규 항목만 추가
 */
export async function upsertNewRgItems(
  newItems: Omit<RgItem, 'id' | 'created_at'>[],
  userId: string,
): Promise<{ inserted: number; skipped: number }> {
  // STEP 1: 기존 vendor_item_id Set 구축
  const existing = await fetchRgItems(userId)
  const existingVendorIds = new Set(
    existing
      .filter((item) => item.vendor_item_id)
      .map((item) => item.vendor_item_id!),
  )

  // STEP 2: 신규 아이템 필터
  const toInsert = newItems.filter(
    (item) => item.vendor_item_id && !existingVendorIds.has(item.vendor_item_id),
  )
  const skipped = newItems.length - toInsert.length

  if (toInsert.length === 0) {
    return { inserted: 0, skipped }
  }

  // STEP 3: 배치 insert (기존 saveRgItems와 동일한 배치 패턴)
  const batches: Omit<RgItem, 'id' | 'created_at'>[][] = []
  for (let i = 0; i < toInsert.length; i += SUPABASE_BATCH_SIZE) {
    batches.push(toInsert.slice(i, i + SUPABASE_BATCH_SIZE))
  }

  let inserted = 0
  for (const batch of batches) {
    const { error } = await supabase.from('si_rg_items').insert(batch)
    if (error) {
      console.error('[upsertNewRgItems] insert 오류:', error)
    } else {
      inserted += batch.length
    }
  }

  console.log(`[upsertNewRgItems] 신규 ${inserted}건 삽입, ${skipped}건 스킵`)
  return { inserted, skipped }
}

// ══════════════════════════════════════════════════════════════════
// 바코드 연결 xlsx: 엑셀에서 vendor_item_id ↔ barcode 매칭 → DB 저장
// ══════════════════════════════════════════════════════════════════

/**
 * 바코드 연결 엑셀 파싱 결과를 DB에 반영
 * @param barcodeMap - Map<vendor_item_id, barcode>
 * @param userId    - 사용자 ID
 */
export async function updateBarcodesFromMap(
  barcodeMap: Map<string, string>,
  userId: string,
): Promise<{ updated: number; notFound: number }> {
  const entries = Array.from(barcodeMap.entries())
  const BATCH = 50
  let updated = 0
  let errors = 0

  console.log(`[updateBarcodesFromMap] ${entries.length}건 업데이트 시작 (${BATCH}건씩 병렬)`)

  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH)

    const results = await Promise.allSettled(
      batch.map(([vendorItemId, barcode]) =>
        supabase
          .from('si_rg_items')
          .update({ barcode })
          .eq('vendor_item_id', vendorItemId)
          .eq('user_id', userId)
          .then(({ error }) => {
            if (error) throw error
          }),
      ),
    )

    for (const r of results) {
      if (r.status === 'fulfilled') updated++
      else errors++
    }

    if ((i + BATCH) % 500 === 0 || i + BATCH >= entries.length) {
      console.log(`[updateBarcodesFromMap] 진행: ${Math.min(i + BATCH, entries.length)}/${entries.length}`)
    }
  }

  console.log(`[updateBarcodesFromMap] 완료 — 성공: ${updated}건, 실패: ${errors}건`)
  return { updated, notFound: errors }
}

// ══════════════════════════════════════════════════════════════════
// 바코드 연동: 쿠팡 상세 API → barcode 추출 → DB 저장
// ══════════════════════════════════════════════════════════════════

/**
 * barcode가 없는 아이템들의 상세 API를 조회하여 barcode를 채운다.
 * - 5/sec 속도 제한 준수 (기존 DETAIL_CONCURRENCY, REQUEST_INTERVAL_MS 재활용)
 * - 동일 seller_product_id는 한 번만 조회 (중복 제거)
 * @param items       - barcode가 없는 RgItem 배열
 * @param onProgress  - 진행 콜백 (완료 수, 전체 수)
 */
export async function fetchBarcodesFromApi(
  items: RgItem[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ found: number; notFound: number; errors: string[] }> {
  // seller_product_id 기준 중복 제거
  const uniqueSpIds = [...new Set(
    items
      .filter((item) => item.seller_product_id)
      .map((item) => item.seller_product_id),
  )]

  let done = 0
  let found = 0
  let notFound = 0
  const errors: string[] = []
  const inFlight = new Set<Promise<void>>()

  // vendor_item_id → RgItem 맵 (결과 매칭용)
  const vendorItemMap = new Map<string, RgItem[]>()
  for (const item of items) {
    if (item.vendor_item_id) {
      if (!vendorItemMap.has(item.vendor_item_id)) {
        vendorItemMap.set(item.vendor_item_id, [])
      }
      vendorItemMap.get(item.vendor_item_id)!.push(item)
    }
  }

  for (const spId of uniqueSpIds) {
    if (inFlight.size >= DETAIL_CONCURRENCY) {
      await Promise.race(inFlight)
    }
    await delay(REQUEST_INTERVAL_MS)

    const task = (async () => {
      try {
        const detail = await fetchRgProductDetail(Number(spId))
        const mapped = mapToRgItems(detail, items[0].user_id ?? '')

        for (const row of mapped) {
          if (row.barcode && row.vendor_item_id) {
            const targets = vendorItemMap.get(row.vendor_item_id)
            if (targets && targets.length > 0) {
              // DB UPDATE
              const { error } = await supabase
                .from('si_rg_items')
                .update({ barcode: row.barcode })
                .eq('vendor_item_id', row.vendor_item_id)
                .eq('user_id', items[0].user_id ?? '')

              if (error) {
                errors.push(`${row.vendor_item_id}: ${error.message}`)
              } else {
                found++
                // 로컬 아이템에도 barcode 반영
                for (const t of targets) t.barcode = row.barcode
              }
            }
          }
        }
      } catch (err: any) {
        errors.push(`${spId}: ${err.message || '조회 실패'}`)
        notFound++
      } finally {
        done++
        onProgress?.(done, uniqueSpIds.length)
      }
    })()

    inFlight.add(task)
    task.finally(() => inFlight.delete(task))
  }

  await Promise.all(inFlight)
  console.log(`[fetchBarcodesFromApi] 완료 — 매칭: ${found}, 미발견: ${notFound}`)
  return { found, notFound, errors }
}

// ═══════════════════════════════════════���══════════════════════════
// 조회수: CSV 파싱 + DB 저장 (si_rg_views)
// ═════��════════════════��═══════════════════════════════════════════

/** 조회수 CSV 행 타입 */
export interface ViewsRow {
  item_id: string
  item_name: string
  view: number
}

/**
 * CSV 한 줄 파싱 (RFC 4180 호환)
 * - 큰따옴표로 감싼 필드 안의 콤마/개행 보호
 * - 이스케이프된 큰따옴표("") → " 변환
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let cur = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (inQuotes) {
      if (ch === '"') {
        // 다음 문자도 " 면 이스케이프된 따옴표
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        fields.push(cur)
        cur = ''
      } else {
        cur += ch
      }
    }
  }
  fields.push(cur)
  return fields
}

/**
 * 조회수 CSV 텍스트 파싱
 * - 헤더: 등록상품명, 등록상품ID, 상품조회수 (순서 유연 대응)
 * - 지원 형식: 일반 CSV, 따옴표 CSV, ="123" Excel 수식 형식
 * - BOM 자동 제거, 빈 행 무시, 천단위 콤마 처리
 */
export function parseViewsCsv(csvText: string): ViewsRow[] {
  const lines = csvText
    .replace(/^\uFEFF/, '')      // BOM 제거
    .split(/\r?\n/)
    .filter((l) => l.trim())

  if (lines.length < 2) return []

  // ── 헤더에서 컬럼 인덱스 자동 탐지 ─────────────────────────
  const header = parseCsvLine(lines[0]).map((h) => h.trim().replace(/^=/, '').replace(/^"|"$/g, ''))
  const findIdx = (...keywords: string[]) =>
    header.findIndex((h) => keywords.some((kw) => h.includes(kw)))

  let nameIdx = findIdx('상품명')
  let idIdx = findIdx('상품ID', '등록상품ID', '옵션ID')
  let viewIdx = findIdx('조회수')

  // 헤더가 없거나 인식 실패 시 기본 순서 (0,1,2) 가정
  if (nameIdx < 0) nameIdx = 0
  if (idIdx < 0) idIdx = 1
  if (viewIdx < 0) viewIdx = 2

  // ── 데이터 행 파싱 ─────────────────────────────────────────
  const result: ViewsRow[] = []
  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line)
    if (fields.length <= Math.max(nameIdx, idIdx, viewIdx)) continue

    // ID 정규화: ="123" → 123, 앞뒤 공백/따옴표 제거
    const rawId = fields[idIdx] ?? ''
    const item_id = rawId.trim().replace(/^=/, '').replace(/^"|"$/g, '').trim()

    // 조회수: 천단위 콤마 제거 후 정수 변환
    const rawView = (fields[viewIdx] ?? '').trim().replace(/,/g, '').replace(/^"|"$/g, '')
    const view = parseInt(rawView, 10)

    if (!item_id || isNaN(view)) continue

    result.push({
      item_name: (fields[nameIdx] ?? '').trim(),
      item_id,
      view,
    })
  }

  return result
}

/**
 * si_rg_views 에 조회수 upsert 저장 (동일 date+item_id+user_id → update)
 * @param date YYYY-MM-DD 형식 날짜
 */
export async function saveViewsData(
  data: ViewsRow[],
  userId: string,
  date: string,
): Promise<{ saved: number; errors: number }> {
  let saved = 0
  let errors = 0

  for (let i = 0; i < data.length; i += SUPABASE_BATCH_SIZE) {
    const batch = data.slice(i, i + SUPABASE_BATCH_SIZE).map((d) => ({
      item_id: d.item_id,
      item_name: d.item_name,
      view: d.view,
      date,
      user_id: userId,
    }))

    const { error } = await supabase
      .from('si_rg_views')
      .upsert(batch, { onConflict: 'date,item_id,user_id' })
    if (error) {
      console.error('[saveViewsData] UPSERT 오류:', error.message)
      errors += batch.length
    } else {
      saved += batch.length
    }
  }

  console.log(`[saveViewsData] 완료 — 저장: ${saved}, 실패: ${errors}`)
  return { saved, errors }
}

// ══════════════════════════════════════════════════════════════════
// 조회수: 데이터 조회 (si_rg_views → V1~V5 렌더링용)
// ══════════════════════════════════════════════════════════════════

/** si_rg_views 조회 행 (필요 컬럼만) */
export interface ViewsDataRow {
  item_id: string
  view: number
  date: string
}

/** si_rg_views 전체 조회 (1000건 배치 패턴, limit 없음) */
export async function fetchViewsData(userId: string): Promise<ViewsDataRow[]> {
  const batches: ViewsDataRow[][] = []
  let from = 0
  const batchSize = 1000
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from('si_rg_views')
      .select('item_id, view, date')
      .eq('user_id', userId)
      .range(from, from + batchSize - 1)

    if (error) {
      console.error('si_rg_views 조회 오류:', error)
      throw error
    }

    if (data && data.length > 0) {
      batches.push(data)
      from += batchSize
      if (data.length < batchSize) hasMore = false
    } else {
      hasMore = false
    }
  }

  const allData = batches.flat()
  console.log(`[purchaseService] si_rg_views ${allData.length}건 조회`)
  return allData
}

/**
 * 조회수 데이터 → 고유 날짜 추출 → 오래된순 정렬 → 최근 5개 반환
 * 반환: [V1(가장 오래된), V2, V3, V4, V5(가장 최근)]
 */
export function getRecentViewDates(viewsData: ViewsDataRow[]): string[] {
  const dates = [...new Set(viewsData.map((d) => d.date))].sort()
  return dates.slice(-5)
}

// ══════════════════════════════════════════════════════════════════
// 쉽먼트 사이즈 xlsx 업로드 (si_coupang_shipment_size)
// - 시트명 '상품별 사이즈 리포트' 검증
// - 17행부터 데이터 (index 16, 0-based)
// - 컬럼: A=item_id, B=option_id, C=sku_id, D=item_name,
//        E=option_name, F=shipment_size_before, G=shipment_size_after
// - Upsert 키: (user_id, option_id)
// ══════════════════════════════════════════════════════════════════

// ── 상수 ──────────────────────────────────────────────────────────
const SHIPMENT_SIZE_SHEET_NAME = '상품별 사이즈 리포트'
const SHIPMENT_SIZE_DATA_START_ROW = 16 // 0-based (엑셀 17행)

// ── 파싱 결과 인터페이스 ──────────────────────────────────────────
export interface ParseShipmentSizeResult {
  items: Omit<ShipmentSize, 'id'>[]
  skippedRows: number[] // option_id 누락으로 스킵된 엑셀 행번호 (1-based)
}

// ── 엑셀 파싱 ─────────────────────────────────────────────────────

/**
 * 쉽먼트 사이즈 엑셀 파싱
 * - 시트명이 '상품별 사이즈 리포트'가 아니면 Error throw
 * - item_id(A) 비어있는 행: 완전 스킵 (빈 말미 행)
 * - option_id(B) 비어있는 행: skippedRows에 엑셀 행번호(1-based) 추가 후 스킵
 */
export function parseShipmentSizeExcel(
  workbook: XLSX.WorkBook,
  userId: string,
): ParseShipmentSizeResult {
  const worksheet = workbook.Sheets[SHIPMENT_SIZE_SHEET_NAME]
  if (!worksheet) {
    throw new Error(`시트 "${SHIPMENT_SIZE_SHEET_NAME}"를 찾을 수 없습니다.`)
  }

  // 모든 셀을 문자열로 읽기 (raw 숫자 변환 방지)
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: null,
  }) as any[][]

  const toStr = (v: any): string | null => {
    if (v == null) return null
    const s = String(v).trim()
    return s === '' ? null : s
  }

  const items: Omit<ShipmentSize, 'id'>[] = []
  const skippedRows: number[] = []

  for (let i = SHIPMENT_SIZE_DATA_START_ROW; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue

    const itemId = toStr(row[0])
    // item_id 비어있는 행은 완전 스킵 (꼬리 빈 행)
    if (!itemId) continue

    const optionId = toStr(row[1])
    // option_id 비어있으면 엑셀 행번호(1-based) 기록 후 스킵
    if (!optionId) {
      skippedRows.push(i + 1)
      continue
    }

    items.push({
      item_id: itemId,
      option_id: optionId,
      sku_id: toStr(row[2]),
      item_name: toStr(row[3]),
      option_name: toStr(row[4]),
      shipment_size_before: toStr(row[5]),
      shipment_size_after: toStr(row[6]),
      user_id: userId,
    })
  }

  console.log(
    `[parseShipmentSizeExcel] ${items.length}건 파싱, ${skippedRows.length}건 스킵(option_id 누락)`,
  )
  return { items, skippedRows }
}

// ── 데이터 저장 (배치 upsert, onConflict: user_id,option_id) ──────

/**
 * si_coupang_shipment_size 에 배치 upsert
 * - (user_id, option_id) onConflict → 동일 유저의 같은 option_id 는 갱신
 * - SUPABASE_BATCH_SIZE(500) 로 배치, Promise.allSettled 병렬
 * - Prerequisite: DB UNIQUE(user_id, option_id) 제약 필수
 */
export async function saveShipmentSize(
  items: Omit<ShipmentSize, 'id'>[],
  userId: string,
): Promise<{ success: number; errors: number }> {
  if (items.length === 0) return { success: 0, errors: 0 }

  // user_id 강제 주입 (호출자 오남용 방지)
  const normalized = items.map((item) => ({ ...item, user_id: userId }))

  // 배치 분할
  const batches: Omit<ShipmentSize, 'id'>[][] = []
  for (let i = 0; i < normalized.length; i += SUPABASE_BATCH_SIZE) {
    batches.push(normalized.slice(i, i + SUPABASE_BATCH_SIZE))
  }

  // 병렬 upsert
  const results = await Promise.allSettled(
    batches.map((batch, idx) =>
      supabase
        .from('si_coupang_shipment_size')
        .upsert(batch, { onConflict: 'user_id,option_id' })
        .then(({ error }) => {
          if (error) {
            console.error(`si_coupang_shipment_size upsert 오류 (batch ${idx + 1}):`, error)
            throw error
          }
          return batch.length
        }),
    ),
  )

  // 결과 집계
  let success = 0
  let errors = 0
  for (const result of results) {
    if (result.status === 'fulfilled') {
      success += result.value
    } else {
      errors += SUPABASE_BATCH_SIZE
    }
  }

  console.log(
    `[purchaseService] si_coupang_shipment_size 저장 완료 — 성공: ${success}, 실패: ${errors}`,
  )
  return { success, errors }
}

// ══════════════════════════════════════════════════════════════════
// shipment_size 부분 조회 — option_id IN() 배치 쿼리
// - 대량 전체 로드 지양 (테이블 10만+ 예상)
// - 선택된 option_id 만 배치로 조회하여 Map 반환
// ══════════════════════════════════════════════════════════════════

const SHIPMENT_SIZE_IN_BATCH = 500 // .in() URL 길이 안전 한계

/**
 * si_coupang_shipment_size 에서 option_id 목록에 해당하는 shipment_size_before 조회
 * - 배치 크기 500: Supabase URL 길이 제약(약 16KB) 고려
 * - user_id 필터 필수 (다른 사용자 데이터 누출 방지)
 * @returns Map<option_id, shipment_size_before>
 */
export async function fetchShipmentSizesByOptionIds(
  userId: string,
  optionIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (!userId || optionIds.length === 0) return result

  // 중복 제거 (호출자 오용 방지)
  const uniqueIds = Array.from(new Set(optionIds.filter(Boolean)))

  for (let i = 0; i < uniqueIds.length; i += SHIPMENT_SIZE_IN_BATCH) {
    const batch = uniqueIds.slice(i, i + SHIPMENT_SIZE_IN_BATCH)
    const { data, error } = await supabase
      .from('si_coupang_shipment_size')
      .select('option_id, shipment_size_before')
      .eq('user_id', userId)
      .in('option_id', batch)

    if (error) {
      console.error(`[fetchShipmentSizesByOptionIds] 조회 오류 (batch ${i / SHIPMENT_SIZE_IN_BATCH + 1}):`, error)
      continue
    }

    for (const row of data ?? []) {
      if (row.option_id && row.shipment_size_before) {
        result.set(row.option_id, row.shipment_size_before)
      }
    }
  }

  console.log(
    `[fetchShipmentSizesByOptionIds] 요청 ${uniqueIds.length}건 중 ${result.size}건 매칭`,
  )
  return result
}
