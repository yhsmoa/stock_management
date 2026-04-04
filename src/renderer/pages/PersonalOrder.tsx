/* ================================================================
   개인주문 페이지 — 렌더링 컴포넌트
   - 로직은 usePersonalOrder 훅에서 관리
   ================================================================ */

import React from 'react'
import './PersonalOrder.css'
import FulfillmentDrawer from './FulfillmentDrawer'
import {
  usePersonalOrder,
  ORDER_STATUS_TABS,
  COLUMNS,
  STATUS_DOT_LABELS,
  getCellValue,
} from './usePersonalOrder'

const PersonalOrder: React.FC = () => {
  const {
    activeTab,
    searchValue,
    setSearchValue,
    currentPage,
    setCurrentPage,
    loading,
    updating,
    updateMsg,
    selectedIds,
    acknowledging,
    showUnorderedOnly,
    selectedDrawerItem,
    setSelectedDrawerItem,
    filteredCount,
    totalPages,
    pagedItems,
    isAllSelected,
    getPageNumbers,
    handleTabChange,
    handleUpdate,
    handleAcknowledge,
    handleExcelDownload,
    handleOrderCopy,
    handleRowClick,
    handleBarcodeLink,
    barcodeLoading,
    handleSelectAll,
    handleSelectRow,
    toggleUnorderedOnly,
    getAgg,
    getRowStatus,
  } = usePersonalOrder()

  return (
    <div className="po-container">

      {/* ── 상단: 좌측 탭 + 업데이트/바코드 | 우측 엑셀 다운 ──── */}
      <div className="po-top-actions">
        <div className="po-toolbar-left">
          {ORDER_STATUS_TABS.map((tab) => (
            <button
              key={tab}
              className={`po-tab-btn${activeTab === tab ? ' active' : ''}`}
              onClick={() => handleTabChange(tab)}
            >
              {tab}
            </button>
          ))}
          <button
            className="po-btn"
            onClick={handleUpdate}
            disabled={updating}
          >
            {updating ? '업데이트 중...' : '업데이트'}
          </button>
          <button
            className="po-btn"
            onClick={handleBarcodeLink}
            disabled={barcodeLoading}
          >
            {barcodeLoading ? '매칭 중...' : '바코드 연결'}
          </button>
        </div>
        <div className="po-toolbar-right">
          <button className="po-btn" onClick={handleExcelDownload}>
            엑셀 다운
          </button>
          <button className="po-btn" onClick={handleOrderCopy}>
            주문
          </button>
        </div>
      </div>

      {/* ── 타이틀 ────────────────────────────────────────────── */}
      <div className="po-header">
        <h2 className="po-title">개인주문</h2>
      </div>

      {/* ── 업데이트 진행 메시지 ───────────────────────────────── */}
      {updateMsg && (
        <div className="po-update-msg">{updateMsg}</div>
      )}

      {/* ── 검색바 (UI만) ─────────────────────────────────────── */}
      <div className="po-search-bar">
        <input
          className="po-search-input"
          type="text"
          placeholder="주문번호, 상품명 또는 수취인으로 검색"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
        />
      </div>

      {/* ── 필터 카운트 + 미주문 버튼 + 주문확인 버튼 ─────────── */}
      <div className="po-table-toolbar">
        <div className="po-toolbar-left">
          <span className="po-filter-count">
            {activeTab} {filteredCount}건
          </span>
          <button
            className={`po-tab-btn${showUnorderedOnly ? ' active' : ''}`}
            onClick={toggleUnorderedOnly}
          >
            미주문
          </button>
        </div>
        {activeTab === '결제완료' && (
          <button
            className="po-btn po-acknowledge-btn"
            onClick={handleAcknowledge}
            disabled={acknowledging || selectedIds.size === 0}
          >
            {acknowledging
              ? '처리 중...'
              : `주문확인${selectedIds.size > 0 ? ` (${selectedIds.size}건)` : ''}`}
          </button>
        )}
      </div>

      {/* ── 테이블 ────────────────────────────────────────────── */}
      <div className="po-table-section">
        <div className="po-table-wrapper">
          <table className="po-table">
            <colgroup>
              <col style={{ width: '30px' }} />
              {COLUMNS.map((col) => (
                <col
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="col-checkbox">
                  <input
                    type="checkbox"
                    className="po-checkbox"
                    checked={isAllSelected}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                  />
                </th>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={col.key === 'product_info' ? 'col-product' : ''}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="po-loading">
                    데이터를 불러오는 중...
                  </td>
                </tr>
              ) : pagedItems.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="po-table-empty">
                    데이터가 없습니다
                  </td>
                </tr>
              ) : (
                pagedItems.map((row, idx) => {
                  const agg = getAgg(row.order_id)
                  const status = getRowStatus(row)

                  return (
                    <tr key={row.id ?? idx}>
                      <td>
                        <input
                          type="checkbox"
                          className="po-checkbox"
                          checked={selectedIds.has(row.shipment_box_id)}
                          onChange={(e) =>
                            handleSelectRow(row.shipment_box_id, e.target.checked)
                          }
                        />
                      </td>

                      {COLUMNS.map((col) => {
                        // ── fulfillment 컬럼 ──
                        if (col.key === 'ff_status') {
                          return (
                            <td key={col.key}>
                              {status !== 'none' && (
                                <span
                                  className={`po-status-dot ${status}`}
                                  title={STATUS_DOT_LABELS[status]}
                                />
                              )}
                            </td>
                          )
                        }
                        if (col.key === 'ff_arrival') {
                          return <td key={col.key}>{agg.arrival || '-'}</td>
                        }
                        if (col.key === 'ff_packed') {
                          return <td key={col.key}>{agg.packed || '-'}</td>
                        }
                        if (col.key === 'ff_cancel') {
                          return <td key={col.key}>{agg.cancel || '-'}</td>
                        }
                        if (col.key === 'ff_shipped') {
                          return <td key={col.key}>{agg.shipped || '-'}</td>
                        }

                        // ── 상품정보 (클릭 → 드로어) ──
                        if (col.key === 'product_info') {
                          return (
                            <td
                              key={col.key}
                              className="col-product po-clickable"
                              title={getCellValue(row, col.key)}
                              onClick={() => handleRowClick(row)}
                            >
                              {getCellValue(row, col.key)}
                            </td>
                          )
                        }

                        // ── 기본 컬럼 ──
                        return (
                          <td key={col.key} title={getCellValue(row, col.key)}>
                            {getCellValue(row, col.key)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── 페이지네이션 ──────────────────────────────────── */}
        <div className="po-pagination">
          <div className="po-pagination-controls">
            <button
              className="po-pagination-btn"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
            >
              이전
            </button>
            {getPageNumbers().map((p, i) =>
              p === 'ellipsis' ? (
                <span key={`e${i}`} className="po-pagination-ellipsis">…</span>
              ) : (
                <button
                  key={p}
                  className={`po-pagination-btn${currentPage === p ? ' active' : ''}`}
                  onClick={() => setCurrentPage(p)}
                >
                  {p}
                </button>
              ),
            )}
            <button
              className="po-pagination-btn"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
            >
              다음
            </button>
          </div>
        </div>
      </div>

      {/* ── Fulfillment 히스토리 드로어 ────────────────────── */}
      <FulfillmentDrawer
        itemId={selectedDrawerItem?.id ?? null}
        itemName={selectedDrawerItem?.itemName ?? null}
        optionName={selectedDrawerItem?.optionName ?? null}
        orderNo={selectedDrawerItem?.orderNo ?? null}
        itemNo={selectedDrawerItem?.itemNo ?? null}
        productNo={selectedDrawerItem?.productNo ?? null}
        onClose={() => setSelectedDrawerItem(null)}
      />
    </div>
  )
}

export default PersonalOrder
