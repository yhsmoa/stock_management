import React, { useState } from 'react'
import './PurchaseManagement.css'

/* ================================================================
   사입관리 (PurchaseManagement)
   - 상단: 타이틀(가운데) + 엑셀 버튼(오른쪽)
   - 검색폼: 타원형 검색바 (보드 없음)
   - 테이블: 화면 가득 채움, 컬럼 타이트
   - 데이터/스타일은 쿠팡관리와 완전 독립
   ================================================================ */

// ── 상수 ──────────────────────────────────────────────────────
const PAGE_SIZE = 100

// ── 컬럼 정의 ─────────────────────────────────────────────────
interface Column {
  key: string
  label: string
  width: string       // CSS width (colgroup)
  isProduct?: boolean // 상품정보 컬럼 여부 (좌측 정렬)
}

const COLUMNS: Column[] = [
  { key: 'product',  label: '상품정보', width: '220px', isProduct: true },
  { key: 'input',    label: '입력',     width: '52px' },
  { key: 'c_in',     label: 'C.in',     width: '52px' },
  { key: 'c_stock',  label: 'C.재고',   width: '56px' },
  { key: 'order',    label: '주문',     width: '52px' },
  { key: 'personal', label: '개인',     width: '52px' },
  { key: 'd7',       label: '7d',       width: '44px' },
  { key: 'd30',      label: '30d',      width: '48px' },
  { key: 'recommend',label: '추천',     width: '52px' },
  { key: 'warehouse',label: '창고',     width: '52px' },
  { key: 'storage',  label: '보관료',   width: '56px' },
  { key: 'v1',       label: 'V1',       width: '44px' },
  { key: 'v2',       label: 'V2',       width: '44px' },
  { key: 'v3',       label: 'V3',       width: '44px' },
  { key: 'v4',       label: 'V4',       width: '44px' },
  { key: 'v5',       label: 'V5',       width: '44px' },
  { key: 'price',    label: 'price',    width: '60px' },
  { key: 'margin',   label: 'margin',   width: '60px' },
  { key: 'note',     label: 'note',     width: '80px' },
]

