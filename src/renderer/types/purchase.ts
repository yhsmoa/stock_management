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
  vendor_item_id: string | null             // 쿠팡 vendorItemId → DB vendor_item_id
  barcode: string | null
  external_vendor_sku: string | null
  sale_price: number | null
  input: number | null                     // 사용자 입력 수량
  weight: number | null
  width: number | null
  length: number | null
  height: number | null
  user_id: string | null
}

// ── si_rg_item_data 테이블 행 인터페이스 (재고건강 SKU 엑셀) ────────
export interface RgItemData {
  id?: string
  created_at?: string
  user_id: string
  item_id: number | null
  option_id: number | null
  sku_id: number | null
  item_name: string | null
  option_name: string | null
  offer_condition: string | null
  orderable_qty: number | null
  pending_inbounds: number | null
  item_winner: string | null
  recent_sales_7d: string | null
  recent_sales_30d: string | null
  recent_sales_qty_7d: string | null
  recent_sales_qty_30d: string | null
  recommended_inbound_qty: string | null
  recommended_inbound_date: string | null
  days_of_cover: string | null
  monthly_storage_fee: string | null
  sku_age_1_30d: string | null
  sku_age_31_45d: string | null
  sku_age_46_60d: string | null
  sku_age_61_120d: string | null
  sku_age_121_180d: string | null
  sku_age_181_plus: string | null
  customer_returns_30d: string | null
  season: string | null
  product_listing_date: string | null
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
// 로켓그로스 상품은 ID가 직접 또는 rocketGrowthItemData 안에 위치할 수 있음
export interface CoupangProductDetail {
  sellerProductId: number
  sellerProductName: string
  displayProductName: string
  generalProductName: string
  statusName: string
  saleStartedAt: string
  items: {
    sellerProductItemId?: number
    vendorItemId?: number
    itemName: string
    salePrice?: number
    barcode?: string | null
    externalVendorSku?: string | null
    rocketGrowthItemData?: {
      sellerProductItemId: number
      vendorItemId: number
      barcode?: string | null
      externalVendorSku?: string | null
      priceData?: {
        originalPrice: number
        salePrice: number
        supplyPrice: number
      }
      skuInfo?: {
        weight: number | null
        width: number | null
        length: number | null
        height: number | null
      }
    }
    images?: {
      imageOrder: number
      imageType: string
      cdnPath: string
      vendorPath: string
    }[]
  }[]
}
