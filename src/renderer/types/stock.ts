// si_stocks 테이블 타입 정의
export interface Stock {
  id: string
  location: string | null
  barcode: string
  item_name: string | null
  option_name: string | null
  qty: number | null
  season: string | null
  note: string | null
  seller_id?: string | null
  user_id?: string | null
}

// 검색 필터 타입
export interface StockSearchFilters {
  searchKeyword: string
  searchType: 'barcode' | 'productName'
  location: string
  season: string
  note: string
}

// ── 재고관리 표 열 정의 ─────────────────────────────────────────
//   width 를 비운 열(상품명)이 남는 폭을 가진다 (table-layout: fixed)
//   isText = 왼쪽 정렬 + 마우스를 올리면 전체 글자(title)
export interface StockTableColumn {
  key: 'location' | 'barcode' | 'item_name' | 'option_name' | 'qty' | 'season' | 'note'
  label: string
  width?: string
  isText?: boolean
}

export const STOCK_TABLE_COLUMNS: readonly StockTableColumn[] = [
  { key: 'location',    label: '로케이션', width: '120px' },
  { key: 'barcode',     label: '바코드',   width: '140px' },
  { key: 'item_name',   label: '상품명',   isText: true },
  { key: 'option_name', label: '옵션명',   width: '180px', isText: true },
  { key: 'qty',         label: '개수',     width: '70px' },
  { key: 'season',      label: '시즌',     width: '100px' },
  { key: 'note',        label: '비고',     width: '220px', isText: true },
]