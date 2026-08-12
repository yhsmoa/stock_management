/* ================================================================
   반출관리 (OutboundManagement) — 렌더링 컴포넌트
   - 로직은 useOutboundManagement 훅에서 관리
   - 화면 구성(툴바·검색·표·페이지네이션)은 사입관리와 동일하므로
     PurchaseManagement.css 를 그대로 재사용한다.
   ================================================================ */

import React, { useState, useEffect } from 'react'
import './PurchaseManagement.css'
import './OutboundManagement.css'
import {
  useOutboundManagement,
  OUTBOUND_COLUMNS,
  PAGE_SIZE_OPTIONS,
  makeOutboundKey,
  rowKeyOf,
  gradeEmoji,
} from './useOutboundManagement'
import type { RgItemData } from '../types/purchase'
import DropdownMenu, {
  DropdownItem,
  DropdownSubmenu,
} from '../components/common/DropdownMenu'

// ── 상수: [기준] 정렬 키 → 표시명 ─────────────────────────────
const SORT_LABELS: Record<string, string> = {
  storage: '보관비',
  stock:   '재고',
}

// ── 셀 렌더링 ─────────────────────────────────────────────────
//   ID 계열은 원본 그대로, 수량/금액은 천단위 구분, 보관비는 빨강.
const renderCell = (col: typeof OUTBOUND_COLUMNS[number], row: RgItemData): React.ReactNode => {
  const value = row[col.key]

  switch (col.key) {
    case 'orderable_qty':
    case 'pending_inbounds': {
      const n = (value as number | null) ?? 0
      return n ? n.toLocaleString() : ''
    }
    case 'monthly_storage_fee': {
      const n = (value as number | null) ?? 0
      if (!n) return ''
      return <span style={{ color: '#EF4444' }}>{n.toLocaleString()}</span>
    }
    default:
      return value == null || value === '' ? '' : String(value)
  }
}

