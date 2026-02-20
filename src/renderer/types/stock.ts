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

// 테이블 헤더 정의
export const STOCK_TABLE_HEADERS = [
  { key: 'checkbox', label: '', width: '3%' },
  { key: 'location', label: '로케이션', width: '10%' },
  { key: 'barcode', label: '바코드', width: '10%' },
  { key: 'item_name', label: '상품명', width: '25%' },
  { key: 'option_name', label: '옵션명', width: '12.5%' },
  { key: 'qty', label: '개수', width: '5%' },
  { key: 'season', label: '시즌', width: '10%' },
  { key: 'note', label: '비고', width: '24.5%' },
] as const