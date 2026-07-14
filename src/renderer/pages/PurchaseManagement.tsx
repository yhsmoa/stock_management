/* ================================================================
   사입관리 (PurchaseManagement) — 렌더링 컴포넌트
   - 로직은 usePurchaseManagement 훅에서 관리
   ================================================================ */

import React, { useState, useEffect, useRef } from 'react'
import './PurchaseManagement.css'
import { usePurchaseManagement, COLUMNS, PAGE_SIZE_OPTIONS, type EditableField } from './usePurchaseManagement'
import type { RgItem } from '../types/purchase'
import ProductDetailPanel from '../components/purchase/ProductDetailPanel'
import OrderModal from '../components/purchase/OrderModal'
import UploadProgressModal from '../components/UploadProgressModal'
import PasswordConfirmModal from '../components/common/PasswordConfirmModal'
import CartNameInputModal from '../components/personal-order/CartNameInputModal'
import DropdownMenu, { DropdownItem } from '../components/common/DropdownMenu'
import BulkPriceModal from '../components/purchase/BulkPriceModal'

// ── 상수: 조회수 변동 색상 ────────────────────────────────────
const VIEW_DIFF_THRESHOLD = 10
const COLOR_INCREASE = '#EF4444'  // 빨강 (증가)
const COLOR_DECREASE = '#3B82F6'  // 파랑 (감소)

// ══════════════════════════════════════════════════════════════════
// CellBadge — 셀 내 값 강조용 배지 컴포넌트
// - gray-label : 창고 열 (연회색 배경 라벨)
// - green-label: 창고 열 (입고 입력 시 연초록 배경 라벨)
// - blue-label : 추천 열 (연파랑 배경 라벨)
// - blue-circle: C.재고 열 (파랑 테두리 동그라미)
// ══════════════════════════════════════════════════════════════════

type BadgeVariant = 'gray-label' | 'green-label' | 'blue-label' | 'blue-circle'

const BADGE_STYLES: Record<BadgeVariant, React.CSSProperties> = {
  'gray-label': {
    display: 'inline-block',
    padding: '1px 8px',
    borderRadius: '4px',
    background: '#F3F4F6',
    color: '#374151',
    fontSize: '12px',
    fontWeight: 500,
  },
  'green-label': {
    display: 'inline-block',
    padding: '1px 8px',
    borderRadius: '4px',
    background: '#DCFCE7',
    color: '#15803D',
    fontSize: '12px',
    fontWeight: 500,
  },
  'blue-label': {
    display: 'inline-block',
    padding: '1px 8px',
    borderRadius: '4px',
    background: '#EFF6FF',
    color: '#3B82F6',
    fontSize: '12px',
    fontWeight: 500,
  },
  'blue-circle': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '20px',
    height: '20px',
    padding: '0 4px',
    borderRadius: '999px',
    border: '1px solid #3B82F6',
    color: '#3B82F6',
    fontSize: '11px',
    fontWeight: 600,
    boxSizing: 'border-box',
  },
}

const CellBadge: React.FC<{
  variant: BadgeVariant
  children: React.ReactNode
}> = ({ variant, children }) => (
  <span style={BADGE_STYLES[variant]}>{children}</span>
)

/**
 * 조회수 V열 색상 결정 헬퍼
 * - 현재 V와 이전 V를 비교하여 차이가 ±10 초과 시 색상 반환
 * - V1(dateIdx=0)은 비교 대상 없음 → undefined
 * - 이전 V 데이터 없음 → undefined (기본색 유지)
 */
const getViewDiffColor = (
  current: number,
  dateIdx: number,
  itemViews: Map<string, number> | undefined,
  recentDates: string[],
): string | undefined => {
  if (dateIdx === 0 || !itemViews) return undefined

  const prevDate = recentDates[dateIdx - 1]
  if (!prevDate) return undefined

  const prev = itemViews.get(prevDate)
  if (prev == null) return undefined

  const diff = current - prev
  if (diff > VIEW_DIFF_THRESHOLD) return COLOR_INCREASE
  if (diff < -VIEW_DIFF_THRESHOLD) return COLOR_DECREASE
  return undefined
}

