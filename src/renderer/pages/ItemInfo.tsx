/* ================================================================
   상품정보 페이지 (/item-info)
   - 헤더 4컬럼: 모델명 / 바코드 / 혼용률 / 추천연령
   - 인라인 편집 + [저장] 1개 버튼 (PurchaseManagement 패턴 차용)
   - CSS 는 PurchaseManagement.css 그대로 재사용
   ================================================================ */

import React from 'react'
import './PurchaseManagement.css'
import { useItemInfo, COLUMNS, type ItemInfoColKey } from './useItemInfo'

const ItemInfo: React.FC = () => {
  const {
    loading,
    saving,

    searchValue,
    setSearchValue,
    handleSearch,
    currentPage,
    setCurrentPage,
    filteredCount,
    totalPages,
    pagedItems,
    getPageNumbers,

    editingCell,
    editingCellValue,
    getCellValue,
    handleCellClick,
    handleCellChange,
    handleCellBlur,
    pendingEdits,

    newRowDraft,
    handleNewRowChange,

    handleSave,
  } = useItemInfo()

  // ── 신규 입력 슬롯 input 렌더러 ─────────────────────────────
  const renderNewRowInput = (colKey: ItemInfoColKey) => (
    <input
      className="purchase-input-cell"
      type="text"
      value={newRowDraft[colKey]}
      onChange={(e) => handleNewRowChange(colKey, e.target.value)}
      placeholder={colKey === 'barcode' ? '바코드 (필수)' : ''}
    />
  )

  // ── 기존 행 셀 렌더러 (인라인 편집) ─────────────────────────
  const renderEditableCell = (rowId: string, colKey: ItemInfoColKey, currentValue: string) => {
    const isEditing = editingCell && editingCell.rowId === rowId && editingCell.colKey === colKey
    if (isEditing) {
      return (
        <input
          className="purchase-input-cell"
          type="text"
          autoFocus
          value={editingCellValue}
          onFocus={(e) => e.target.select()}
          onChange={(e) => handleCellChange(e.target.value)}
          onBlur={handleCellBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              handleCellBlur()
            }
          }}
        />
      )
    }
    return (
      <div
        className="purchase-cell-clickable"
        onClick={() => handleCellClick(rowId, colKey, currentValue)}
      >
        {currentValue || <span style={{ color: '#9CA3AF' }}>—</span>}
      </div>
    )
  }

  // ── 페이지네이션 표시 (PurchaseManagement 패턴) ─────────────
  const pageNumbers = getPageNumbers()

  return (
    <div className="purchase-container">
      {/* ── 상단 액션 (좌측 비움, 우측 저장) ───────────────────── */}
      <div className="purchase-top-actions">
        <div className="purchase-toolbar-left"></div>
        <div className="purchase-toolbar-right">
          <button
            className="purchase-btn purchase-save-btn"
            onClick={handleSave}
            disabled={saving}
          >
            {saving
              ? '저장 중...'
              : `저장${pendingEdits.size > 0 ? ` (${pendingEdits.size})` : ''}`}
          </button>
        </div>
      </div>

      {/* ── 타이틀 ─────────────────────────────────────────────── */}
      <div className="purchase-header">
        <h1 className="purchase-title">상품정보</h1>
      </div>

      {/* ── 검색바 ─────────────────────────────────────────────── */}
      <div className="purchase-search-bar">
        <input
          className="purchase-search-input"
          type="text"
          placeholder="모델명 또는 바코드로 검색"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
        />
      </div>

      {/* ── 필터 툴바 (좌측 비움, 우측은 위 상단 액션과 중복이라 비움) */}
      <div className="purchase-table-toolbar">
        <div className="purchase-toolbar-left">
          <span className="purchase-filter-count">
            {filteredCount.toLocaleString()}건
          </span>
        </div>
        <div className="purchase-toolbar-right"></div>
      </div>

      {/* ── 테이블 섹션 ───────────────────────────────────────── */}
      <div className="purchase-table-section">
        {loading ? (
          <div className="purchase-loading">데이터를 불러오는 중...</div>
        ) : (
          <>
            <div className="purchase-table-wrapper">
              <table className="purchase-table">
                <colgroup>
                  {COLUMNS.map((c) => (
                    <col key={c.key} style={{ width: '25%' }} />
                  ))}
                </colgroup>

                <thead>
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {/* ── 신규 입력 슬롯 (페이지 1 최상단) ─────── */}
                  {currentPage === 1 && (
                    <tr>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="col-input">
                          {renderNewRowInput(c.key)}
                        </td>
                      ))}
                    </tr>
                  )}

                  {/* ── 기존 행 ─────────────────────────────── */}
                  {pagedItems.map((row) => (
                    <tr key={row.id}>
                      {COLUMNS.map((c) => {
                        const value = getCellValue(row, c.key)
                        return (
                          <td key={c.key} className="col-input">
                            {renderEditableCell(row.id, c.key, value)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}

                  {pagedItems.length === 0 && currentPage !== 1 && (
                    <tr>
                      <td colSpan={COLUMNS.length} className="purchase-empty">
                        데이터가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* ── 페이지네이션 ────────────────────────────────── */}
            <div className="purchase-pagination">
              <div className="purchase-pagination-controls">
                <button
                  className="purchase-pagination-btn"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  이전
                </button>
                {pageNumbers.map((p, i) =>
                  p === 'ellipsis' ? (
                    <span key={`e${i}`} className="purchase-pagination-ellipsis">…</span>
                  ) : (
                    <button
                      key={p}
                      className={`purchase-pagination-btn${currentPage === p ? ' active' : ''}`}
                      onClick={() => setCurrentPage(p)}
                    >
                      {p}
                    </button>
                  ),
                )}
                <button
                  className="purchase-pagination-btn"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
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

export default ItemInfo
