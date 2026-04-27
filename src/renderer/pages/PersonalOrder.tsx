/* ================================================================
   개인주문 페이지 — 렌더링 컴포넌트
   - 로직은 usePersonalOrder 훅에서 관리
   ================================================================ */

import React, { useRef } from 'react'
import './PersonalOrder.css'
import FulfillmentDrawer from './FulfillmentDrawer'
import ProgressModal from '../components/common/ProgressModal'
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
    showReleaseStopOnly,
    showNoInvoiceOnly,
    selectedStatuses,
    invoiceOrderIds,
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
    handleSearchSubmit,
    handleBarcodeLink,
    barcodeLoading,
    handleInvoiceLink,
    invoiceLinking,
    handleInvoicePrint,
    invoicePrinting,
    // 진행 모달
    progressOpen,
    progressTitle,
    progressSteps,
    progressStatus,
    handleSelectAll,
    handleSelectRow,
    toggleUnorderedOnly,
    toggleReleaseStopOnly,
    toggleNoInvoiceOnly,
    toggleStatusFilter,
    getAgg,
    getRowStatus,
  } = usePersonalOrder()

  // ── 송장 연결 파일 input ref ────────────────────────────────────
  const invoiceInputRef = useRef<HTMLInputElement>(null)

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
          <span className="po-separator">|</span>
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
          {/* ── 송장 연결 (PDF 업로드 → 주문번호 매핑 → Storage 저장) ── */}
          <input
            ref={invoiceInputRef}
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleInvoiceLink(file)
              e.target.value = ''
            }}
          />
          <button
            className="po-btn"
            onClick={() => invoiceInputRef.current?.click()}
            disabled={invoiceLinking}
          >
            {invoiceLinking ? '연결 중...' : '송장 연결'}
          </button>
          <button
            className="po-btn"
            onClick={handleInvoicePrint}
            disabled={invoicePrinting || selectedIds.size === 0}
          >
            {invoicePrinting
              ? '인쇄 준비 중...'
              : `송장 인쇄${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
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

      {/* ── 검색바 (Enter 키로 검색 실행) ────────────────────── */}
      <div className="po-search-bar">
        <input
          className="po-search-input"
          type="text"
          placeholder="주문번호, 상품명 또는 수취인으로 검색 (Enter)"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearchSubmit()
          }}
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
          <button
            className={`po-tab-btn${showReleaseStopOnly ? ' active' : ''}`}
            onClick={toggleReleaseStopOnly}
          >
            ⚠️출고중지
          </button>
          <button
            className={`po-tab-btn${showNoInvoiceOnly ? ' active' : ''}`}
            onClick={toggleNoInvoiceOnly}
          >
            📝송장필요
          </button>

          {/* ── 상태 점 필터 (shipped/green/red/gray/multi) ───── */}
          {(['shipped', 'green', 'red', 'gray', 'multi'] as const).map((st) => (
            <button
              key={st}
              className={`po-status-filter-btn${selectedStatuses.has(st) ? ' active' : ''}`}
              onClick={() => toggleStatusFilter(st)}
              title={STATUS_DOT_LABELS[st]}
              aria-label={STATUS_DOT_LABELS[st]}
            >
              {st === 'shipped'
                ? <span>🏁</span>
                : <span className={`po-status-dot ${st}`} />}
            </button>
          ))}
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
                  const agg = getAgg(row)
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
                              {status === 'shipped' ? (
                                <span
                                  title={STATUS_DOT_LABELS.shipped}
                                  aria-label={STATUS_DOT_LABELS.shipped}
                                >
                                  🏁
                                </span>
                              ) : status !== 'none' ? (
                                <span
                                  className={`po-status-dot ${status}`}
                                  title={STATUS_DOT_LABELS[status]}
                                />
                              ) : null}
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
                          const needInvoice =
                            !!row.order_id && !invoiceOrderIds.has(row.order_id)
                          const baseTitle = getCellValue(row, col.key)
                          const titleParts: string[] = []
                          if (row.release_stop) titleParts.push('[출고중지요청]')
                          if (needInvoice) titleParts.push('[송장 미연결]')
                          titleParts.push(baseTitle)

                          return (
                            <td
                              key={col.key}
                              className="col-product po-clickable"
                              title={titleParts.join(' ')}
                              onClick={() => handleRowClick(row)}
                            >
                              {row.release_stop && (
                                <span
                                  style={{ marginRight: 4 }}
                                  title="출고중지요청"
                                  aria-label="출고중지요청"
                                >
                                  ⚠️
                                </span>
                              )}
                              {baseTitle}
                              {needInvoice && (
                                <span
                                  style={{ marginLeft: 4 }}
                                  title="송장 미연결"
                                  aria-label="송장 미연결"
                                >
                                  📝
                                </span>
                              )}
                            </td>
                          )
                        }

                        // ── 수취인 (split_shipping = 'Y' 시 🛍️ 접두) ──
                        if (col.key === 'receiver_name') {
                          const flagged = row.split_shipping === 'Y'
                          const baseValue = getCellValue(row, col.key)
                          return (
                            <td
                              key={col.key}
                              title={(flagged ? '[분리배송] ' : '') + baseValue}
                            >
                              {flagged && (
                                <span
                                  style={{ marginRight: 2 }}
                                  title="분리배송"
                                  aria-label="분리배송"
                                >
                                  🛍️
                                </span>
                              )}
                              {baseValue}
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
        itemIds={selectedDrawerItem?.ids ?? []}
        itemName={selectedDrawerItem?.itemName ?? null}
        optionName={selectedDrawerItem?.optionName ?? null}
        orderNo={selectedDrawerItem?.orderNo ?? null}
        itemNo={selectedDrawerItem?.itemNo ?? null}
        productNo={selectedDrawerItem?.productNo ?? null}
        onClose={() => setSelectedDrawerItem(null)}
      />

      {/* ── 진행 모달 (업데이트 / 바코드 연결 / 송장 연결 공용) ── */}
      <ProgressModal
        isOpen={progressOpen}
        title={progressTitle}
        steps={progressSteps}
        status={progressStatus}
      />
    </div>
  )
}

export default PersonalOrder
