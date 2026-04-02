/* ================================================================
   사입관리 (PurchaseManagement) 서비스
   - Vite 프록시를 통한 쿠팡 로켓그로스 API 호출
   - nextToken 순회로 전체 상품 수집
   - 큐 기반 동시 상세 조회 (초당 5회 제한 준수, retry with backoff)
   - Supabase si_rg_items 테이블 CRUD
   ================================================================ */

import { supabase } from './supabase'
import type {
  RgItem,
  RgItemData,
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
      item_name: item.itemName ?? null,
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
    item_name: item.itemName ?? null,
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
      recent_sales_7d: toStr(row[10]),
      recent_sales_30d: toStr(row[11]),
      recent_sales_qty_7d: toStr(row[12]),
      recent_sales_qty_30d: toStr(row[13]),
      recommended_inbound_qty: toStr(row[14]),
      recommended_inbound_date: toStr(row[15]),
      days_of_cover: toStr(row[16]),
      monthly_storage_fee: toStr(row[17]),
      sku_age_1_30d: toStr(row[18]),
      sku_age_31_45d: toStr(row[19]),
      sku_age_46_60d: toStr(row[20]),
      sku_age_61_120d: toStr(row[21]),
      sku_age_121_180d: toStr(row[22]),
      sku_age_181_plus: toStr(row[23]),
      customer_returns_30d: toStr(row[24]),
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