const PurchaseManagement: React.FC = () => {
  const {
    searchValue,
    setSearchValue,
    searchMode,
    setSearchMode,
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
    sort,
    handleSortToggle,
    setSortDir,
    salesPeriod,
    setSalesPeriod,
    statusFilter,
    setStatusFilter,
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
    shipmentSizeExcelInputRef,
    handleShipmentSizeExcelUpload,
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
    editingCell,
    editingCellValue,
    setEditingCellValue,
    handleCellClick,
    handleCellBlur,
    editingNoteId,
    noteDraft,
    setNoteDraft,
    handleNoteClick,
    handleNoteBlur,
    pendingNotes,
    saveDetailNote,
    pendingEdits,
    saving,
    handleSaveInputs,
    resettingInputs,
    handleResetInputs,
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
    isOrderLoading,
    loadOrderDelta,
    bulkRunning,
    bulkProgress,
    handleBulkPrice,
    handleBulkSale,
    statusSaving,
    handleBulkItemStatus,
    warehouseQtyMap,
    copying,
    handleCopy,
    pageSize,
    setPageSize,
    orderSending,
    orderSendModalOpen,
    setOrderSendModalOpen,
    handleOrderSend,
    handleConfirmOrderSend,
  } = usePurchaseManagement()

  // ── 주문 모달 open 상태 ─────────────────────────────────────
  const [orderModalOpen, setOrderModalOpen] = useState(false)

  // ── 리셋 확인 모달 (비밀번호 재확인) ────────────────────────
  const [resetModalOpen, setResetModalOpen] = useState(false)

  // ── 일괄 가격수정 모달 ───────────────────────────────────────
  const [bulkPriceModalOpen, setBulkPriceModalOpen] = useState(false)

  // ── 테이블 풀스크린 토글 (🔍 버튼) ──────────────────────────
  //   활성 시 .purchase-table-section.fullscreen 으로 viewport 전체 덮음
  //   Esc 키 종료 — 활성 상태일 때만 리스너 등록
  const [isTableFullscreen, setIsTableFullscreen] = useState(false)
  useEffect(() => {
    if (!isTableFullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsTableFullscreen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isTableFullscreen])

  // ── Ctrl/Cmd + S → [저장] 실행 ───────────────────────────────
  //   브라우저 기본 저장 다이얼로그를 막고, 저장 버튼과 동일 조건일 때만 실행.
  //   최신 상태를 ref 로 참조해 리스너는 1회만 등록.
  const saveShortcutRef = useRef<() => void>(() => {})
  saveShortcutRef.current = () => {
    if (!saving && (pendingEdits.size > 0 || pendingNotes.size > 0)) {
      handleSaveInputs()
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveShortcutRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // ── 편집 가능 셀 공통 렌더러 (input / in_qty / out_qty) ─────
  const renderEditableCell = (item: RgItem, field: EditableField, value: number | null) => {
    if (editingCell && editingCell.id === item.id && editingCell.field === field) {
      return (
        <input
          className="purchase-input-cell"
          type="text"
          inputMode="numeric"
          autoFocus
          value={editingCellValue}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            if (e.target.value === '' || /^\d+$/.test(e.target.value)) {
              setEditingCellValue(e.target.value)
            }
          }}
          onBlur={() => handleCellBlur(item.id!, field, value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleCellBlur(item.id!, field, value)
              // 같은 필드에서 Enter=다음 행(아래), Shift+Enter=이전 행(위)
              const currentIdx = pageItems.findIndex((pi) => pi.id === item.id)
              const target = pageItems[currentIdx + (e.shiftKey ? -1 : 1)]
              if (target?.id) {
                handleCellClick(target.id, field, target[field] ?? null)
              }
            }
          }}
        />
      )
    }
    return <span>{value != null ? value : ''}</span>
  }

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
              {item.option_name ? `, ${item.option_name}` : ''}
            </span>
          </span>
        )

      /* ── 편집 가능 열 (입력 / 입고 / 반출) ─────────────── */
      case 'input':
        return renderEditableCell(item, 'input', item.input)
      case 'in_qty':
        return renderEditableCell(item, 'in_qty', item.in_qty ?? null)
      case 'out_qty':
        return renderEditableCell(item, 'out_qty', item.out_qty ?? null)

      /* ── 카트 열(🛒): si_rg_items.cart_qty (선택 카트 합) ── */
      case 'cart': {
        const v = item.cart_qty
        if (v == null || v === 0) return ''
        return v.toLocaleString()
      }

      /* ── 주문 열: si_rg_items.order_qty (주문 🔗 적용 시 영속화된 net) ── */
      case 'order': {
        const v = item.order_qty
        if (v == null || v === 0) return ''
        return v.toLocaleString()
      }

      /* ── JOIN 컬럼: si_rg_item_data 필드 ────────────────── */
      case 'c_in':
        // C.in: 일반 텍스트 (배경 없음)
        return data?.pending_inbounds ? data.pending_inbounds.toLocaleString() : ''
      case 'c_stock': {
        // C.재고: 파란 테두리 동그라미
        const v = data?.orderable_qty
        return v ? <CellBadge variant="blue-circle">{v.toLocaleString()}</CellBadge> : ''
      }

      /* ── 창고 열: si_stocks.qty 합산 (barcode 기준) ────── */
      case 'warehouse': {
        const bc = item.barcode
        if (!bc) return ''
        const qty = warehouseQtyMap.get(bc)
        if (!qty) return ''
        // 입고 입력값이 있으면 초록 라벨, 없으면 회색 라벨
        const hasInQty = item.in_qty != null && item.in_qty > 0
        return (
          <CellBadge variant={hasInQty ? 'green-label' : 'gray-label'}>
            {qty.toLocaleString()}
          </CellBadge>
        )
      }

      case 'd7':
        return data?.recent_sales_qty_7d ? data.recent_sales_qty_7d.toLocaleString() : ''
      case 'd30':
        return data?.recent_sales_qty_30d ? data.recent_sales_qty_30d.toLocaleString() : ''
      case 'recommend': {
        const qty = data?.recommended_inbound_qty
        if (!qty) return ''
        // 1보다 클 때만 파란 배경 라벨로 강조
        return qty > 1
          ? <CellBadge variant="blue-label">{qty.toLocaleString()}</CellBadge>
          : qty.toLocaleString()
      }
      case 'storage': {
        const fee = data?.monthly_storage_fee
        if (!fee) return ''
        return <span style={{ color: '#EF4444' }}>{fee.toLocaleString()}</span>
      }

      /* ── 가격 열 ─────────────────────────────────────────── */
      case 'price':
        return item.sale_price ? item.sale_price.toLocaleString() : ''

      /* ── 조회수 V1~V5 (최근 5개 날짜, V1=가장 오래된, V5=최근) ──
         이전 V와 비교: diff > +10 → 빨강, diff < -10 → 파랑, ±10 이내 → 기본색 */
      case 'v1': case 'v2': case 'v3': case 'v4': case 'v5': {
        const dateIdx = Number(col.key[1]) - 1
        const date = recentViewDates[dateIdx]
        if (!date) return ''

        const itemViews = viewsDataMap.get(item.seller_product_id)
        const views = itemViews?.get(date)
        if (views == null) return ''

        // ── 이전 V 대비 색상 결정 (V1은 비교 대상 없음) ──
        const color = getViewDiffColor(views, dateIdx, itemViews, recentViewDates)

        return color
          ? <span style={{ color }}>{views.toLocaleString()}</span>
          : views.toLocaleString()
      }

      /* ── 기타 ────────────────────────────���───────────────── */
      /* ── 노트(메모): 클릭 → 텍스트 입력, [저장] 시 si_rg_items.note 저장 ── */
      case 'note': {
        if (editingNoteId === item.id) {
          return (
            <input
              className="purchase-input-cell"
              type="text"
              autoFocus
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={() => handleNoteBlur(item.id!, item.note ?? null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleNoteBlur(item.id!, item.note ?? null)
                }
              }}
            />
          )
        }
        return <span>{item.note ?? ''}</span>
      }

      default:
        return ''
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 렌더링
  // ══════════════════════════════════════════════════════════════
  return (
    <div className="purchase-container">

      {/* ── 상단 버튼 영역: 좌측 업데이트·리셋 | 우측 주문·xlsx·바코드·조회수·복사 ── */}
      <div className="purchase-top-actions">
        <div className="purchase-toolbar-left">
          {/* ── 업데이트 ──────────────────────────────────────── */}
          <button
            className="purchase-btn"
            onClick={handleUpdate}
            disabled={updating}
          >
            {updating ? (updateProgress || '업데이트 중...') : '업데이트'}
          </button>

          {/* ── 리셋 (비밀번호 확인 후 실행) ───────────────────── */}
          <button
            className="purchase-btn"
            onClick={() => setResetModalOpen(true)}
            disabled={resetting}
          >
            {resetting ? (updateProgress || '리셋 중...') : '리셋'}
          </button>
        </div>
        <div className="purchase-toolbar-right">
          {/* ── 주문 모달 열기 ────────────────────────────── */}
          <button
            className="purchase-btn"
            onClick={() => setOrderModalOpen(true)}
            disabled={isOrderLoading}
            title="주문 조회 조건 설정"
          >
            {isOrderLoading ? '주문 로딩...' : '주문 🔗'}
          </button>

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

          {/* ── 쉽먼트 사이즈 xlsx (si_coupang_shipment_size upsert) ─── */}
          <label className="purchase-btn" style={{ cursor: 'pointer' }}>
            쉽먼트 사이즈 xlsx
            <input
              ref={shipmentSizeExcelInputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={handleShipmentSizeExcelUpload}
            />
          </label>

          {/* ── 바코드 연결 (공용 DropdownMenu: api / xlsx) ──── */}
          <DropdownMenu label="바코드 연결">
            <DropdownItem onClick={handleBarcodeSync} disabled={barcodesyncing}>
              {barcodesyncing ? (barcodeSyncProgress || '연동 중...') : 'api'}
            </DropdownItem>
            <label className="dropdown-item" style={{ cursor: 'pointer' }}>
              xlsx
              <input
                ref={barcodeExcelInputRef}
                type="file"
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
                onChange={handleBarcodeExcel}
              />
            </label>
          </DropdownMenu>

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

          {/* ── 복사 (구글 시트 TSV: input > 0 행만) ──────────── */}
          <button
            className="purchase-btn"
            onClick={handleCopy}
            disabled={copying}
            title="입력 수량이 있는 행을 구글 시트용 TSV로 클립보드 복사"
          >
            {copying ? '복사 중...' : '복사'}
          </button>

          {/* ── 장바구니 (ft_carts + ft_cart_items: input > 0 행만) ── */}
          <button
            className="purchase-btn"
            onClick={handleOrderSend}
            disabled={orderSending}
            title="입력 값이 있는 행을 ft_cart_items 로 전송"
          >
            {orderSending ? '전송 중...' : '장바구니'}
          </button>
        </div>
      </div>

      {/* ── 타이틀 ──────────────────────────────────────────── */}
      <div className="purchase-header">
        <h1 className="purchase-title">사입관리</h1>
      </div>

      {/* ── 검색 영역 (좌: 검색모드 드롭박스 | 검색 입력폼) ──── */}
      <div className="purchase-search-row">
        {/* ── 검색 모드: 상품검색 / 노트검색 (테두리·배경 없는 드롭박스) ── */}
        <DropdownMenu
          label={`${searchMode === 'note' ? '노트검색' : '상품검색'} ▾`}
          triggerClassName="purchase-search-mode-trigger"
        >
          <DropdownItem
            className={searchMode === 'product' ? 'active' : ''}
            onClick={() => setSearchMode('product')}
          >
            상품검색
          </DropdownItem>
          <DropdownItem
            className={searchMode === 'note' ? 'active' : ''}
            onClick={() => setSearchMode('note')}
          >
            노트검색
          </DropdownItem>
        </DropdownMenu>

        <div className="purchase-search-bar">
        <input
          className="purchase-search-input"
          type="text"
          placeholder={
            searchMode === 'note'
              ? '노트(메모) 내용으로 검색 (콤마·여러 줄 붙여넣기로 다중 검색)'
              : '상품명, 바코드 또는 ID로 검색 (콤마·여러 줄 붙여넣기로 다중 검색)'
          }
          value={searchValue}
          onChange={(e) => {
            setSearchValue(e.target.value)
            if (e.target.value === '') handleSearchClear()
          }}
          onPaste={(e) => {
            // 구글 시트 세로 복사 = 개행 구분. 단일 라인 input 은 개행을 버리므로
            // 붙여넣기 시점에 개행/탭을 콤마로 변환해 다중 검색어로 보존한다.
            const text = e.clipboardData.getData('text')
            if (/[\n\r\t]/.test(text)) {
              e.preventDefault()
              const joined = text
                .split(/[\n\r\t]+/)
                .map((s) => s.trim())
                .filter(Boolean)
                .join(', ')
              setSearchValue(joined)
            }
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
        />
        </div>
      </div>

      {/* ── 테이블 영역 (풀스크린 시 바로 위 툴바까지 함께 유지) ── */}
      <div className={`purchase-table-area${isTableFullscreen ? ' fullscreen' : ''}`}>
      {/* ── 필터 툴바 (좌: 필터, 우: 저장) ──────────────────── */}
      <div className="purchase-table-toolbar">
        <div className="purchase-toolbar-left">
          {/* ── 페이지 크기 선택 (드롭다운) ─────────────────── */}
          <div className="purchase-dropdown">
            <button className="purchase-filter-btn">{pageSize}개씩</button>
            <div className="purchase-dropdown-menu">
              {PAGE_SIZE_OPTIONS.map((n) => (
                <button
                  key={n}
                  className="purchase-dropdown-item"
                  onClick={() => setPageSize(n)}
                >
                  {n}개
                </button>
              ))}
            </div>
          </div>

          {/* ── 판매량 정렬 드롭박스 (기간 7/30일 + 오름/내림/전체) ── */}
          <DropdownMenu
            label={`판매량${sort?.key === 'sales' ? ` · ${salesPeriod === '30d' ? '30일' : '7일'} ${sort.dir === 'desc' ? '▼' : '▲'}` : ''}`}
            triggerClassName={`purchase-sort-trigger${sort?.key === 'sales' ? ' active' : ''}`}
          >
            <DropdownItem className={sort?.key !== 'sales' ? 'active' : ''} onClick={() => setSortDir('sales', null)}>전체</DropdownItem>
            <div className="purchase-dropdown-section">기간</div>
            <DropdownItem className={sort?.key === 'sales' && salesPeriod === '7d' ? 'active' : ''} onClick={() => setSalesPeriod('7d')}>7일</DropdownItem>
            <DropdownItem className={sort?.key === 'sales' && salesPeriod === '30d' ? 'active' : ''} onClick={() => setSalesPeriod('30d')}>30일</DropdownItem>
            <div className="purchase-dropdown-section">정렬</div>
            <DropdownItem className={sort?.key === 'sales' && sort.dir === 'asc' ? 'active' : ''} onClick={() => setSortDir('sales', 'asc')}>오름차순</DropdownItem>
            <DropdownItem className={sort?.key === 'sales' && sort.dir === 'desc' ? 'active' : ''} onClick={() => setSortDir('sales', 'desc')}>내림차순</DropdownItem>
          </DropdownMenu>

          {/* ── 보관료 정렬 드롭박스 (오름/내림/전체) ── */}
          <DropdownMenu
            label={`보관료${sort?.key === 'storage' ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : ''}`}
            triggerClassName={`purchase-sort-trigger${sort?.key === 'storage' ? ' active' : ''}`}
          >
            <DropdownItem className={sort?.key !== 'storage' ? 'active' : ''} onClick={() => setSortDir('storage', null)}>전체</DropdownItem>
            <DropdownItem className={sort?.key === 'storage' && sort.dir === 'asc' ? 'active' : ''} onClick={() => setSortDir('storage', 'asc')}>오름차순</DropdownItem>
            <DropdownItem className={sort?.key === 'storage' && sort.dir === 'desc' ? 'active' : ''} onClick={() => setSortDir('storage', 'desc')}>내림차순</DropdownItem>
          </DropdownMenu>

          {/* ── 재고량 정렬 드롭박스 (오름/내림/전체) — C.재고 기준 ── */}
          <DropdownMenu
            label={`재고량${sort?.key === 'stock' ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : ''}`}
            triggerClassName={`purchase-sort-trigger${sort?.key === 'stock' ? ' active' : ''}`}
          >
            <DropdownItem className={sort?.key !== 'stock' ? 'active' : ''} onClick={() => setSortDir('stock', null)}>전체</DropdownItem>
            <DropdownItem className={sort?.key === 'stock' && sort.dir === 'asc' ? 'active' : ''} onClick={() => setSortDir('stock', 'asc')}>오름차순</DropdownItem>
            <DropdownItem className={sort?.key === 'stock' && sort.dir === 'desc' ? 'active' : ''} onClick={() => setSortDir('stock', 'desc')}>내림차순</DropdownItem>
          </DropdownMenu>

          {/* ── 구분자 ─────────────────────────────────────── */}
          <span className="purchase-separator">|</span>

          {/* ── 입력 컬럼 기반 필터 (입력 / 주문 / 입고 / 반출) ─ */}
          <button
            className={`purchase-filter-btn${activeFilter === 'input' ? ' active' : ''}`}
            onClick={() => handleFilterToggle('input')}
            title="입력(input) 수량이 1 이상인 행"
          >
            입력
          </button>
          <button
            className={`purchase-filter-btn${activeFilter === 'order' ? ' active' : ''}`}
            onClick={() => handleFilterToggle('order')}
            title="주문(order_qty) 수량이 1 이상인 행"
          >
            주문
          </button>
          <button
            className={`purchase-filter-btn${activeFilter === 'in_qty' ? ' active' : ''}`}
            onClick={() => handleFilterToggle('in_qty')}
            title="입고 수량이 1 이상인 행"
          >
            입고
          </button>
          <button
            className={`purchase-filter-btn${activeFilter === 'out_qty' ? ' active' : ''}`}
            onClick={() => handleFilterToggle('out_qty')}
            title="반출 수량이 1 이상인 행"
          >
            반출
          </button>

          {/* ── 구분자 ─────────────────────────────────────── */}
          <span className="purchase-separator">|</span>

          {/* ── 바코드 없는 행 필터 ───────────────────────── */}
          <button
            className={`purchase-filter-btn${activeFilter === 'no_barcode' ? ' active' : ''}`}
            onClick={() => handleFilterToggle('no_barcode')}
            title="바코드가 비어있는 행"
          >
            NO 바코드
          </button>

          {/* ── 상태 필터 (활성/비활성/전체) — 기본 '활성'(비활성 숨김) ── */}
          <DropdownMenu
            label={`${statusFilter === 'inactive' ? '비활성' : statusFilter === 'all' ? '전체' : '활성'} ▾`}
            triggerClassName={`purchase-status-trigger${statusFilter !== 'active' ? ' active' : ''}`}
          >
            <DropdownItem
              className={statusFilter === 'active' ? 'active' : ''}
              onClick={() => setStatusFilter('active')}
            >
              활성
            </DropdownItem>
            <DropdownItem
              className={statusFilter === 'inactive' ? 'active' : ''}
              onClick={() => setStatusFilter('inactive')}
            >
              비활성
            </DropdownItem>
            <DropdownItem
              className={statusFilter === 'all' ? 'active' : ''}
              onClick={() => setStatusFilter('all')}
            >
              전체
            </DropdownItem>
          </DropdownMenu>

          {/* ── 📌 노트 필터 (note 데이터 있는 행) ───────────── */}
          <button
            className={`purchase-filter-btn${activeFilter === 'note' ? ' active' : ''}`}
            onClick={() => handleFilterToggle('note')}
            title="노트(메모) 데이터가 있는 행"
          >
            📌
          </button>

          {activeFilter && (
            <span className="purchase-filter-count">
              {filteredCount.toLocaleString()}건
            </span>
          )}
        </div>
        <div className="purchase-toolbar-right">
          {/* ── 테이블 풀스크린 토글 (비활성화 버튼 왼쪽) ────── */}
          <button
            className="purchase-icon-btn"
            onClick={() => setIsTableFullscreen((v) => !v)}
            title={isTableFullscreen ? '풀스크린 종료 (Esc)' : '테이블 풀스크린'}
            aria-label="테이블 풀스크린 토글"
          >
            {isTableFullscreen ? '🗗' : '🔍'}
          </button>

          {/* ── 일괄 비활성화/활성화 (item_status) ─────────────── */}
          <DropdownMenu
            label={statusSaving ? '처리 중...' : '비활성화'}
            align="right"
            disabled={statusSaving || selectedIds.size === 0}
          >
            <DropdownItem
              onClick={() => {
                if (confirm(`체크한 ${selectedIds.size}건을 '비활성화'할까요?`)) handleBulkItemStatus('NOT_AVAILABLE')
              }}
            >
              비활성화
            </DropdownItem>
            <DropdownItem
              onClick={() => {
                if (confirm(`체크한 ${selectedIds.size}건을 '활성화'(복원)할까요?`)) handleBulkItemStatus(null)
              }}
            >
              활성화
            </DropdownItem>
          </DropdownMenu>

          {/* ── 일괄 가격수정 (체크된 행 동일가 적용) ──────────── */}
          <button
            className="purchase-btn"
            onClick={() => setBulkPriceModalOpen(true)}
            disabled={bulkRunning || selectedIds.size === 0}
            title="체크된 행에 동일 가격 일괄 적용"
          >
            {bulkRunning ? (bulkProgress || '처리 중...') : '가격수정'}
          </button>

          {/* ── 일괄 판매상태 (전체 판매중 / 판매중지) ─────────── */}
          <DropdownMenu
            label={bulkRunning ? (bulkProgress || '처리 중...') : '판매상태'}
            align="right"
            disabled={bulkRunning || selectedIds.size === 0}
          >
            <DropdownItem
              onClick={() => {
                if (confirm(`체크한 ${selectedIds.size}건을 '판매중'으로 변경할까요?`)) handleBulkSale('resume')
              }}
            >
              전체 판매중
            </DropdownItem>
            <DropdownItem
              onClick={() => {
                if (confirm(`체크한 ${selectedIds.size}건을 '판매중지'로 변경할까요?`)) handleBulkSale('stop')
              }}
            >
              전체 판매중지
            </DropdownItem>
          </DropdownMenu>

          <button
            className="purchase-btn"
            onClick={handleResetInputs}
            disabled={resettingInputs}
          >
            {resettingInputs ? '초기화 중...' : '입력 초기화'}
          </button>
          <button
            className="purchase-btn purchase-save-btn"
            onClick={handleSaveInputs}
            disabled={saving || (pendingEdits.size === 0 && pendingNotes.size === 0)}
          >
            {saving
              ? '저장 중...'
              : `저장${pendingEdits.size + pendingNotes.size > 0 ? ` (${pendingEdits.size + pendingNotes.size})` : ''}`}
          </button>
        </div>
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
                    {COLUMNS.map((c) => {
                      const cls = [
                        c.isProduct && 'col-product',
                        c.isInput && 'col-input',
                        c.colClass,
                        c.borderLeft && 'col-border-left',
                      ].filter(Boolean).join(' ')
                      return (
                        <th key={c.key} className={cls}>
                          {c.label}
                        </th>
                      )
                    })}
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
                      const isDisabled = item.item_status === 'NOT_AVAILABLE'
                      return (
                        <tr
                          key={item.id ?? `${item.seller_product_id}-${item.seller_product_item_id}-${idx}`}
                          className={isDisabled ? 'purchase-row-disabled' : undefined}
                        >
                          <td>
                            <input
                              type="checkbox"
                              className="purchase-checkbox"
                              checked={selectedIds.has(rowId)}
                              onChange={(e) => handleSelectRow(rowId, e.target.checked)}
                            />
                          </td>
                          {COLUMNS.map((c) => {
                            const cls = [
                              c.isProduct && 'col-product',
                              c.isInput && 'col-input',
                              c.colClass,
                              c.borderLeft && 'col-border-left',
                            ].filter(Boolean).join(' ')
                            return (
                              <td
                                key={c.key}
                                className={cls}
                                onClick={
                                  c.isProduct
                                    ? () => handleProductClick(item)
                                    : c.editable
                                      ? () => {
                                          const field = c.key as EditableField
                                          if (!(editingCell && editingCell.id === item.id && editingCell.field === field)) {
                                            handleCellClick(item.id!, field, item[field] ?? null)
                                          }
                                        }
                                      : c.editableText
                                        ? () => {
                                            if (editingNoteId !== item.id) {
                                              handleNoteClick(item.id!, item.note ?? null)
                                            }
                                          }
                                        : undefined
                                }
                                style={c.isProduct || c.editable || c.editableText ? { cursor: 'pointer' } : undefined}
                              >
                                {renderCell(c, item)}
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
      </div>

      {/* ── 상품 상세 슬라이드 패널 ────────────────────────── */}
      <ProductDetailPanel
        isOpen={detailPanelOpen}
        onClose={() => setDetailPanelOpen(false)}
        item={detailItem}
        itemWinner={detailItem ? getItemData(detailItem)?.item_winner : undefined}
        displayedProductId={detailItem ? (getItemData(detailItem)?.item_id ?? null) : null}
        onSaveNote={(note) => { if (detailItem?.id) saveDetailNote(detailItem.id, note) }}
      />

      {/* ── 엑셀 업로드 프로그레스 모달 ────────────────────── */}
      <UploadProgressModal
        isOpen={isUploading}
        progress={uploadProgress}
        status={uploadStatus}
        title="재고 SKU 엑셀 업로드 중"
      />

      {/* ── 주문 조회 조건 모달 ──────────────────────────── */}
      <OrderModal
        isOpen={orderModalOpen}
        onClose={() => setOrderModalOpen(false)}
        onApply={loadOrderDelta}
      />

      {/* ── 리셋 비밀번호 확인 모달 ──────────────────────────── */}
      <PasswordConfirmModal
        isOpen={resetModalOpen}
        onClose={() => setResetModalOpen(false)}
        onConfirm={async () => {
          setResetModalOpen(false)
          await handleReset()
        }}
        title="리셋 확인"
        description="사입관리 데이터를 리셋합니다. 계속하려면 비밀번호를 입력해주세요."
        confirmLabel="리셋"
        confirmVariant="danger"
      />

      {/* ── 주문 전송 — 카트 이름 입력 모달 ───────────────────── */}
      <CartNameInputModal
        isOpen={orderSendModalOpen}
        onClose={() => setOrderSendModalOpen(false)}
        onSubmit={handleConfirmOrderSend}
        loading={orderSending}
      />

      {/* ── 일괄 가격수정 모달 ─────────────────────────────────── */}
      <BulkPriceModal
        isOpen={bulkPriceModalOpen}
        count={selectedIds.size}
        loading={bulkRunning}
        onClose={() => setBulkPriceModalOpen(false)}
        onSubmit={(price) => {
          setBulkPriceModalOpen(false)
          handleBulkPrice(price)
        }}
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
