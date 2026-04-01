// ── si_shipment_list 테이블 타입 (출고 리스트) ───────────────────────
export interface Shipment {
  id: string
  created_at: string
  barcode: string | null
  item_name: string | null
  option_name: string | null
  qty: number | null              // 요청개수 (shipmentQty)
  coupang_shipment_size: string | null
  location: string | null
  user_id: string | null
}

// ── si_shipment_scan 테이블 타입 (스캔 데이터) ───────────────────────
export interface ShipmentScan {
  id: string
  created_at: string
  barcode: string | null
  item_name: string | null
  option_name: string | null
  qty: number | null
  coupang_shipment_size: string | null
  location: string | null        // 재고 위치 (원래 자리)
  shipment_box: string | null    // 출고 박스 위치
  user_id: string | null
}

// ── 출고리스트 테이블 행 (in-memory, UI 전용) ───────────────────────
export interface ShipmentRow {
  id: string                     // client-generated
  barcode: string
  item_name: string
  option_name: string
  shipmentQty: number            // 출고개수 (슬라이드 패널 입력값)
  coupangShipmentSize: string    // 쿠팡사이즈 (si_coupang_items.package_type)
  stockLocations: StockLocationInfo[]
}

// ── 바코드별 재고 위치 정보 ─────────────────────────────────────────
export interface StockLocationInfo {
  location: string
  qty: number                    // 해당 위치의 재고수량
  scannedQty: number             // 스캔으로 처리된 수량 (default 0)
  shipmentBox: string | null     // 스캔 시 기록된 박스위치
}

// ── 스캔 워크플로 상태 ──────────────────────────────────────────────
export type ScanStep = 'box' | 'location' | 'barcode'

export interface ScanState {
  activeStep: ScanStep
  boxValue: string
  locationValue: string
  barcodeValue: string
}

// ── 테이블 헤더 정의 ────────────────────────────────────────────────
export const SHIPMENT_TABLE_HEADERS = [
  { key: 'barcode',             label: '바코드',      width: '12%' },
  { key: 'item_name',           label: '상품명',      width: '18%' },
  { key: 'option_name',         label: '옵션명',      width: '13%' },
  { key: 'shipmentQty',         label: '요청개수',    width: '7%'  },
  { key: 'coupangShipmentSize', label: '쿠팡사이즈',  width: '9%'  },
  { key: 'processing',          label: '처리',        width: '33%' },
  { key: 'scannedTotal',        label: '개수',        width: '8%'  },
] as const
