/* ================================================================
   사입관리 (PurchaseManagement) 타입 정의
   - si_rg_items 테이블 매핑 인터페이스
   - 쿠팡 로켓그로스 API 응답 인터페이스
   ================================================================ */

// ── si_rg_items 테이블 행 인터페이스 ──────────────────────────────
export interface RgItem {
  id?: string
  created_at?: string
  seller_product_id: string
  status_name: string | null
  seller_product_name: string | null
  sale_started_at: string | null
  display_product_name: string | null
  general_product_name: string | null
  item_name: string | null
  img_url: string | null
  seller_product_item_id: string | null
  vendeor_item_id: string | null          // DB 스키마 오타 유지
  barcode: string | null
  external_vendor_sku: string | null
  sale_price: number | null
  weight: number | null
  width: number | null
  length: number | null
  height: number | null
  user_id: string | null
}

// ── 쿠팡 상품 목록 API 응답 (단일 상품) ───────────────────────────
export interface CoupangProductListItem {
  sellerProductId: number
  sellerProductName: string
  statusName: string
  saleStartedAt: string
  items: {
    itemName: string
    rocketGrowthItemData?: {
      sellerProductItemId: number
      vendorItemId: number
    }
  }[]
}

// ── 쿠팡 상품 상세 API 응답 ───────────────────────────────────────
export interface CoupangProductDetail {
  sellerProductId: number
  sellerProductName: string
  displayProductName: string
  generalProductName: string
  statusName: string
  saleStartedAt: string
  items: {
    sellerProductItemId: number
    vendorItemId: number
    itemName: string
    salePrice: number
    barcode: string | null
    externalVendorSku: string | null
    images: {
      imageOrder: number
      imageType: string
      cdnPath: string
      vendorPath: string
    }[]
  }[]
}
