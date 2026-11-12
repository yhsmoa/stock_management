/* ================================================================
   개인주문 페이지 — 렌더링 컴포넌트
   - 로직은 usePersonalOrder 훅에서 관리
   ================================================================ */

import React, { useState, useEffect, useCallback } from 'react'
import './PersonalOrder.css'
import FulfillmentDrawer from './FulfillmentDrawer'
import ProgressModal from '../components/common/ProgressModal'
import {
  usePersonalOrder,
  ORDER_STATUS_TABS,
  COLUMNS,
  STATUS_DOT_LABELS,
  STATUS_BADGE_TONE,
  getCellValue,
  getRowKey,
} from './usePersonalOrder'
import { makeFulfillmentKey } from '../services/orderFulfillmentService'
import CartSelectModal from '../components/common/CartSelectModal'
import InboundShipmentModal from '../components/personal-order/InboundShipmentModal'
import InvoiceUploadModal from '../components/personal-order/InvoiceUploadModal'
import DeliveryInstructModal from '../components/personal-order/DeliveryInstructModal'
import { useDeliveryInstruct } from '../components/personal-order/useDeliveryInstruct'
import ShipmentStopModal from '../components/personal-order/ShipmentStopModal'
import { useShipmentStop } from '../components/personal-order/useShipmentStop'
import type { OrderRowPatch } from '../services/personalOrderService'
import DropdownMenu, { DropdownItem } from '../components/common/DropdownMenu'
import SearchBar from '../components/common/SearchBar'

