/* ================================================================
   상품관리 (CoupangManagement) 타입 정의
   - si_coupang_items 행 (옵션 1개 = 1행, PK option_id)
   - 쿠팡 상품 API 응답 (목록 · 상세 · 이력)
   - 화면 필터 · 동기화 진행 상태
   ================================================================ */

// ── 출처 구분 ────────────────────────────────────────────────────
//   'MP' = 판매자배송(일반) 옵션, 'RG' = 로켓그로스 옵션.
//   null 은 엑셀로만 들어온 예전 행 → 바코드가 있으면 RG 로 본다 (2026-10-20 실측: 바코드 행 14,356건 전부 RG 옵션)
export type CoupangChannel = 'MP' | 'RG'

// ── si_coupang_items 행 ───────────────────────────────────────────
export interface CoupangProductRow {
  option_id: string
  user_id: string | null
  item_id: string | null          // 등록상품 ID (sellerProductId)
  product_id: string | null       // 노출상품 ID (productId) — 승인된 상품만
  item_status: string | null      // 새상품 / 중고 (offerCondition)
  barcode: string | null
  item_code: string | null        // 업체상품코드 (externalVendorSku)
  product_name: string | null     // 쿠팡 노출 상품명 (displayProductName)
  item_name: string | null        // 업체 등록 상품명 (sellerProductName)
  option_name: string | null      // 등록 옵션명 (itemName)
  price: number | null            // 판매가
  regular_price: number | null    // 할인율 기준가
  sales_status: string | null     // '판매중' | '판매중지'
  stock: number | null            // 잔여수량
  sales_data: number | null       // 판매수량 (엑셀 전용 — API 에 없음)
  coupang_approval: string | null // 승인상태 (statusName)
  package_type: string | null     // 분류 (직접 입력)
  note: string | null             // 비고 (직접 입력)
  season: string | null           // 시즌 (직접 입력)
  channel: CoupangChannel | null
  img_url: string | null
  delivery_charge_type: string | null
  delivery_charge: number | null
  free_ship_over_amount: number | null
  detail_synced_at: string | null   // 상세 API 로 받은 시각
  status_checked_at: string | null  // 판매상태 API 로 확인한 시각
  app_changed_at: string | null     // 이 앱에서 가격·재고·상태를 바꾼 시각
  excel_synced_at: string | null    // 가격/재고 엑셀로 반영된 시각
  /**
   * 고시정보 (상세 받기 때 저장) — null = 아직 받은 적 없음, [] = 받았지만 없음.
   * 목록 조회(ROW_COLUMNS)에는 싣지 않아 보통 undefined — 상세 패널이 fetchProductNotices 로 따로 받는다
   */
  notices?: CoupangNotice[] | null
  /** 혼용률 — 고시정보 "제품 소재"/"소재" 값 (라벨 소재란). 안내 문구뿐이면 null */
  composition: string | null
}

/** 고시정보 한 칸 (쿠팡 notices[] 를 줄인 모양) */
export interface CoupangNotice {
  category: string   // 고시정보 분류 (noticeCategoryName) — 예: 의류
  name: string       // 항목명 (noticeCategoryDetailName) — 예: 제품 소재
  content: string    // 값 — 예: COTTON 80 POLYESTER 20
}

/** 행의 출처 — channel 이 없으면 바코드 유무로 판단 */
export function rowChannel(row: Pick<CoupangProductRow, 'channel' | 'barcode'>): CoupangChannel {
  if (row.channel) return row.channel
  return row.barcode ? 'RG' : 'MP'
}

// ── 화면에서 상품 단위로 묶은 것 ───────────────────────────────────
export interface CoupangProductGroup {
  itemId: string
  rows: CoupangProductRow[]       // 이 페이지에 보이는 옵션 행
  itemName: string                // 등록상품명
  productId: string | null
  approval: string | null
  imgUrl: string | null
  /** 상품 전체 옵션 요약 (페이지에 안 보이는 옵션 포함) */
  summary: CoupangProductSummary | null
}

/** 상품의 전체 옵션 요약 (fetchProductSummaries) */
export interface CoupangProductSummary {
  totalOptions: number
  mpOptions: number
  rgOptions: number
  onSale: number
  imgUrl: string | null
  productId: string | null
  detailSynced: boolean           // 옵션 중 하나라도 상세를 받았는지
}

/** 상품 구분 표시 — 전체(로켓+일반) · 일반 · 로켓 */
export type CoupangProductKind = 'hybrid' | 'mp' | 'rg'

export function productKind(summary: CoupangProductSummary | null, rows: CoupangProductRow[]): CoupangProductKind {
  const mp = summary ? summary.mpOptions : rows.filter((r) => rowChannel(r) === 'MP').length
  const rg = summary ? summary.rgOptions : rows.filter((r) => rowChannel(r) === 'RG').length
  if (mp > 0 && rg > 0) return 'hybrid'
  return rg > 0 ? 'rg' : 'mp'
}

// ── 화면 필터 ────────────────────────────────────────────────────
export type ChannelFilter = 'all' | 'MP' | 'RG'
export type SalesFilter = 'all' | 'on' | 'off' | 'zeroStock' | 'unchecked'
export type ApprovalFilter = 'all' | 'pending'
export type SearchField = 'name' | 'optionId' | 'barcode' | 'itemCode' | 'itemId'

export interface CoupangProductFilters {
  channel: ChannelFilter
  sales: SalesFilter
  approval: ApprovalFilter
  searchField: SearchField
  search: string
}

export const SEARCH_FIELD_LABELS: Record<SearchField, string> = {
  name: '상품명',
  optionId: '옵션 ID',
  barcode: '바코드',
  itemCode: '업체상품코드',
  itemId: '등록상품 ID',
}

