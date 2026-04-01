import React, { useState } from 'react'
import { theme } from '../../styles/theme'
import type { StockSearchFilters } from '../../types/stock'

interface SearchFormProps {
  onSearch: (filters: StockSearchFilters) => void
}

const SearchForm: React.FC<SearchFormProps> = ({ onSearch }) => {
  const [filters, setFilters] = useState<StockSearchFilters>({
    location: '',
    season: '',
    note: '',
    searchType: 'productName',  // 기본값을 상품명으로 변경
    searchKeyword: '',
  })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFilters(prev => ({
      ...prev,
      [name]: value,
    }))
  }

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault()
    onSearch(filters)
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }


  return (
    <div
      style={{
        ...theme.card,
        padding: '20px',
        marginBottom: '20px',
      }}
    >
      <form onSubmit={handleSearch}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'stretch' }}>
          {/* 왼쪽 영역: 검색 입력폼들 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* 첫 번째 줄: 위치, 시즌, 비고 */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="text"
                name="location"
                value={filters.location}
                onChange={handleInputChange}
                onKeyPress={handleKeyPress}
                placeholder="위치"
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.radius.md,
                  fontSize: '14px',
                }}
              />
              <input
                type="text"
                name="season"
                value={filters.season}
                onChange={handleInputChange}
                onKeyPress={handleKeyPress}
                placeholder="시즌"
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.radius.md,
                  fontSize: '14px',
                }}
              />
              <input
                type="text"
                name="note"
                value={filters.note}
                onChange={handleInputChange}
                onKeyPress={handleKeyPress}
                placeholder="비고"
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.radius.md,
                  fontSize: '14px',
                }}
              />
            </div>

            {/* 두 번째 줄: 드롭박스와 검색 입력폼 */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <select
                name="searchType"
                value={filters.searchType}
                onChange={handleInputChange}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.radius.md,
                  fontSize: '14px',
                  backgroundColor: 'white',
                  cursor: 'pointer',
                }}
              >
                <option value="barcode">바코드</option>
                <option value="productName">상품명</option>
              </select>
              <input
                type="text"
                name="searchKeyword"
                value={filters.searchKeyword}
                onChange={handleInputChange}
                onKeyPress={handleKeyPress}
                placeholder={filters.searchType === 'barcode' ? '바코드 입력' : '상품명 입력'}
                style={{
                  flex: 3,
                  padding: '8px 12px',
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.radius.md,
                  fontSize: '14px',
                }}
              />
            </div>
          </div>

          {/* 오른쪽 영역: 검색 버튼 */}
          <button
            type="submit"
            style={{
              width: '100px',
              backgroundColor: theme.colors.primary,
              color: 'white',
              border: 'none',
              borderRadius: theme.radius.md,
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.colors.primaryHover)}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = theme.colors.primary)}
          >
            검색
          </button>
        </div>
      </form>
    </div>
  )
}

export default SearchForm