const PersonalOrder: React.FC = () => {
  const {
    selectedTabs,
    searchValue,
    setSearchValue,
    currentPage,
    setCurrentPage,
    loading,
    updating,
    selectedIds,
    acknowledging,
    showUnorderedOnly,
    showCartOnly,
    showReleaseStopOnly,
    showNoInvoiceOnly,
    showReorderOnly,
    showNoteOnly,
    selectedStatuses,
    selectedDrawerItem,
    setSelectedDrawerItem,
    noteMap,
    handleSaveNote,
    inboundActive,
    inboundLoading,
    inboundModalOpen,
    setInboundModalOpen,
    shipmentOptions,
    inboundAllocMap,
    handleInboundToggle,
    handleInboundConfirm,
    handleInboundExcel,
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
    handleOrderSend,
    orderSending,
    orderSendModalOpen,
    setOrderSendModalOpen,
    handleConfirmOrderSend,
    carts,
    cartsLoading,
    handleRowClick,
    handleSearchSubmit,
    handleBarcodeLink,
    handleBarcodeRelink,
    barcodeLoading,
    stockMap,
    // 송장 통합 업로드 모달
    invoiceUploadModalOpen,
    setInvoiceUploadModalOpen,
    invoiceUploading,
    analyzeInvoiceFiles,
    handleInvoiceUpload,
    // 송장 업데이트 (출고중지·배송완료 정리)
    handleInvoiceUpdate,
    invoiceUpdating,
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
    toggleCartOnly,
    toggleReleaseStopOnly,
    toggleNoInvoiceOnly,
    toggleReorderOnly,
    toggleNoteOnly,
    toggleStatusFilter,
    getAgg,
    getRowStatus,
    reorderCountMap,
    orderItemCountMap,
    // [배송준비] · [출고중지]
    items,
    getUserInfo,
    applyRowPatches,
  } = usePersonalOrder()

  // ── [배송준비] 송장 엑셀 → 쿠팡 배송지시 (상태·흐름은 별도 훅) ──
  //   분리배송 뒤에는 묶음배송번호가 바뀌므로 결과 화면에서 [주문 업데이트](handleUpdate)로 이어진다
  const getUserId = useCallback(() => getUserInfo().userId, [getUserInfo])
  const deliveryInstruct = useDeliveryInstruct(items, getUserId, applyRowPatches, handleUpdate)

  // ── [출고중지] 선택한 상품준비중 주문 → 쿠팡 취소 (상태·흐름은 별도 훅) ──
  //   대상은 체크한 줄. 취소가 접수된 줄이 있으면 화면에 반영하고 선택을 푼다
  //   (취소된 줄이 선택된 채 남아 다른 작업에 섞이지 않게).
  const getSelectedRows = useCallback(
    () => items.filter((row) => selectedIds.has(getRowKey(row))),
    [items, selectedIds],
  )
  const applyShipmentStopped = useCallback((patches: OrderRowPatch[]) => {
    if (patches.length === 0) return
    applyRowPatches(patches)
    handleSelectAll(false)
  }, [applyRowPatches, handleSelectAll])
  const shipmentStop = useShipmentStop(items, getSelectedRows, getUserId, applyShipmentStopped, handleUpdate)

  // ── 셀 선택(엑셀 UX): 1클릭 → 셀 활성, Ctrl+C → 텍스트 복사 ─────
  const [focusedCell, setFocusedCell] = useState<{ rowKey: string; colKey: string } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!focusedCell) return

      // Escape → 선택 해제
      if (e.key === 'Escape') {
        setFocusedCell(null)
        return
      }

      // Ctrl/Cmd + C → 활성 셀 텍스트 복사
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        const ae = document.activeElement
        // 입력 요소 포커스 시 native 복사 우선
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return
        // 드래그 선택된 텍스트가 있으면 native 복사 우선
        const sel = window.getSelection()
        if (sel && sel.toString().length > 0) return

        const cellEl = document.querySelector<HTMLElement>(
          `td[data-row-key="${focusedCell.rowKey}"][data-col-key="${focusedCell.colKey}"]`,
        )
        if (!cellEl) return
        // 장식(상태 점·🛒·합배송 배지)은 data-no-copy — 복제본에서 지운 뒤 글자만 복사한다
        const clone = cellEl.cloneNode(true) as HTMLElement
        clone.querySelectorAll('[data-no-copy]').forEach((el) => el.remove())
        const text = (clone.textContent ?? '').trim()
        if (!text) return

        // navigator.clipboard 우선, 미지원(insecure context) 시 execCommand fallback
        const writeFallback = () => {
          const ta = document.createElement('textarea')
          ta.value = text
          ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0'
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
        }
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).catch(writeFallback)
        } else {
          writeFallback()
        }
        e.preventDefault()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [focusedCell])

  return (
    <div className="po-container">

      {/* ── 상단: 좌측 타이틀 | 우측 액션 (배송·업데이트·송장·엑셀·장바구니) ── */}
      <div className="po-top-actions">
        <div className="po-toolbar-left">
          <h2 className="po-title">개인주문</h2>
        </div>

        <div className="po-toolbar-right">
          {/* ── [업데이트]: 주문 업데이트 / 바코드 연결 / 송장 업데이트 ── */}
          <DropdownMenu label="업데이트" align="right">
            <DropdownItem
              onClick={handleUpdate}
              disabled={updating}
            >
              {updating ? '업데이트 중...' : '주문 업데이트'}
            </DropdownItem>
            <DropdownItem
              onClick={handleBarcodeLink}
              disabled={barcodeLoading}
            >
              {barcodeLoading ? '매칭 중...' : '바코드 연결'}
            </DropdownItem>
            <DropdownItem
              onClick={handleBarcodeRelink}
              disabled={barcodeLoading || selectedIds.size === 0}
            >
              {`바코드 재연결${selectedIds.size > 0 ? ` (${selectedIds.size})` : ' (선택)'}`}
            </DropdownItem>
            <DropdownItem
              onClick={handleInvoiceUpdate}
              disabled={invoiceUpdating}
            >
              {invoiceUpdating ? '정리 중...' : '✨ 송장 업데이트'}
            </DropdownItem>
          </DropdownMenu>

          {/* ── [송장]: 통합 업로드(엑셀+PDF) / 출력 ── */}
          <DropdownMenu label="송장" align="right">
            <DropdownItem
              onClick={() => setInvoiceUploadModalOpen(true)}
              disabled={invoiceUploading}
            >
              {invoiceUploading ? '업로드 중...' : '송장 업로드'}
            </DropdownItem>
            <DropdownItem
              onClick={handleInvoicePrint}
              disabled={invoicePrinting || selectedIds.size === 0}
            >
              {invoicePrinting
                ? '인쇄 준비 중...'
                : `송장 출력${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
            </DropdownItem>
          </DropdownMenu>

          {/* ── [엑셀]: 엑셀 다운로드 ── */}
          <button className="po-btn" onClick={handleExcelDownload}>
            엑셀
          </button>

          {/* ── [장바구니]: 전송 / 복사 ── */}
          <DropdownMenu label="장바구니" align="right">
            <DropdownItem
              onClick={handleOrderSend}
              disabled={orderSending}
            >
              {orderSending ? '전송 중...' : '전송'}
            </DropdownItem>
            <DropdownItem onClick={handleOrderCopy}>
              복사
            </DropdownItem>
          </DropdownMenu>
        </div>
      </div>

      {/* ── 주문상태 선택옵션 (다중 선택 · 검색폼과 동일 폭) ───── */}
      <div className="po-status-seg" role="group" aria-label="주문상태 선택">
        {ORDER_STATUS_TABS.map((tab) => {
          const isActive = tab === '전체' ? selectedTabs.size === 0 : selectedTabs.has(tab)
          return (
            <button
              key={tab}
              type="button"
              className={`po-status-seg-btn${isActive ? ' active' : ''}`}
              aria-pressed={isActive}
              title={tab}
              onClick={() => handleTabChange(tab)}
            >
              {tab}
            </button>
          )
        })}
      </div>

      {/* ── 검색바 (Enter 키로 검색 실행) ────────────────────── */}
      <SearchBar
        className="po-search-bar"
        placeholder="주문번호, 상품명 또는 수취인으로 검색 (Enter)"
        value={searchValue}
        onChange={setSearchValue}
        onSubmit={handleSearchSubmit}
      />

      {/* ── 필터 카운트 + 필터 버튼 + 주문확인 버튼 ─────────── */}
      <div className="po-table-toolbar">
        <div className="po-toolbar-left">
          <span className="po-filter-count">
            {selectedTabs.size === 0 ? '전체' : Array.from(selectedTabs).join(', ')} {filteredCount}건
          </span>
          {/* ── 필터 드롭박스: 출고중지 / 송장필요 / 미주문 / 재주문 ── */}
          {(() => {
            const cnt = [showReleaseStopOnly, showNoInvoiceOnly, showUnorderedOnly, showReorderOnly, showNoteOnly].filter(Boolean).length
            return (
              <DropdownMenu
                label={`필터${cnt ? ` (${cnt})` : ''}`}
                triggerClassName={`po-filter-trigger${cnt ? ' active' : ''}`}
              >
                <DropdownItem className={showReleaseStopOnly ? 'active' : ''} onClick={toggleReleaseStopOnly}>⚠️ 출고중지</DropdownItem>
                <DropdownItem className={showNoInvoiceOnly ? 'active' : ''} onClick={toggleNoInvoiceOnly}>📝 송장필요</DropdownItem>
                <DropdownItem className={showUnorderedOnly ? 'active' : ''} onClick={toggleUnorderedOnly}>🕊️ 미주문</DropdownItem>
                <DropdownItem className={showReorderOnly ? 'active' : ''} onClick={toggleReorderOnly}>🔄 재주문</DropdownItem>
                <DropdownItem className={showNoteOnly ? 'active' : ''} onClick={toggleNoteOnly}>📌 노트</DropdownItem>
              </DropdownMenu>
            )
          })()}

          {/* ── 상태 드롭박스: 카트 + 상태 색 동그라미 ── */}
          {(() => {
            const cnt = (showCartOnly ? 1 : 0) + selectedStatuses.size
            return (
              <DropdownMenu
                label={`상태${cnt ? ` (${cnt})` : ''}`}
                triggerClassName={`po-filter-trigger${cnt ? ' active' : ''}`}
              >
                <DropdownItem className={showCartOnly ? 'active' : ''} onClick={toggleCartOnly}>🛒 카트</DropdownItem>
                {(['shipped', 'green', 'red', 'gray', 'multi'] as const).map((st) => (
                  <DropdownItem
                    key={st}
                    className={selectedStatuses.has(st) ? 'active' : ''}
                    onClick={() => toggleStatusFilter(st)}
                  >
                    <span className={`po-status-dot ${st}`} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                    {STATUS_DOT_LABELS[st]}
                  </DropdownItem>
                ))}
              </DropdownMenu>
            )
          })()}
        </div>
        <div className="po-toolbar-right">
          {/* ── 입고준비 (바코드 기준 매칭 토글) ── */}
          <button
            className={`po-btn${inboundActive ? ' po-acknowledge-btn' : ''}`}
            onClick={handleInboundToggle}
            disabled={inboundLoading}
            title="선택 shipment 의 입고 재고를 주문에 바코드 기준 할당"
          >
            {inboundLoading ? '매칭 중...' : (inboundActive ? '입고준비 해제' : '입고준비')}
          </button>

          {/* ── 입고엑셀 (입고준비 활성 시에만) ── */}
          {inboundActive && (
            <button
              className="po-btn"
              onClick={handleInboundExcel}
              title="Delivery + shipment_list 2개 시트 엑셀 다운로드"
            >
              입고엑셀
            </button>
          )}

          {/* ── 배송준비 (송장 엑셀 → 쿠팡 배송지시 등록) ── */}
          <button
            className="po-btn"
            onClick={deliveryInstruct.openModal}
            disabled={deliveryInstruct.busy}
            title="택배사·운송장번호를 채운 DeliveryList 엑셀로 상품준비중 주문을 배송지시로 등록"
          >
            배송준비
          </button>

          {/* ── 출고중지 (선택한 상품준비중 주문을 쿠팡에서 취소 — 상품준비중 탭에서만) ── */}
          {selectedTabs.has('상품준비중') && (
            <button
              className="po-btn po-stop-btn"
              onClick={shipmentStop.openModal}
              disabled={shipmentStop.busy || selectedIds.size === 0}
              title="선택한 상품준비중 주문을 쿠팡에서 취소(출고중지)합니다 — 확인 창에서 대상을 본 뒤 실행"
            >
              {`출고중지${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
            </button>
          )}

          {selectedTabs.has('결제완료') && (
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
                pagedItems.map((row) => {
                  const agg = getAgg(row)
                  const status = getRowStatus(row)
                  // 행 유일 키 — 한 송장박스에 여러 아이템이 들어가는 경우 shipment_box_id 는 중복되므로 row.id(uuid) 사용
                  const rowKey = getRowKey(row)

                  return (
                    <tr key={rowKey}>
                      <td>
                        <input
                          type="checkbox"
                          className="po-checkbox"
                          checked={selectedIds.has(rowKey)}
                          onChange={(e) =>
                            handleSelectRow(rowKey, e.target.checked)
                          }
                        />
                      </td>

                      {COLUMNS.map((col) => {
                        // ── 셀 선택(엑셀 UX) 공통 props ──
                        const isFocused =
                          focusedCell?.rowKey === rowKey
                          && focusedCell?.colKey === col.key
                        const focusedClass = isFocused ? ' po-cell-focused' : ''
                        const onCellClick = () =>
                          setFocusedCell({ rowKey, colKey: col.key })
                        const cellDataAttrs = {
                          'data-row-key': rowKey,
                          'data-col-key': col.key,
                        }

                        // ── 운송장번호 ──────────────────────────────────
                        //   입고 완료(agg.arrival > 0) → 파랑
                        //     : 송장이 출력되어 실물 상품에 이미 부착된 상태
                        //   확정 운송장 → 기본색 / 대기 운송장 → 주황 / 없음 → '-'
                        if (col.key === 'invoice_no') {
                          const inv = (row.invoice_number ?? '').trim()
                          const pending = (row.pending_invoice_number ?? '').trim()
                          const shown = inv || pending
                          const arrived = agg.arrival > 0
                          return (
                            <td
                              key={col.key}
                              {...cellDataAttrs}
                              className={focusedClass.trim() || undefined}
                              title={
                                !shown
                                  ? '-'
                                  : arrived
                                    ? `${shown} — 입고 완료 (송장이 상품에 부착됨)`
                                    : shown
                              }
                              onClick={onCellClick}
                            >
                              {!shown
                                ? '-'
                                : arrived
                                  ? <span style={{ color: '#2563EB', fontWeight: 600 }}>{shown}</span>
                                  : inv
                                    ? inv
                                    : <span style={{ color: '#C2410C', fontWeight: 600 }}>{pending}</span>}
                            </td>
                          )
                        }

                        // ── 주문상태 (색상 배지) ──
                        if (col.key === 'status_label') {
                          const label = getCellValue(row, col.key)
                          const tone = STATUS_BADGE_TONE[row.status] ?? 'gray'
                          return (
                            <td
                              key={col.key}
                              {...cellDataAttrs}
                              className={focusedClass.trim() || undefined}
                              title={label}
                              onClick={onCellClick}
                            >
                              {label && (
                                <span className={`po-status-badge ${tone}`}>{label}</span>
                              )}
                            </td>
                          )
                        }

                        // ── 재고 (바코드 기준 총재고, inventory 페이지 기준) ──
                        //   1 이상일 때만 파란색 숫자, 0 또는 바코드 없으면 빈칸
                        if (col.key === 'stock') {
                          const bc = (row.barcode ?? '').trim()
                          const qty = bc ? (stockMap.get(bc) ?? 0) : 0
                          return (
                            <td
                              key={col.key}
                              {...cellDataAttrs}
                              className={focusedClass.trim() || undefined}
                              title={qty > 0 ? `재고 ${qty}` : undefined}
                              onClick={onCellClick}
                            >
                              {qty > 0 && (
                                <span style={{ color: '#2563EB', fontWeight: 600 }}>{qty}</span>
                              )}
                            </td>
                          )
                        }

                        // ── fulfillment 컬럼 (상태 점은 상품정보 칸의 상품명 바로 뒤) ──
                        if (col.key === 'ff_arrival') {
                          return (
                            <td
                              key={col.key}
                              {...cellDataAttrs}
                              className={focusedClass.trim() || undefined}
                              onClick={onCellClick}
                            >
                              {agg.arrival || '-'}
                            </td>
                          )
                        }
                        if (col.key === 'ff_packed') {
                          return (
                            <td
                              key={col.key}
                              {...cellDataAttrs}
                              className={focusedClass.trim() || undefined}
                              onClick={onCellClick}
                            >
                              {agg.packed || '-'}
                            </td>
                          )
                        }
                        if (col.key === 'ff_cancel') {
                          return (
                            <td
                              key={col.key}
                              {...cellDataAttrs}
                              className={focusedClass.trim() || undefined}
                              onClick={onCellClick}
                            >
                              {agg.cancel || '-'}
                            </td>
                          )
                        }
                        if (col.key === 'ff_shipped') {
                          return (
                            <td
                              key={col.key}
                              {...cellDataAttrs}
                              className={focusedClass.trim() || undefined}
                              onClick={onCellClick}
                            >
                              {agg.shipped || '-'}
                            </td>
                          )
                        }

                        // ── 상품정보 (클릭 → 드로어) ──
                        //   [입고 위치(shipment 번호별)] [📌] [⚠️] 상품명 [N차] [상태 점·🛒]
                        //   상태 표시는 상품명 바로 뒤 — 긴 상품명이 '…' 로 잘려도 그 뒤에 남는다 (po-product-cell)
                        //   상태 표시는 장식(data-no-copy) — 셀 복사에 들어가지 않는다
                        if (col.key === 'product_info') {
                          const ffKey = row.order_id
                            ? makeFulfillmentKey(row.order_id, row.vendor_item_id)
                            : ''
                          const reorderCount = ffKey ? (reorderCountMap.get(ffKey) ?? 1) : 1
                          const hasNote = !!ffKey && noteMap.has(ffKey)
                          const alloc = inboundActive ? inboundAllocMap.get(rowKey) : undefined
                          const baseTitle = getCellValue(row, col.key)
                          const titleParts: string[] = []
                          if (alloc?.displayStr) titleParts.push(alloc.displayStr)
                          if (hasNote) titleParts.push('[비고]')
                          if (row.release_stop) titleParts.push('[출고중지요청]')
                          if (row.canceled) titleParts.push('[취소]')
                          if (reorderCount >= 2) titleParts.push(`[${reorderCount}차]`)
                          titleParts.push(baseTitle)

                          return (
                            <td
                              key={col.key}
                              {...cellDataAttrs}
                              className={`col-product po-clickable${focusedClass}`}
                              title={titleParts.join(' ')}
                              onClick={() => {
                                onCellClick()
                                handleRowClick(row)
                              }}
                            >
                              <div className="po-product-cell">
                                <span className="po-product-text">
                                  {alloc?.displayStr && (
                                    <span
                                      style={{ marginRight: 4, color: '#2563EB', fontWeight: 600 }}
                                      title="입고 shipment / 위치 / 수량"
                                    >
                                      {alloc.displayStr}
                                    </span>
                                  )}
                                  {hasNote && (
                                    <span
                                      style={{ marginRight: 4 }}
                                      title="비고 있음"
                                      aria-label="비고 있음"
                                    >
                                      📌
                                    </span>
                                  )}
                                  {row.release_stop && (
                                    <span
                                      style={{ marginRight: 4 }}
                                      title="출고중지요청"
                                      aria-label="출고중지요청"
                                    >
                                      ⚠️
                                    </span>
                                  )}
                                  {row.canceled && (
                                    <span
                                      className="po-canceled-chip"
                                      data-no-copy
                                      title="취소된 상품 — 출고하지 않습니다"
                                    >
                                      취소
                                    </span>
                                  )}
                                  {baseTitle}
                                  {reorderCount >= 2 && (
                                    <span
                                      style={{
                                        marginLeft: 4,
                                        padding: '1px 5px',
                                        borderRadius: 4,
                                        fontSize: 11,
                                        fontWeight: 600,
                                        background: '#F97316',
                                        color: '#fff',
                                      }}
                                      title={`${reorderCount}차 주문`}
                                    >
                                      {reorderCount}차
                                    </span>
                                  )}
                                </span>
                                {status === 'cart' ? (
                                  <span
                                    className="po-status-inline"
                                    data-no-copy
                                    title={STATUS_DOT_LABELS.cart}
                                    aria-label={STATUS_DOT_LABELS.cart}
                                  >
                                    🛒
                                  </span>
                                ) : status !== 'none' ? (
                                  <span
                                    className={`po-status-dot po-status-inline ${status}`}
                                    data-no-copy
                                    role="img"
                                    title={STATUS_DOT_LABELS[status]}
                                    aria-label={STATUS_DOT_LABELS[status]}
                                  />
                                ) : null}
                              </div>
                            </td>
                          )
                        }

                        // ── 수취인 (split_shipping = 'Y' 시 🛍️ 접두 · 합배송 2건↑이면 주황 배지) ──
                        //   합배송 배지는 장식(data-no-copy) — 복사하면 이름만 들어간다
                        if (col.key === 'receiver_name') {
                          const flagged = row.split_shipping === 'Y'
                          const baseValue = getCellValue(row, col.key)
                          const combinedCount = row.order_id ? (orderItemCountMap.get(row.order_id) ?? 1) : 1
                          const combined = combinedCount >= 2
                          const combinedTitle = `합배송 ${combinedCount}건`
                          return (
                            <td
                              key={col.key}
                              {...cellDataAttrs}
                              className={focusedClass.trim() || undefined}
                              title={
                                (flagged ? '[분리배송] ' : '') + baseValue
                                + (combined ? ` [${combinedTitle}]` : '')
                              }
                              onClick={onCellClick}
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
                              {combined && (
                                <span className="po-combined-badge" data-no-copy title={combinedTitle}>
                                  {combinedCount}
                                </span>
                              )}
                            </td>
                          )
                        }

                        // ── 기본 컬럼 ──
                        return (
                          <td
                            key={col.key}
                            {...cellDataAttrs}
                            className={focusedClass.trim() || undefined}
                            title={getCellValue(row, col.key)}
                            onClick={onCellClick}
                          >
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

      {/* ── Fulfillment 히스토리 드로어 (+ 비고 입력) ────────── */}
      <FulfillmentDrawer
        open={selectedDrawerItem != null}
        itemIds={selectedDrawerItem?.ids ?? []}
        itemName={selectedDrawerItem?.itemName ?? null}
        optionName={selectedDrawerItem?.optionName ?? null}
        orderNo={selectedDrawerItem?.orderNo ?? null}
        itemNo={selectedDrawerItem?.itemNo ?? null}
        productNo={selectedDrawerItem?.productNo ?? null}
        sellerProductId={selectedDrawerItem?.sellerProductId ?? null}
        vendorItemId={selectedDrawerItem?.vendorItemId ?? null}
        note={
          selectedDrawerItem?.noteOrderNo
            ? (noteMap.get(makeFulfillmentKey(selectedDrawerItem.noteOrderNo, selectedDrawerItem.noteOptionId)) ?? '')
            : ''
        }
        noteResetKey={`${selectedDrawerItem?.noteOrderNo ?? ''}|${selectedDrawerItem?.noteOptionId ?? ''}`}
        onSaveNote={(n) => {
          if (selectedDrawerItem?.noteOrderNo) {
            handleSaveNote(selectedDrawerItem.noteOrderNo, selectedDrawerItem.noteOptionId, n)
          }
        }}
        onClose={() => setSelectedDrawerItem(null)}
      />

      {/* ── 진행 모달 (업데이트 / 바코드 연결 / 송장 연결 공용) ── */}
      <ProgressModal
        isOpen={progressOpen}
        title={progressTitle}
        steps={progressSteps}
        status={progressStatus}
      />

      {/* ── 입고준비 — shipment 선택 모달 ───────────────────── */}
      <InboundShipmentModal
        isOpen={inboundModalOpen}
        options={shipmentOptions}
        loading={inboundLoading}
        onClose={() => setInboundModalOpen(false)}
        onConfirm={handleInboundConfirm}
      />

      {/* ── 장바구니 추가 — 기존 카트 선택 / 신규 생성 ────────── */}
      <CartSelectModal
        isOpen={orderSendModalOpen}
        count={selectedIds.size}
        carts={carts}
        cartsLoading={cartsLoading}
        loading={orderSending}
        onClose={() => setOrderSendModalOpen(false)}
        onSubmit={handleConfirmOrderSend}
      />

      {/* ── 송장 통합 업로드 — 엑셀 + PDF 모달 ───────────────── */}
      <InvoiceUploadModal
        isOpen={invoiceUploadModalOpen}
        uploading={invoiceUploading}
        onClose={() => setInvoiceUploadModalOpen(false)}
        onAnalyze={analyzeInvoiceFiles}
        onSubmit={handleInvoiceUpload}
      />

      {/* ── 배송준비 — 송장 엑셀 → 쿠팡 배송지시 등록 ───────────── */}
      <DeliveryInstructModal state={deliveryInstruct} />

      {/* ── 출고중지 — 선택한 상품준비중 주문을 쿠팡에서 취소 ───── */}
      <ShipmentStopModal state={shipmentStop} />
    </div>
  )
}

export default PersonalOrder
