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
    handleViewsConsole,
    viewsCsvInputRef,
    handleViewsCsvClick,
    handleViewsCsvUpload,
    viewsDateModalOpen,
    setViewsDateModalOpen,
    viewsDateValue,
    setViewsDateValue,
    handleViewsDateConfirm,
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
    viewsDataMap,
    recentViewDates,
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

      /* ── 조회수 V1~V5 (최근 5개 날짜, V1=가장 오래된, V5=최근) ── */
      case 'v1': case 'v2': case 'v3': case 'v4': case 'v5': {
        const dateIdx = Number(col.key[1]) - 1
        const date = recentViewDates[dateIdx]
        if (!date) return ''
        const views = viewsDataMap.get(item.seller_product_id)?.get(date)
        return views != null ? views.toLocaleString() : ''
      }

      /* ── 기타 ────────────────────────────���───────────────── */
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
          {/* ── RG 재고 xlsx ─────────────────────────────────── */}
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

          {/* ── 바코드 연결 (드롭다운: api / xlsx) ───────────── */}
          <div className="purchase-dropdown">
            <button className="purchase-btn">바코드 연결</button>
            <div className="purchase-dropdown-menu">
              <button
                className="purchase-dropdown-item"
                onClick={handleBarcodeSync}
                disabled={barcodesyncing}
              >
                {barcodesyncing ? (barcodeSyncProgress || '연동 중...') : 'api'}
              </button>
              <label className="purchase-dropdown-item" style={{ cursor: 'pointer' }}>
                xlsx
                <input
                  ref={barcodeExcelInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={handleBarcodeExcel}
                />
              </label>
            </div>
          </div>

          {/* ── 조회수 (드롭다운: 콘솔 / csv 업로드) ──────────── */}
          <div className="purchase-dropdown">
            <button className="purchase-btn">조회수</button>
            <div className="purchase-dropdown-menu">
              <button className="purchase-dropdown-item" onClick={handleViewsConsole}>콘솔</button>
              <button className="purchase-dropdown-item" onClick={handleViewsCsvClick}>csv 업로드</button>
              <input
                ref={viewsCsvInputRef}
                type="file"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={handleViewsCsvUpload}
              />
            </div>
          </div>

          {/* ── 업데이트 ──────────────────────────────────────── */}
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

      {/* ── 조회수 날짜 입력 모달 ──────────────────────────── */}
      {viewsDateModalOpen && (
        <div className="modal-overlay" onClick={() => setViewsDateModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ width: '320px' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 600 }}>조회수 날짜 입력</h3>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="YYYY"
                style={{ width: '64px', padding: '6px 8px', textAlign: 'center', fontSize: '14px', border: '1px solid #d1d5db', borderRadius: '4px' }}
                value={viewsDateValue.split('-')[0] || ''}
                autoFocus
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 4)
                  const parts = viewsDateValue.split('-')
                  const next = [v, parts[1] || '', parts[2] || ''].join('-')
                  setViewsDateValue(next)
                  if (v.length === 4) {
                    const mmInput = e.target.parentElement?.querySelectorAll('input')[1] as HTMLInputElement
                    mmInput?.focus()
                  }
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleViewsDateConfirm() }}
              />
              <span style={{ color: '#9ca3af' }}>-</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={2}
                placeholder="MM"
                style={{ width: '44px', padding: '6px 8px', textAlign: 'center', fontSize: '14px', border: '1px solid #d1d5db', borderRadius: '4px' }}
                value={viewsDateValue.split('-')[1] || ''}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 2)
                  const parts = viewsDateValue.split('-')
                  const next = [parts[0] || '', v, parts[2] || ''].join('-')
                  setViewsDateValue(next)
                  if (v.length === 2) {
                    const ddInput = e.target.parentElement?.querySelectorAll('input')[2] as HTMLInputElement
                    ddInput?.focus()
                  }
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleViewsDateConfirm() }}
              />
              <span style={{ color: '#9ca3af' }}>-</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={2}
                placeholder="DD"
                style={{ width: '44px', padding: '6px 8px', textAlign: 'center', fontSize: '14px', border: '1px solid #d1d5db', borderRadius: '4px' }}
                value={viewsDateValue.split('-')[2] || ''}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 2)
                  const parts = viewsDateValue.split('-')
                  const next = [parts[0] || '', parts[1] || '', v].join('-')
                  setViewsDateValue(next)
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleViewsDateConfirm() }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button
                className="purchase-btn"
                onClick={() => setViewsDateModalOpen(false)}
                style={{ background: '#f3f4f6', color: '#374151' }}
              >
                취소
              </button>
              <button className="purchase-btn" onClick={handleViewsDateConfirm}>
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PurchaseManagement
