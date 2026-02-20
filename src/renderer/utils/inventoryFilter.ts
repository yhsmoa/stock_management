import type { InventoryItem, SearchFilters } from '../types/inventory'

/**
 * 재고 데이터를 필터링하는 유틸리티 함수
 */
export const filterInventoryItems = (
  items: InventoryItem[],
  filters: SearchFilters
): InventoryItem[] => {
  return items.filter(item => {
    // 위치 필터
    if (filters.location && !item.location.toLowerCase().includes(filters.location.toLowerCase())) {
      return false
    }

    // 시즌 필터
    if (filters.season && !item.season.toLowerCase().includes(filters.season.toLowerCase())) {
      return false
    }

    // 비고 필터
    if (filters.note && !item.note.toLowerCase().includes(filters.note.toLowerCase())) {
      return false
    }

    // 키워드 검색 (바코드 또는 상품명)
    if (filters.searchKeyword) {
      const keyword = filters.searchKeyword.toLowerCase()

      if (filters.searchType === 'barcode') {
        return item.barcode.toLowerCase().includes(keyword)
      } else if (filters.searchType === 'productName') {
        return item.productName.toLowerCase().includes(keyword)
      }
    }

    return true
  })
}

/**
 * 검색 필터가 비어있는지 확인
 */
export const isFiltersEmpty = (filters: SearchFilters): boolean => {
  return (
    !filters.location &&
    !filters.season &&
    !filters.note &&
    !filters.searchKeyword
  )
}