const OutboundManagement: React.FC = () => {
  const {
    loading,
    pageRows,
    filteredCount,
    totals,
    gradeSummary,
    selectedKeys,
    isPageAllSelected,
    handleSelectRow,
    handleSelectAll,
    exporting,
    handleOutboundExcel,
    searchValue,
    setSearchValue,
    handleSearch,
    handleSearchClear,
    sort,
    setSort,
    currentPage,
    totalPages,
    pageSize,
    setPageSize,
    handlePageChange,
    getPageNumbers,
  } = useOutboundManagement()

  // ── 테이블 풀스크린 토글 (🔍 버튼) — Esc 로 종료 ─────────────
  const [isTableFullscreen, setIsTableFullscreen] = useState(false)
  useEffect(() => {
    if (!isTableFullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsTableFullscreen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isTableFullscreen])

  // ══════════════════════════════════════════════════════════════
  // 렌더링
  // ══════════════════════════════════════════════════════════════

  return (
    <div className="purchase-container">

      {/* ── 상단 타이틀 ──────────────────────────────────────── */}
      <div className="purchase-top-actions">
        <div className="purchase-toolbar-left">
          <h1 className="purchase-title">반출관리</h1>
        </div>
      </div>

      {/* ── 상황판 (등급별 재고·건수 + 보관비 총액) ─────────────
           검색 결과 기준으로 집계되어 아래 표와 항상 같은 범위를 본다. */}
      <div className="outbound-board">
        <div className="outbound-board-card">
          <div className="outbound-board-label">📋 전체</div>
          <div className="outbound-board-value">{totals.qty.toLocaleString()}</div>
          <div className="outbound-board-sub">{totals.rows.toLocaleString()}건</div>
        </div>

        {gradeSummary.map((g) => (
          <div key={g.grade} className="outbound-board-card">
            <div className="outbound-board-label">{gradeEmoji(g.grade)} {g.grade}</div>
            <div className="outbound-board-value">{g.qty.toLocaleString()}</div>
            <div className="outbound-board-sub">{g.rows.toLocaleString()}건</div>
          </div>
        ))}

        <div className="outbound-board-card outbound-board-fee">
          <div className="outbound-board-label">💰 보관비</div>
          <div className="outbound-board-value">{totals.fee.toLocaleString()}원</div>
          <div className="outbound-board-sub">월 예상 합계</div>
        </div>
      </div>

      {/* ── 검색 영역 ────────────────────────────────────────── */}
      <div className="purchase-search-row">
        <div className="purchase-search-bar">
          <input
            className="purchase-search-input"
            type="text"
            placeholder="상품명, 옵션명, 등급 또는 ID로 검색 (콤마·여러 줄 붙여넣기로 다중 검색)"
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
        {/* ── 툴바 (좌: 페이지 크기·정렬·건수 | 우: 풀스크린) ── */}
        <div className="purchase-table-toolbar">
          <div className="purchase-toolbar-left">
            {/* ── 페이지 크기 선택 ─────────────────────────── */}
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

            {/* ── [기준] 정렬 드롭박스 (보관비 / 재고) ────────
                 상품명+옵션명이 같은 행은 묶음 합계로 정렬돼 붙어서 나온다. */}
            <DropdownMenu
              label={`기준 · ${SORT_LABELS[sort.key]} ${sort.dir === 'desc' ? '▼' : '▲'}`}
              triggerClassName="purchase-sort-trigger active"
              hasSubmenu
            >
              <DropdownSubmenu
                label="보관비"
                className={sort.key === 'storage' ? 'active' : ''}
              >
                <DropdownItem className={sort.key === 'storage' && sort.dir === 'asc' ? 'active' : ''} onClick={() => setSort('storage', 'asc')}>오름차순</DropdownItem>
                <DropdownItem className={sort.key === 'storage' && sort.dir === 'desc' ? 'active' : ''} onClick={() => setSort('storage', 'desc')}>내림차순</DropdownItem>
              </DropdownSubmenu>

              <DropdownSubmenu
                label="재고"
                className={sort.key === 'stock' ? 'active' : ''}
              >
                <DropdownItem className={sort.key === 'stock' && sort.dir === 'asc' ? 'active' : ''} onClick={() => setSort('stock', 'asc')}>오름차순</DropdownItem>
                <DropdownItem className={sort.key === 'stock' && sort.dir === 'desc' ? 'active' : ''} onClick={() => setSort('stock', 'desc')}>내림차순</DropdownItem>
              </DropdownSubmenu>
            </DropdownMenu>

            {/* 합계는 상단 상황판에 있으므로 여기서는 건수·선택수만 */}
            <span className="purchase-filter-count">
              {filteredCount.toLocaleString()}건
              {selectedKeys.size > 0 ? ` · 선택 ${selectedKeys.size.toLocaleString()}` : ''}
            </span>
          </div>

          <div className="purchase-toolbar-right">
            <button
              className="purchase-icon-btn"
              onClick={() => setIsTableFullscreen((v) => !v)}
              title={isTableFullscreen ? '풀스크린 종료 (Esc)' : '테이블 풀스크린'}
              aria-label="테이블 풀스크린 토글"
            >
              {isTableFullscreen ? '🗗' : '🔍'}
            </button>

            {/* ── 반출 xlsx — Option ID 20개씩 콤마로 묶어 내려받기 ──
                 체크된 행이 있으면 그 행만, 없으면 현재 목록 전체 */}
            <button
              className="purchase-btn outbound-export-btn"
              onClick={handleOutboundExcel}
              disabled={exporting || filteredCount === 0}
              title="Option ID 를 20개씩 콤마로 묶은 xlsx 내려받기 (체크된 행이 있으면 그 행만)"
            >
              {exporting ? '생성 중...' : '반출 xlsx'}
            </button>
          </div>
        </div>

        {/* ── 테이블 섹션 ───────────────────────────────────── */}
        <div className="purchase-table-section">
          {loading ? (
            <div className="purchase-loading">데이터를 불러오는 중...</div>
          ) : (
            <>
              <div className="purchase-table-wrapper">
                <table className="purchase-table outbound-table">
                  {/* ── colgroup ──────────────────────────── */}
                  <colgroup>
                    <col style={{ width: '30px' }} />
                    {OUTBOUND_COLUMNS.map((c) => (
                      <col key={c.key} style={{ width: c.width }} />
                    ))}
                  </colgroup>

                  {/* ── thead ─────────────────────────────── */}
                  <thead>
                    <tr>
                      <th className="col-checkbox">
                        <input
                          type="checkbox"
                          className="purchase-checkbox"
                          checked={isPageAllSelected}
                          onChange={(e) => handleSelectAll(e.target.checked)}
                        />
                      </th>
                      {OUTBOUND_COLUMNS.map((c) => (
                        <th key={c.key} className={c.isText ? 'col-product' : undefined}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  {/* ── tbody ─────────────────────────────── */}
                  <tbody>
                    {pageRows.length === 0 ? (
                      <tr>
                        <td colSpan={OUTBOUND_COLUMNS.length + 1} className="purchase-table-empty">
                          데이터가 없습니다
                        </td>
                      </tr>
                    ) : (
                      pageRows.map((row, idx) => {
                        // 묶음(상품명+옵션명)이 바뀌는 행에 구분선을 넣는다
                        const prev = idx > 0 ? pageRows[idx - 1] : null
                        const groupStart =
                          !!prev && makeOutboundKey(prev) !== makeOutboundKey(row)
                        const rowKey = rowKeyOf(row)
                        return (
                          <tr
                            key={`${rowKey}-${idx}`}
                            className={groupStart ? 'outbound-group-start' : undefined}
                          >
                            <td>
                              <input
                                type="checkbox"
                                className="purchase-checkbox"
                                checked={selectedKeys.has(rowKey)}
                                onChange={(e) => handleSelectRow(rowKey, e.target.checked)}
                              />
                            </td>
                            {OUTBOUND_COLUMNS.map((c) => (
                              <td
                                key={c.key}
                                className={c.isText ? 'col-product' : undefined}
                                title={c.isText ? String(row[c.key] ?? '') : undefined}
                              >
                                {renderCell(c, row)}
                              </td>
                            ))}
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* ── 페이지네이션 ──────────────────────────── */}
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
    </div>
  )
}

export default OutboundManagement
