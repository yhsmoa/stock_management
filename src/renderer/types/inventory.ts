// 재고 아이템 타입 정의
export interface InventoryItem {
  id?: string
  location: string        // 로케이션
  barcode: string        // 바코드
  productName: string    // 상품명
  optionName: string     // 옵션명
  quantity: number       // 개수
  incomingSize: string   // 입고사이즈
  season: string         // 시즌
  note: string           // 비고
}

// 검색 필터 타입
export interface SearchFilters {
  location: string
  season: string
  note: string
  searchType: 'barcode' | 'productName'  // 드롭다운 선택
  searchKeyword: string                   // 검색 키워드
}

// 테이블 헤더 설정
export const TABLE_HEADERS = [
  { key: 'checkbox', label: '', width: '3%' },  // 체크박스 열 추가
  { key: 'location', label: '로케이션', width: '5%' },  // 10% → 5% (절반)
  { key: 'barcode', label: '바코드', width: '10%' },  // 15% → 10% (2/3)
  { key: 'productName', label: '상품명', width: '20%' },
  { key: 'optionName', label: '옵션명', width: '15%' },
  { key: 'quantity', label: '개수', width: '8%' },
  { key: 'incomingSize', label: '입고사이즈', width: '12%' },
  { key: 'season', label: '시즌', width: '10%' },
  { key: 'note', label: '비고', width: '17%' },  // 10% → 17% (늘어난 만큼 확대)
]