/** 판매상태 필터별 건수 (필터 칩에 표시) */
export type SalesCounts = Record<SalesFilter, number>

// ── 동기화 요약 (머리 카드) ─────────────────────────────────────────
export interface CoupangSyncSummary {
  totalRows: number
  detailMissing: number        // detail_synced_at 이 없는 행
  noticesReceived: number      // 고시정보를 받은 행 (notices 가 null 이 아님)
  statusUnchecked: number      // 판매상태 값이 없는 행 (API 로도 엑셀로도 받은 적 없음)
  lastDetailAt: string | null
  lastStatusAt: string | null  // API 확인 · 엑셀 반영 중 최근
  lastExcelAt: string | null
}

// ── 동기화 진행 상태 (모달) ─────────────────────────────────────────
export type SyncKind = 'list' | 'detail' | 'status' | 'change' | 'excel'

export interface SyncProgress {
  kind: SyncKind
  title: string
  running: boolean
  done: number
  total: number
  message: string
  errors: string[]
  /** 끝난 뒤 요약 문장 */
  result: string | null
}

// ══════════════════════════════════════════════════════════════════
// 쿠팡 상품 API 응답
// ══════════════════════════════════════════════════════════════════

// ── 목록 (seller-products) — 일반 목록엔 items 가 없고, 로켓그로스 목록(businessTypes=rocketGrowth)엔 있다 ──
export interface ApiListItemData {
  sellerProductItemId?: number | null
  vendorItemId?: number | null
}

export interface ApiListProduct {
  sellerProductId: number
  sellerProductName?: string | null
  productId?: number | null
  statusName?: string | null
  saleStartedAt?: string | null
  createdAt?: string | null
  brand?: string | null
  registrationType?: string | null   // 'NORMAL' | 'RFM' …
  items?: {
    itemName?: string | null
    /** 목록은 대문자 P (marketPlaceItemData), 상세는 소문자 p (marketplaceItemData) — 둘 다 받는다 */
    marketPlaceItemData?: ApiListItemData | null
    marketplaceItemData?: ApiListItemData | null
    rocketGrowthItemData?: ApiListItemData | null
  }[] | null
}

// ── 상세 (seller-products/{id}) ──
export interface ApiDetailImage {
  imageOrder: number
  imageType: string
  cdnPath: string
  vendorPath: string
}

export interface ApiDetailAttribute {
  attributeTypeName?: string | null
  attributeValueName?: string | null
  exposed?: string | null        // 'EXPOSED'(구매옵션) | 'NONE'(검색옵션)
}

/** 하이브리드 상세의 옵션별 채널 데이터 (marketplaceItemData / rocketGrowthItemData) */
export interface ApiDetailItemData {
  sellerProductItemId?: number | null
  vendorItemId?: number | null
  itemId?: number | null
  externalVendorSku?: string | null
  barcode?: string | null
  maximumBuyCount?: number | null
  modelNo?: string | null
  isAutoGenerated?: boolean | null
  priceData?: { originalPrice?: number | null; salePrice?: number | null; supplyPrice?: number | null } | null
}

export interface ApiDetailItem {
  itemName?: string | null
  offerCondition?: string | null
  // ── 순수 일반상품 (평평한 모양) ──
  sellerProductItemId?: number | null
  vendorItemId?: number | null
  salePrice?: number | null
  originalPrice?: number | null
  maximumBuyCount?: number | null
  barcode?: string | null
  externalVendorSku?: string | null
  isAutoGenerated?: boolean | null
  outboundShippingTimeDay?: number | null
  maximumBuyForPerson?: number | null
  // ── 하이브리드 (채널별 데이터) ──
  marketplaceItemData?: ApiDetailItemData | null
  marketPlaceItemData?: ApiDetailItemData | null
  rocketGrowthItemData?: ApiDetailItemData | null
  images?: ApiDetailImage[] | null
  attributes?: ApiDetailAttribute[] | null
  searchTags?: string[] | null
  notices?: ApiDetailNotice[] | null
}

/** 상세 응답의 고시정보 한 칸 */
export interface ApiDetailNotice {
  noticeCategoryName?: string | null
  noticeCategoryDetailName?: string | null
  content?: string | null
}

export interface ApiShippingInfo {
  deliveryMethod?: string | null
  deliveryCompanyCode?: string | null
  deliveryChargeType?: string | null
  deliveryCharge?: number | null
  freeShipOverAmount?: number | null
  deliveryChargeOnReturn?: number | null
  returnCharge?: number | null
  unionDeliveryType?: string | null
  returnAddress?: string | null
  returnAddressDetail?: string | null
  returnChargeName?: string | null
}

export interface ApiProductDetail extends ApiShippingInfo {
  sellerProductId: number
  sellerProductName?: string | null
  displayProductName?: string | null
  statusName?: string | null
  productId?: number | null
  brand?: string | null
  manufacture?: string | null
  saleStartedAt?: string | null
  saleEndedAt?: string | null
  displayCategoryCode?: number | null
  registrationType?: string | null
  /** 하이브리드 상세에서는 배송·반품이 여기에 들어 있다 (로켓그로스 전용이면 null) */
  marketplaceShippingAndReturnInfo?: ApiShippingInfo | null
  items?: ApiDetailItem[] | null
}

// ── 상태 변경 이력 ──
export interface ApiProductHistory {
  statusName?: string | null
  comment?: string | null
  createdBy?: string | null
  createdAt?: string | null
}

// ── 분류 드롭박스 ────────────────────────────────────────────────
export const PACKAGE_TYPE_OPTIONS = ['출고', '렉', '박스', '시즌오프', '폐기', '기타'] as const
export type PackageType = typeof PACKAGE_TYPE_OPTIONS[number]
