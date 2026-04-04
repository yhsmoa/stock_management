/* ================================================================
   사입관리 (PurchaseManagement) — 렌더링 컴포넌트
   - 로직은 usePurchaseManagement 훅에서 관리
   ================================================================ */

import React from 'react'
import './PurchaseManagement.css'
import { usePurchaseManagement, COLUMNS } from './usePurchaseManagement'
import type { RgItem } from '../types/purchase'
import ProductDetailPanel from '../components/purchase/ProductDetailPanel'
import UploadProgressModal from '../components/UploadProgressModal'

const PurchaseManagement: React.FC = () => {
  const {
    searchValue,
    setSearchValue,
    handleSearch,
    handleSearchClear,
    loading,
    currentPage,
    filteredCount,
    totalPages,
    startIdx,
    pageItems,
    activeFilter,
    handleFilterToggle,
    resetting,
    updating,
    updateProgress,
    handleReset,
    handleUpdate,
    isUploading,
    uploadProgress,
    uploadStatus,
    rgExcelInputRef,
    handleRgExcelUpload,
    barcodeExcelInputRef,
    handleBarcodeExcel,
    barcodesyncing,
    barcodeSyncProgress,
    handleBarcodeSync,
    selectedIds,
    handleSelectAll,
    handleSelectRow,
    editingInputId,
    editingInputValue,
    setEditingInputValue,
    handleInputClick,
    handleInputBlur,
    pendingInputs,
    saving,
    handleSaveInputs,
    detailPanelOpen,
    setDetailPanelOpen,
    detailItem,
    handleProductClick,
    handlePageChange,
    getPageNumbers,
    getItemData,
    isNotItemWinner,
  } = usePurchaseManagement()

  // ── 셀 렌더링 ──────────────────────────────────────────────
  const renderCell = (col: typeof COLUMNS[number], item: RgItem) => {
    const data = getItemData(item)

    switch (col.key) {
      /* ── 상품정보 열 ──────────────────────────────────────── */
      case 'product':
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {isNotItemWinner(item) && (
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  backgroundColor: '#EF4444',
                  flexShrink: 0,
                }}
                title="아이템위너 아님"
              />
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {item.seller_product_name || '-'}
              {item.item_name ? `, ${item.item_name}` : ''}
            </span>
          </span>
        )

      /* ── 입력 열: 인라인 편집 ────────────────────────────── */
      case 'input':
        if (editingInputId === item.id) {
          return (
            <input
              className="purchase-input-cell"
              type="text"
              inputMode="numeric"
              autoFocus
              value={editingInputValue}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                if (e.target.value === '' || /^\d+$/.test(e.target.value)) {
                  setEditingInputValue(e.target.value)
                }
              }}
              onBlur={() => handleInputBlur(item.id!, item.input)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleInputBlur(item.id!, item.input)
                  const currentIdx = pageItems.findIndex((pi) => pi.id === item.id)
                  const nextItem = pageItems[currentIdx + 1]
                  if (nextItem?.id) {
                    handleInputClick(nextItem.id, nextItem.input)
                  }
                }
              }}
            />
          )
        }
        return <span>{item.input != null ? item.input : ''}</span>

      /* ── JOIN 컬럼: si_rg_item_data 필드 ────────────────── */
      case 'c_in':
        return data?.pending_inbounds ? data.pending_inbounds.toLocaleString() : ''
      case 'c_stock':
        return data?.orderable_qty ? data.orderable_qty.toLocaleString() : ''
      case 'd7':
        return data?.recent_sales_qty_7d ? data.recent_sales_qty_7d.toLocaleString() : ''
      case 'd30':
        return data?.recent_sales_qty_30d ? data.recent_sales_qty_30d.toLocaleString() : ''
      case 'recommend':
        return data?.recommended_inbound_qty ? data.recommended_inbound_qty.toLocaleString() : ''
      case 'storage': {
        const fee = data?.monthly_storage_fee
        if (!fee) return ''
        return <span style={{ color: '#EF4444' }}>{fee.toLocaleString()}</span>
      }

      /* ── 가격 열 ─────────────────────────────────────────── */
      case 'price':
        return item.sale_price ? item.sale_price.toLocaleString() : ''

      /* ── 기타 ────────────────────────────────────────────── */
      default:
        return ''
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 렌더링
  // ══════════════════════════════════════════════════════════════
  return (
    <div className="purchase-container">

      {/* ── 상단 버튼 영역: 좌측 리셋 | 우측 xlsx·바코드·업데이트 ── */}
      <div className="purchase-top-actions">
        <div className="purchase-toolbar-left">
          <button
            className="purchase-btn"
            onClick={handleReset}
            disabled={resetting}
          >
            {resetting ? (updateProgress || '리셋 중...') : '리셋'}
          </button>
        </div>
        <div className="purchase-toolbar-right">
          <label className="purchase-btn" style={{ cursor: 'pointer' }}>
            RG 재고 xlsx
            <input
              ref={rgExcelInputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={handleRgExcelUpload}
            />
          </label>
          <label className="purchase-btn" style={{ cursor: 'pointer' }}>
            바코드 연결 xlsx
            <input
              ref={barcodeExcelInputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={handleBarcodeExcel}
            />
          </label>
          <button
            className="purchase-btn"
            onClick={handleBarcodeSync}
            disabled={barcodesyncing}
          >
            {barcodesyncing ? (barcodeSyncProgress || '연동 중...') : '바코드 연동'}
          </button>
          <button
            className="purchase-btn"
            onClick={handleUpdate}
            disabled={updating}
          >
            {updating ? (updateProgress || '업데이트 중...') : '업데이트'}
          </button>
        </div>
      </div>

      {/* ── 타이틀 ──────────────────────────────────────────── */}
      <div className="purchase-header">
        <h1 className="purchase-title">사입관리</h1>
      </div>

      {/* ── 검색 입력폼 ─────────────────────────────────────── */}
      <div className="purchase-search-bar">
        <input
          className="purchase-search-input"
          type="text"
          placeholder="상품명, 바코드 또는 ID로 검색"
          value={searchValue}
          onChange={(e) => {
            setSearchValue(e.target.value)
            if (e.target.value === '') handleSearchClear()
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
        />
      </div>

      {/* ── 필터 툴바 (좌: 필터, 우: 저장) ──────────────────── */}
      <div className="purchase-table-toolbar">
        <div className="purchase-toolbar-left">
          <button
            className={`purchase-filter-btn${activeFilter === 'sales' ? ' active' : ''}`}
            onClick={() => handleFilterToggle('sales')}
          >
            판매량
          </button>
          <button
            className={`purchase-filter-btn${activeFilter === 'storage' ? ' active' : ''}`}
            onClick={() => handleFilterToggle('storage')}
          >
            반출비
          </button>
          {activeFilter && (
            <span className="purchase-filter-count">
              {filteredCount.toLocaleString()}건
            </span>
          )}
        </div>
        <button
          className="purchase-btn purchase-save-btn"
          onClick={handleSaveInputs}
          disabled={saving || pendingInputs.size === 0}
        >
          {saving ? '저장 중...' : `저장${pendingInputs.size > 0 ? ` (${pendingInputs.size})` : ''}`}
        </button>
      </div>

      {/* ── 테이블 섹션 ─────────────────────────────────────── */}
      <div className="purchase-table-section">
        {loading ? (
          <div className="purchase-loading">데이터를 불러오는 중...</div>
        ) : (
          <>
            <div className="purchase-table-wrapper">
              <table className="purchase-table">
                {/* ── colgroup ────────────────────────────── */}
                <colgroup>
                  <col style={{ width: '30px' }} />
                  {COLUMNS.map((c) => (
                    <col key={c.key} style={{ width: c.width }} />
                  ))}
                </colgroup>

                {/* ── thead ───────────────────────────────── */}
                <thead>
                  <tr>
                    <th className="col-checkbox">
                      <input
                        type="checkbox"
                        className="purchase-checkbox"
                        checked={pageItems.length > 0 && selectedIds.size === pageItems.length}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                      />
                    </th>
                    {COLUMNS.map((c) => (
                      <th
                        key={c.key}
                        className={
                          c.isProduct ? 'col-product' :
                          c.isInput ? 'col-input' : ''
                        }
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>

                {/* ── tbody ───────────────────────────────── */}
                <tbody>
                  {pageItems.length === 0 ? (
                    <tr>
                      <td colSpan={COLUMNS.length + 1} className="purchase-table-empty">
                        데이터가 없습니다
                      </td>
                    </tr>
                  ) : (
                    pageItems.map((item, idx) => {
                      const rowId = String(startIdx + idx)
                      return (
                        <tr key={item.id ?? `${item.seller_product_id}-${item.seller_product_item_id}-${idx}`}>
                          <td>
                            <input
                              type="checkbox"
                              className="purchase-checkbox"
                              checked={selectedIds.has(rowId)}
                              onChange={(e) => handleSelectRow(rowId, e.target.checked)}
                            />
                          </td>
                          {COLUMNS.map((c) => (
                            <td
                              key={c.key}
                              className={
                                c.isProduct ? 'col-product' :
                                c.isInput ? 'col-input' : ''
                              }
                              onClick={
                                c.isProduct
                                  ? () => handleProductClick(item)
                                  : c.isInput && editingInputId !== item.id
                                    ? () => handleInputClick(item.id!, item.input)
                                    : undefined
                              }
                              style={c.isProduct || c.isInput ? { cursor: 'pointer' } : undefined}
                            >
                              {renderCell(c, item)}
                            </td>
                          ))}
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* ── 페이지네이션 ────────────────────────────── */}
            <div className="purchase-pagination">
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

      {/* ── 상품 상세 슬라이드 패널 ────────────────────────── */}
      <ProductDetailPanel
        isOpen={detailPanelOpen}
        onClose={() => setDetailPanelOpen(false)}
        item={detailItem}
        itemWinner={detailItem ? getItemData(detailItem)?.item_winner : undefined}
      />

      {/* ── 엑셀 업로드 프로그레스 모달 ────────────────────── */}
      <UploadProgressModal
        isOpen={isUploading}
        progress={uploadProgress}
        status={uploadStatus}
        title="재고건강 SKU 엑셀 업로드 중"
      />
    </div>
  )
}

export default PurchaseManagement
