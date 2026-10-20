/* ================================================================
   상품관리 — 상품 수정 타입 (상세 패널 [수정] 탭)
   - 배송·반품: 상품 수정(승인불필요, partial) — 바로 반영
   - 상품 정보 · 옵션 값: 상품 수정(승인필요, 전문 PUT) — 쿠팡 승인 뒤 반영
   - 설계: docs/plan-coupang-product-edit.md
   ================================================================ */

// ── 배송·반품 (partial) ─────────────────────────────────────────
export interface ShippingValues {
  deliveryMethod: string | null
  deliveryCompanyCode: string | null
  deliveryChargeType: string | null
  deliveryCharge: number | null
  freeShipOverAmount: number | null
  deliveryChargeOnReturn: number | null
  returnCharge: number | null
  remoteAreaDeliverable: string | null      // 'Y' | 'N'
  unionDeliveryType: string | null          // 'UNION_DELIVERY' | 'NOT_UNION_DELIVERY'
  outboundShippingTimeDay: number | null
}
export type ShippingEdits = Partial<ShippingValues>

// ── 상품 정보 (전문 PUT) ─────────────────────────────────────────
export interface ProductInfoValues {
  displayProductName: string
  sellerProductName: string
  brand: string
  manufacture: string
  saleStartedAt: string     // 'yyyy-MM-ddTHH:mm:ss'
  saleEndedAt: string
}
export type ProductInfoEdits = Partial<ProductInfoValues>

// ── 옵션 (전문 PUT) ─────────────────────────────────────────────
/** 옵션 값이 있는 곳 — 순수 일반상품은 item 바로 아래(flat), 하이브리드·로켓은 채널별 데이터 */
export type ChannelKey = 'flat' | 'mp' | 'rg'

export interface ChannelValues {
  barcode: string
  modelNo: string
  externalVendorSku: string
}
export type ChannelEdits = Partial<ChannelValues>

export interface ItemEdits {
  itemName?: string
  maximumBuyForPerson?: number
  maximumBuyForPersonPeriod?: number
  channels?: Partial<Record<ChannelKey, ChannelEdits>>
}

/** 재승인이 필요한 수정 묶음 — 키는 옵션 키(itemKey) */
export interface ProductEdits {
  info: ProductInfoEdits
  /** 검색태그 — 쿠팡은 옵션마다 있지만 화면에서는 상품 단위로 고쳐 모든 옵션에 넣는다 */
  searchTags?: string[]
  items: Record<string, ItemEdits>
  /**
   * 로켓그로스 입고 불가 조건 동의 — 로켓·하이브리드 상품을 수정하려면 쿠팡이 요구한다
   * (additionalInformationForRocketGrowth.legalAgreement = 'AGREE'). 사용자가 화면에서 직접 체크해야만 보낸다.
   */
  rocketGrowthAgreement?: boolean
}

// ── 화면용 보기 모델 (상세 응답 → 수정 폼) ──────────────────────
export interface EditableChannelView extends ChannelValues {
  key: ChannelKey
  label: string                 // '일반' | '로켓'
  vendorItemId: string | null
}

export interface EditableItemView {
  key: string                   // itemKey — 저장 직전에 다시 받은 응답과 옵션을 맞추는 키
  itemName: string
  maximumBuyForPerson: number | null
  maximumBuyForPersonPeriod: number | null
  channels: EditableChannelView[]
}

export interface EditableProductView {
  sellerProductId: string
  statusName: string | null
  kind: 'mp' | 'rg' | 'hybrid'
  info: ProductInfoValues
  searchTags: string[]
  /** 배송·반품 — 로켓그로스 전용 상품이면 null (쿠팡이 이 정보를 주지 않음) */
  shipping: ShippingValues | null
  items: EditableItemView[]
  /** 바꿀 수 없는 값 (보여 주기만) */
  readonly: { displayCategoryCode: number | null; offerCondition: string | null }
}
