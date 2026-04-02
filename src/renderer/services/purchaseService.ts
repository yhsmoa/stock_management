/* ================================================================
   사입관리 (PurchaseManagement) 서비스
   - Vite 프록시를 통한 쿠팡 로켓그로스 API 호출
   - nextToken 순회로 전체 상품 수집
   - 병렬 배치 상세 조회 (동시 3건)
   - Supabase si_rg_items 테이블 CRUD
   ================================================================ */

import { supabase } from './supabase'
import type {
  RgItem,
  CoupangProductListItem,
  CoupangProductDetail,
} from '../types/purchase'

// ── 상수 ──────────────────────────────────────────────────────────
const DETAIL_CONCURRENCY = 3     // 상세 조회 동시 요청 수
const SUPABASE_BATCH_SIZE = 500  // Supabase insert 배치 크기

// ── 쿠팡 프록시 API — 상품 목록 (단일 페이지) ────────────────────────

/** 상품 목록 한 페이지 조회 (nextToken 기반) */
async function fetchRgProductPage(
  nextToken?: string,
  pageSize = 50,
): Promise<{ items: CoupangProductListItem[]; nextToken: string | null }> {
  const params = new URLSearchParams({ pageSize: String(pageSize) })
  if (nextToken) params.set('nextToken', nextToken)

  const res = await fetch(`/api/coupang/rg-products?${params}`)
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

// ── 쿠팡 프록시 API — 전체 상품 목록 수집 ────────────────────────────

/**
 * nextToken을 순회하며 전체 로켓그로스 상품 목록 수집
 * @param onProgress - 진행 콜백 (수집된 상품 수)
 */
export async function fetchAllRgProducts(
  onProgress?: (count: number) => void,
): Promise<CoupangProductListItem[]> {
  const allProducts: CoupangProductListItem[] = []
  let nextToken: string | undefined
  let page = 0

  do {
    const result = await fetchRgProductPage(nextToken, 50)
    allProducts.push(...result.items)
    nextToken = result.nextToken ?? undefined
    page++

    console.log(`[fetchAllRgProducts] 페이지 ${page}: ${result.items.length}건 (누적 ${allProducts.length}건)`)
    onProgress?.(allProducts.length)
  } while (nextToken)

  console.log(`[fetchAllRgProducts] 전체 완료: ${allProducts.length}개 상품`)
  return allProducts
}

// ── 쿠팡 프록시 API — 상품 상세 조회 ─────────────────────────────────

/** 로켓그로스 상품 상세 조회 (단건) */
export async function fetchRgProductDetail(
  sellerProductId: number,
): Promise<CoupangProductDetail> {
  const res = await fetch(`/api/coupang/rg-product/${sellerProductId}`)
  const json = await res.json()

  if (!json.success || json.data?.code !== 'SUCCESS') {
    throw new Error(json.error || json.data?.message || '상품 상세 조회 실패')
  }

  return json.data.data
}

// ── 병렬 배치 상세 조회 ──────────────────────────────────────────────

/**
 * 상품 ID 배열을 동시 N건씩 병렬 처리하여 상세 조회
 * - 실패한 상품은 건너뛰고 계속 진행
 * @param products - 상품 목록 (sellerProductId 포함)
 * @param userId - 사용자 ID
 * @param onProgress - 진행 콜백 (처리 완료 수, 전체 수)
 */
export async function fetchDetailsAndMap(
  products: CoupangProductListItem[],
  userId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Omit<RgItem, 'id' | 'created_at'>[]> {
  const allRows: Omit<RgItem, 'id' | 'created_at'>[] = []
  let done = 0

  // 동시 N건씩 병렬 처리
  for (let i = 0; i < products.length; i += DETAIL_CONCURRENCY) {
    const batch = products.slice(i, i + DETAIL_CONCURRENCY)

    const results = await Promise.allSettled(
      batch.map(async (product) => {
        try {
          const detail = await fetchRgProductDetail(product.sellerProductId)
          return mapToRgItems(detail, userId)
        } catch {
          // 상세 조회 실패 시 목록 데이터로 폴백
          return mapListItemToRgItems(product, userId)
        }
      }),
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allRows.push(...result.value)
      }
    }

    done += batch.length
    onProgress?.(done, products.length)
  }

  return allRows
}

// ── 데이터 매핑: 상세 API 응답 → si_rg_items 행 ──────────────────────

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
      ? `https://thumbnail6.coupangcdn.com/thumbnails/remote/230x230ex/${repImage.cdnPath}`
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
      seller_product_item_id: String(item.sellerProductItemId),
      vendeor_item_id: String(item.vendorItemId),   // DB 스키마 오타 유지
      barcode: item.barcode ?? null,
      external_vendor_sku: item.externalVendorSku ?? null,
      sale_price: item.salePrice ?? null,
      weight: null,
      width: null,
      length: null,
      height: null,
      user_id: userId,
    }
  })
}

// ── 데이터 매핑: 목록 API 응답 → si_rg_items 행 (폴백용) ─────────────

/**
 * 상세 조회 실패 시 목록 데이터만으로 기본 행 생성
 * - barcode, salePrice, imgUrl 등은 null
 */
function mapListItemToRgItems(
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
    vendeor_item_id: item.rocketGrowthItemData
      ? String(item.rocketGrowthItemData.vendorItemId)
      : null,
    barcode: null,
    external_vendor_sku: null,
    sale_price: null,
    weight: null,
    width: null,
    length: null,
    height: null,
    user_id: userId,
  }))
}

// ── Supabase CRUD ─────────────────────────────────────────────────

/** si_rg_items에서 사용자별 전체 조회 (1000건 배치 패턴) */
export async function fetchRgItems(userId: string): Promise<RgItem[]> {
  let allData: RgItem[] = []
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
      allData = [...allData, ...data]
      from += batchSize
      if (data.length < batchSize) hasMore = false
    } else {
      hasMore = false
    }
  }

  console.log(`[purchaseService] si_rg_items ${allData.length}건 조회`)
  return allData
}

/**
 * si_rg_items에 데이터 저장
 * - PK가 auto-generated uuid → delete 후 insert 방식
 * - 500건씩 배치 삽입
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

  // STEP 2: 새 데이터 일괄 삽입 (500건 배치)
  let success = 0
  let errors = 0

  for (let i = 0; i < items.length; i += SUPABASE_BATCH_SIZE) {
    const batch = items.slice(i, i + SUPABASE_BATCH_SIZE)
    const { error } = await supabase
      .from('si_rg_items')
      .insert(batch)

    if (error) {
      console.error(`si_rg_items insert 오류 (batch ${Math.floor(i / SUPABASE_BATCH_SIZE) + 1}):`, error)
      errors += batch.length
    } else {
      success += batch.length
    }
  }

  console.log(`[purchaseService] si_rg_items 저장 완료 — 성공: ${success}, 실패: ${errors}`)
  return { success, errors }
}