const PurchaseManagement: React.FC = () => {
  /* ── 검색 상태 ─────────────────────────────────────────────── */
  const [searchValue, setSearchValue] = useState('')

  /* ── 데이터 & 페이지네이션 상태 ────────────────────────────── */
  const [items] = useState<any[]>([])
  const [loading] = useState(false)
  const [totalCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)

  /* ── 체크박스 상태 ─────────────────────────────────────────── */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  /* ── 검색 핸들러 (추후 구현) ───────────────────────────────── */
  const handleSearch = () => {
    // TODO: Supabase 쿼리 연결
    console.log('검색:', searchValue)
  }

  /* ── 전체 선택 / 해제 ──────────────────────────────────────── */
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(items.map((_, i) => String(i))))
    } else {
      setSelectedIds(new Set())
    }
  }

  /* ── 개별 선택 ─────────────────────────────────────────────── */
  const handleSelectRow = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      checked ? next.add(id) : next.delete(id)
      return next
    })
  }

  /* ── 페이지 변경 핸들러 ────────────────────────────────────── */
  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages) return
    setCurrentPage(page)
    // TODO: 해당 페이지 데이터 fetch
  }

  /* ── 페이지 번호 배열 생성 ─────────────────────────────────── */
  const getPageNumbers = () => {
    const pages: (number | string)[] = []
    const maxVisible = 5

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else if (currentPage <= 3) {
      for (let i = 1; i <= maxVisible; i++) pages.push(i)
      if (totalPages > maxVisible) { pages.push('...'); pages.push(totalPages) }
    } else if (currentPage >= totalPages - 2) {
      pages.push(1); pages.push('...')
      for (let i = totalPages - maxVisible + 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1); pages.push('...')
      for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i)
      pages.push('...'); pages.push(totalPages)
    }
    return pages
  }

  // ════════════════════════════════════════════════════════════
  // 렌더링
  // ════════════════════════════════════════════════════════════
  return (
    <div className="purchase-container">

      {/* ── 상단 헤더: 타이틀(가운데) + 버튼(오른쪽) ──────────── */}
      <div className="purchase-header">
        <h1 className="purchase-title">사입관리</h1>
        <div className="purchase-header-actions">
          <label className="purchase-btn" style={{ cursor: 'pointer' }}>
            엑셀 업로드
            <input
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={() => { /* TODO: 엑셀 업로드 핸들러 */ }}
            />
          </label>
          <button
            className="purchase-btn"
            onClick={() => { /* TODO: 엑셀 저장 핸들러 */ }}
          >
            엑셀 저장하기
          </button>
        </div>
      </div>

      {/* ── 검색 입력폼 (타원형, 가운데 상단) ────────────────── */}
      <div className="purchase-search-bar">
        <input
          className="purchase-search-input"
          type="text"
          placeholder="검색어를 입력하세요"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
        />
      </div>

      {/* ── 테이블 섹션 (화면 가득) ──────────────────────────── */}
      <div className="purchase-table-section">
        {loading ? (
          <div className="purchase-loading">데이터를 불러오는 중...</div>
        ) : (
          <>
            <div className="purchase-table-wrapper">
              <table className="purchase-table">
                {/* ── colgroup: 열 너비 정의 ────────────────── */}
                <colgroup>
                  <col style={{ width: '34px' }} /> {/* 체크박스 */}
                  {COLUMNS.map((c) => (
                    <col key={c.key} style={{ width: c.width }} />
                  ))}
                </colgroup>

                {/* ── thead ─────────────────────────────────── */}
                <thead>
                  <tr>
                    <th className="col-checkbox">
                      <input
                        type="checkbox"
                        className="purchase-checkbox"
                        checked={items.length > 0 && selectedIds.size === items.length}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                      />
                    </th>
                    {COLUMNS.map((c) => (
                      <th key={c.key} className={c.isProduct ? 'col-product' : ''}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>

                {/* ── tbody ─────────────────────────────────── */}
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td
                        colSpan={COLUMNS.length + 1}
                        className="purchase-table-empty"
                      >
                        데이터가 없습니다
                      </td>
                    </tr>
                  ) : (
                    items.map((_item, idx) => {
                      const rowId = String(idx)
                      return (
                        <tr key={rowId}>
                          <td>
                            <input
                              type="checkbox"
                              className="purchase-checkbox"
                              checked={selectedIds.has(rowId)}
                              onChange={(e) => handleSelectRow(rowId, e.target.checked)}
                            />
                          </td>
                          {COLUMNS.map((c) => (
                            <td key={c.key} className={c.isProduct ? 'col-product' : ''}>
                              -
                            </td>
                          ))}
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* ── 페이지네이션 ───────────────────────────────── */}
            <div className="purchase-pagination">
              <span className="purchase-pagination-info">
                전체 {totalCount.toLocaleString()}개 중{' '}
                {totalCount > 0 ? ((currentPage - 1) * PAGE_SIZE + 1).toLocaleString() : 0}
                {' - '}
                {Math.min(currentPage * PAGE_SIZE, totalCount).toLocaleString()} 표시
              </span>

              <div className="purchase-pagination-controls">
                <button
                  className="purchase-pagination-btn"
                  disabled={currentPage === 1}
                  onClick={() => handlePageChange(currentPage - 1)}
                >
                  이전
                </button>

                {getPageNumbers().map((p, i) =>
                  typeof p === 'string' ? (
                    <span key={`e-${i}`} className="purchase-pagination-ellipsis">{p}</span>
                  ) : (
                    <button
                      key={p}
                      className={`purchase-pagination-btn${currentPage === p ? ' active' : ''}`}
                      onClick={() => handlePageChange(p)}
                    >
                      {p}
                    </button>
                  )
                )}

                <button
                  className="purchase-pagination-btn"
                  disabled={currentPage === totalPages}
                  onClick={() => handlePageChange(currentPage + 1)}
                >
                  다음
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default PurchaseManagement
