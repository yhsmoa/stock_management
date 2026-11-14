// ═══════════════════════════════════════════════════════════════════
// 재고관리 (/inventory)
//   - 화면 틀은 쿠팡관리 하위 화면(사입관리 · 반출관리)과 같은 purchase-* 스타일
//     (PurchaseManagement.css) — 여기에만 필요한 규칙은 Inventory.css (.inv-)
//   - 상태 · 동작은 useInventory, DB 작업은 services/stockService.ts
//   - [엑셀 추가] (추가 · 차감) 은 StockExcelImportModal — 여기서는 열고 닫기만
// ═══════════════════════════════════════════════════════════════════

import React, { useEffect, useState } from 'react'
import './PurchaseManagement.css'
import './Inventory.css'
import DropdownMenu, { DropdownItem } from '../components/common/DropdownMenu'
import InventoryTable from '../components/inventory/InventoryTable'
import StockExcelImportModal from '../components/inventory/StockExcelImportModal'
import { useInventory, STOCK_SEARCH_TYPE_LABELS, type StockSearchType } from './useInventory'

// ── 툴바 보조 필터 (위치 · 시즌 · 비고) ─────────────────────────────
const SIDE_FILTERS = [
  { key: 'location', placeholder: '위치' },
  { key: 'season',   placeholder: '시즌' },
  { key: 'note',     placeholder: '비고' },
] as const

const SEARCH_TYPES = Object.keys(STOCK_SEARCH_TYPE_LABELS) as StockSearchType[]

const SEARCH_PLACEHOLDERS: Record<StockSearchType, string> = {
  productName: '상품명으로 검색 (Enter)',
  barcode: '바코드로 검색 (Enter)',
}

const Inventory: React.FC = () => {
  const inv = useInventory()

  // ── [엑셀 추가] 모달 — 닫을 때 쓴 것이 있으면 지금 검색 조건으로 다시 읽기 ──
  const [isImportOpen, setIsImportOpen] = useState(false)
  const closeImport = (changed: boolean) => {
    setIsImportOpen(false)
    if (changed) void inv.reload()
  }

  // ── 테이블 풀스크린 (Esc 로 종료) ──
  const [isTableFullscreen, setIsTableFullscreen] = useState(false)
  useEffect(() => {
    if (!isTableFullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsTableFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isTableFullscreen])

  const onEnterSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) inv.search()
  }

  return (
    <div className="purchase-container">
      {/* ── 상단: 타이틀 · 전체 삭제 | 엑셀 작업 ─────────────── */}
      <div className="purchase-top-actions">
        <div className="purchase-toolbar-left">
          <h1 className="purchase-title">재고관리</h1>
          <button
            className="purchase-btn purchase-reset-btn"
            onClick={inv.deleteAll}
            disabled={inv.isBusy}
            title="이 계정의 재고를 모두 삭제 (검색 조건과 무관)"
          >
            전체 삭제
          </button>
        </div>
        <div className="purchase-toolbar-right">
          <button
            className="purchase-btn"
            onClick={() => setIsImportOpen(true)}
            disabled={inv.isBusy}
            title="엑셀 수량을 재고에 더하거나(추가) 빼기(차감) — 창 안에서 고르고, 열을 맞춘 뒤 검사 결과를 보고 실행"
          >
            엑셀 추가
          </button>
          <button
            className="purchase-btn"
            onClick={inv.downloadExcel}
            disabled={inv.isBusy}
            title="체크한 행이 있으면 그 행만, 없으면 지금 목록 전체"
          >
            엑셀 다운
          </button>
        </div>
      </div>

      {inv.error && <div className="inv-error-banner">{inv.error}</div>}

      {/* ── 검색: 상품명/바코드 + 검색어 ─────────────────────── */}
      <div className="purchase-search-row">
        <DropdownMenu
          label={`${STOCK_SEARCH_TYPE_LABELS[inv.filters.searchType]} ▾`}
          triggerClassName="purchase-search-mode-trigger"
        >
          {SEARCH_TYPES.map(type => (
            <DropdownItem
              key={type}
              className={inv.filters.searchType === type ? 'active' : ''}
              onClick={() => inv.updateFilter('searchType', type)}
            >
              {STOCK_SEARCH_TYPE_LABELS[type]}
            </DropdownItem>
          ))}
        </DropdownMenu>
        <div className="purchase-search-bar">
          <input
            className="purchase-search-input"
            type="text"
            placeholder={SEARCH_PLACEHOLDERS[inv.filters.searchType]}
            value={inv.filters.searchKeyword}
            onChange={e => inv.updateFilter('searchKeyword', e.target.value)}
            onKeyDown={onEnterSearch}
          />
        </div>
      </div>

      {/* ── 표 영역 (풀스크린 시 툴바까지 함께) ─────────────── */}
      <div className={`purchase-table-area${isTableFullscreen ? ' fullscreen' : ''}`}>
        {/* ── 툴바: 위치·시즌·비고 · 건수 | 풀스크린 · 선택 삭제 ── */}
        <div className="purchase-table-toolbar">
          <div className="purchase-toolbar-left">
            {SIDE_FILTERS.map(f => (
              <input
                key={f.key}
                className="inv-filter-input"
                type="text"
                placeholder={f.placeholder}
                value={inv.filters[f.key]}
                onChange={e => inv.updateFilter(f.key, e.target.value)}
                onKeyDown={onEnterSearch}
              />
            ))}
            <button className="purchase-filter-btn" onClick={inv.search} disabled={inv.isLoading}>
              검색
            </button>
            <span className="purchase-filter-count">
              {inv.stocks.length.toLocaleString()}건 · 수량 {inv.totalQty.toLocaleString()}
              {inv.selectedIds.size > 0 ? ` · 선택 ${inv.selectedIds.size.toLocaleString()}` : ''}
            </span>
          </div>
          <div className="purchase-toolbar-right">
            <button
              className="purchase-icon-btn"
              onClick={() => setIsTableFullscreen(v => !v)}
              title={isTableFullscreen ? '풀스크린 종료 (Esc)' : '테이블 풀스크린'}
              aria-label="테이블 풀스크린 토글"
            >
              {isTableFullscreen ? '🗗' : '🔍'}
            </button>
            <button
              className="purchase-btn inv-delete-btn"
              onClick={inv.deleteSelected}
              disabled={inv.isBusy || inv.selectedIds.size === 0}
            >
              선택 삭제{inv.selectedIds.size > 0 ? ` (${inv.selectedIds.size.toLocaleString()})` : ''}
            </button>
          </div>
        </div>

        {/* ── 표 · 페이지 ─────────────────────────────────── */}
        <div className="purchase-table-section">
          {inv.isLoading ? (
            <div className="purchase-loading">데이터를 불러오는 중...</div>
          ) : (
            <>
              <InventoryTable
                rows={inv.pageRows}
                selectedIds={inv.selectedIds}
                isPageAllSelected={inv.isPageAllSelected}
                onToggleRow={inv.toggleRow}
                onTogglePage={inv.togglePage}
              />
              {inv.totalPages > 1 && (
                <div className="purchase-pagination">
                  <div className="purchase-pagination-controls">
                    <button
                      className="purchase-pagination-btn"
                      disabled={inv.currentPage === 1}
                      onClick={() => inv.goToPage(inv.currentPage - 1)}
                    >
                      이전
                    </button>
                    {inv.pageNumbers.map((p, i) =>
                      p === 'ellipsis' ? (
                        <span key={`e-${i}`} className="purchase-pagination-ellipsis">…</span>
                      ) : (
                        <button
                          key={p}
                          className={`purchase-pagination-btn${inv.currentPage === p ? ' active' : ''}`}
                          onClick={() => inv.goToPage(p)}
                        >
                          {p}
                        </button>
                      ),
                    )}
                    <button
                      className="purchase-pagination-btn"
                      disabled={inv.currentPage === inv.totalPages}
                      onClick={() => inv.goToPage(inv.currentPage + 1)}
                    >
                      다음
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {isImportOpen && <StockExcelImportModal onClose={closeImport} />}
    </div>
  )
}

export default Inventory
