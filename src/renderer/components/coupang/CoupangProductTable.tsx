/* ================================================================
   상품관리 — 목록 (상품 묶음 머리줄 + 옵션 줄) · 페이지 이동
   - 페이지는 상품 단위(50개, 이전/다음)다. 상품마다 조건에 맞는 옵션이 전부 실려 온다.
   - 상품은 기본으로 접혀 있고, 머리줄을 누르면 옵션이 펼쳐진다 (옵션은 옵션명 순 — 훅에서 정렬).
     접힌 상태에서도 머리줄에 조건에 맞는 옵션 수 · 가격 범위 · 재고 합을 보여 준다.
   - 머리줄의 "옵션 N개 · 판매중 M" 은 조건과 무관한 상품 전체 옵션 기준(summary)
   ================================================================ */

import React from 'react'
import type { CoupangProductGroup, CoupangProductRow } from '../../types/coupangProduct'
import { PACKAGE_TYPE_OPTIONS, productKind, rowChannel } from '../../types/coupangProduct'
import { won, num, relativeTime } from './format'

interface Props {
  groups: CoupangProductGroup[]
  loading: boolean
  error: string | null
  selected: Map<string, CoupangProductRow>
  noteEditing: { optionId: string; value: string } | null
  // 페이지 (상품 단위 · 이전/다음)
  page: number
  productsPerPage: number
  /** 지금 조건에 맞는 옵션 수 (판매상태 칩 건수에서). 아직 모르면 null */
  optionCount: number | null
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  onFirst: () => void
  // 펼치기
  expanded: Set<string>
  onToggleExpand: (itemId: string) => void
  onExpandAll: () => void
  onCollapseAll: () => void
  // 동작
  onToggleOption: (row: CoupangProductRow, checked: boolean) => void
  onToggleRows: (rows: CoupangProductRow[], checked: boolean) => void
  onOpenDetail: (itemId: string) => void
  onFetchDetail: (itemId: string) => void
  onPackageType: (optionId: string, value: string) => void
  onStartNote: (row: CoupangProductRow) => void
  onNoteValue: (value: string) => void
  onCommitNote: () => void
  onDelete: (optionId: string) => void
}

// ── 아이콘 ────────────────────────────────────────────────────────
const ImageIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 17l-5-5-9 8" />
  </svg>
)
const ChevronIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
)
const PanelIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M14 4v16" />
  </svg>
)
const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
)

// ── 판매상태 칩 ──────────────────────────────────────────────────
function StatusChip({ row }: { row: CoupangProductRow }) {
  if (row.sales_status === '판매중') {
    if (row.stock === 0) return <span className="cp-status cp-status-zero">재고 0</span>
    return <span className="cp-status cp-status-on">판매중</span>
  }
  if (row.sales_status === '판매중지') return <span className="cp-status cp-status-off">판매중지</span>
  return <span className="cp-status cp-status-unknown">미확인</span>
}

// ── 상품 구분 배지 ───────────────────────────────────────────────
function KindBadge({ group }: { group: CoupangProductGroup }) {
  const kind = productKind(group.summary, group.rows)
  if (kind === 'hybrid') return <span className="cp-badge cp-badge-hybrid">전체 (로켓 + 일반)</span>
  if (kind === 'rg') return <span className="cp-badge cp-badge-rg">로켓그로스</span>
  return <span className="cp-badge cp-badge-mp">일반</span>
}

// ── 접힌 머리줄 요약 — 조건에 맞는 옵션의 가격 범위 · 재고 합 ──────
function rowsOverview(rows: CoupangProductRow[]): { price: string; stock: string } {
  const prices = rows.map((r) => r.price).filter((p): p is number => p != null)
  const stocks = rows.map((r) => r.stock).filter((s): s is number => s != null)
  const min = prices.length ? Math.min(...prices) : null
  const max = prices.length ? Math.max(...prices) : null
  const price = min == null ? '가격 —' : min === max ? won(min) : `${num(min)} ~ ${won(max)}`
  const stock = stocks.length ? `재고 ${num(stocks.reduce((s, v) => s + v, 0))}` : '재고 —'
  return { price, stock }
}

/** 머리줄 빈 곳 클릭 = 펼치기/접기. 버튼·링크·체크박스 클릭은 각자 동작 */
function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('button, a, input, select, textarea, label')
}

const CoupangProductTable: React.FC<Props> = ({
  groups, loading, error, selected, noteEditing,
  page, productsPerPage, optionCount, hasPrev, hasNext, onPrev, onNext, onFirst,
  expanded, onToggleExpand, onExpandAll, onCollapseAll,
  onToggleOption, onToggleRows, onOpenDetail, onFetchDetail,
  onPackageType, onStartNote, onNoteValue, onCommitNote, onDelete,
}) => {
  const openCount = groups.filter((g) => expanded.has(g.itemId)).length

  return (
    <>
      {/* ── 목록 도구 막대 — 펼치기 / 접기 ── */}
      <div className="cp-list-toolbar">
        <div className="cp-num">
          {page}페이지 · 상품 {num(groups.length)}개
          {optionCount != null && ` · 조건에 맞는 옵션 전체 ${num(optionCount)}개`}
        </div>
        <div className="cp-list-toolbar-actions">
          <button type="button" className="cp-btn cp-btn-xs" disabled={groups.length === 0 || openCount === groups.length} onClick={onExpandAll}>모두 펼치기</button>
          <button type="button" className="cp-btn cp-btn-xs" disabled={openCount === 0} onClick={onCollapseAll}>모두 접기</button>
        </div>
      </div>

      <div className="cp-list">
        <div className="cp-list-inner">
          <div className="cp-grid cp-list-head" role="row">
            <div />
            <div>옵션명</div>
            <div>옵션 ID</div>
            <div className="cp-right">판매가 / 기준가</div>
            <div className="cp-right">재고</div>
            <div>판매상태</div>
            <div>바코드 · 상품코드</div>
            <div>분류</div>
            <div>비고</div>
            <div className="cp-right">상태 확인</div>
            <div />
          </div>

          {error && <div className="cp-list-empty" style={{ color: '#B91C1C' }}>{error}</div>}
          {!error && loading && groups.length === 0 && <div className="cp-list-loading">불러오는 중…</div>}
          {!error && !loading && groups.length === 0 && <div className="cp-list-empty">이 조건에 맞는 옵션이 없습니다.</div>}

          {groups.map((g) => {
            const summary = g.summary
            const allChecked = g.rows.length > 0 && g.rows.every((r) => selected.has(r.option_id))
            const someChecked = !allChecked && g.rows.some((r) => selected.has(r.option_id))
            const approvalBad = !!g.approval && g.approval !== '승인완료'
            const detailMissing = !summary?.detailSynced
            const isOpen = expanded.has(g.itemId)
            const overview = rowsOverview(g.rows)
            return (
              <div key={g.itemId} className={`cp-product${isOpen ? ' is-open' : ''}`}>
                {/* ── 상품 머리줄 (빈 곳 클릭 = 펼치기/접기) ── */}
                <div
                  className="cp-product-head"
                  onClick={(e) => { if (!isInteractive(e.target)) onToggleExpand(g.itemId) }}
                >
                  <button
                    type="button"
                    className="cp-expand-btn"
                    aria-expanded={isOpen}
                    aria-label={isOpen ? `${g.itemName} 옵션 접기` : `${g.itemName} 옵션 펼치기`}
                    onClick={() => onToggleExpand(g.itemId)}
                  >
                    <ChevronIcon />
                  </button>
                  <input
                    type="checkbox"
                    className="cp-checkbox"
                    checked={allChecked}
                    ref={(el) => { if (el) el.indeterminate = someChecked }}
                    aria-label={`${g.itemName} 옵션 전체 선택`}
                    onChange={(e) => onToggleRows(g.rows, e.target.checked)}
                  />
                  <div className="cp-product-thumb" aria-hidden="true">
                    {g.imgUrl ? <img src={g.imgUrl} alt="" loading="lazy" /> : <ImageIcon />}
                  </div>
                  <div className="cp-product-main">
                    <div className="cp-product-name-row">
                      <button type="button" className="cp-product-name" onClick={() => onOpenDetail(g.itemId)}>{g.itemName}</button>
                      <KindBadge group={g} />
                      {approvalBad && <span className="cp-badge cp-badge-warn">{g.approval}</span>}
                    </div>
                    <div className="cp-product-ids cp-num">
                      등록상품 {g.itemId}
                      {' · '}
                      {g.productId
                        ? <a href={`https://www.coupang.com/vp/products/${g.productId}`} target="_blank" rel="noreferrer">노출상품 {g.productId} ↗</a>
                        : '노출상품 ID 없음'}
                      {summary && ` · 옵션 ${num(summary.totalOptions)}개`}
                      {summary && summary.totalOptions > g.rows.length && ` (조건에 맞는 ${g.rows.length})`}
                    </div>
                  </div>
                  <div className="cp-product-side">
                    {/* 조건에 맞는 옵션 기준 — 접혀 있어도 한눈에 */}
                    <div className="cp-product-stat cp-num">
                      <div className="cp-product-stat-main">{overview.price}</div>
                      <div className="cp-product-stat-sub">{overview.stock}</div>
                    </div>
                    {summary && (
                      <div className="cp-product-summary cp-num">
                        판매중 {num(summary.onSale)} / {num(summary.totalOptions)}
                      </div>
                    )}
                    <button type="button" className="cp-btn cp-btn-icon" aria-label="상세 패널 열기" title="상세 패널" onClick={() => onOpenDetail(g.itemId)}>
                      <PanelIcon />
                    </button>
                  </div>
                </div>

                {isOpen && detailMissing && (
                  <div className="cp-product-notice">
                    상세를 아직 받지 않았습니다 — 가격 · 재고 · 이미지 · 업체상품코드는 상세를 받은 뒤 최신이 됩니다.
                    <button type="button" className="cp-btn cp-btn-xs" onClick={() => onFetchDetail(g.itemId)}>이 상품만 받기</button>
                  </div>
                )}

                {/* ── 옵션 줄 (펼쳤을 때만) ── */}
                {isOpen && g.rows.map((row) => {
                  const checked = selected.has(row.option_id)
                  const ch = rowChannel(row)
                  const discount = row.regular_price && row.price && row.regular_price > row.price
                    ? Math.round(((row.regular_price - row.price) / row.regular_price) * 100)
                    : null
                  const editing = noteEditing?.optionId === row.option_id
                  const checkedAt = row.status_checked_at && row.excel_synced_at
                    ? (row.status_checked_at > row.excel_synced_at ? row.status_checked_at : row.excel_synced_at)
                    : row.status_checked_at ?? row.excel_synced_at
                  return (
                    <div key={row.option_id} className={`cp-grid cp-option${checked ? ' is-selected' : ''}`} role="row">
                      <input
                        type="checkbox"
                        className="cp-checkbox"
                        checked={checked}
                        aria-label={`${row.option_name ?? row.option_id} 선택`}
                        onChange={(e) => onToggleOption(row, e.target.checked)}
                      />
                      <div className="cp-option-name">
                        <span title={row.option_name ?? ''}>{row.option_name ?? '—'}</span>
                        <span className={`cp-badge cp-badge-sm ${ch === 'RG' ? 'cp-badge-rg' : 'cp-badge-mp'}`}>{ch === 'RG' ? '로켓' : '일반'}</span>
                      </div>
                      <div className="cp-mono">{row.option_id}</div>
                      <div className="cp-right cp-num">
                        <div style={{ fontWeight: 600 }}>{won(row.price)}</div>
                        <div className="cp-price-sub">
                          {row.regular_price ? `기준가 ${num(row.regular_price)}${discount != null ? ` · ${discount}%` : ''}` : '기준가 없음'}
                        </div>
                      </div>
                      <div className={`cp-right cp-num${row.stock === 0 ? ' cp-stock-zero' : ''}`}>{num(row.stock)}</div>
                      <div><StatusChip row={row} /></div>
                      <div style={{ fontSize: 12, lineHeight: 1.35, minWidth: 0 }}>
                        <div className="cp-mono cp-ellipsis" title={row.barcode ?? ''}>{row.barcode || '—'}</div>
                        <div className="cp-ellipsis" style={{ color: '#6B7280' }} title={row.item_code ?? ''}>{row.item_code || '—'}</div>
                      </div>
                      <div>
                        <select
                          className="cp-package-select"
                          value={row.package_type ?? ''}
                          aria-label="분류"
                          onChange={(e) => onPackageType(row.option_id, e.target.value)}
                        >
                          {!row.package_type && <option value="">—</option>}
                          {PACKAGE_TYPE_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      </div>
                      <div onClick={() => { if (!editing) onStartNote(row) }}>
                        {editing ? (
                          <textarea
                            className="cp-note-input"
                            autoFocus
                            rows={2}
                            value={noteEditing!.value}
                            onChange={(e) => onNoteValue(e.target.value)}
                            onBlur={onCommitNote}
                            aria-label="비고"
                          />
                        ) : (
                          <div className={`cp-note${row.note ? '' : ' cp-note-empty'}`}>{row.note || '비고 입력'}</div>
                        )}
                      </div>
                      <div className="cp-checked-at" title={checkedAt ?? ''}>{relativeTime(checkedAt)}</div>
                      <div className="cp-row-menu">
                        <button type="button" className="cp-row-delete" aria-label="행 삭제" onClick={() => onDelete(row.option_id)}><TrashIcon /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 페이지 이동 (상품 단위 · 이전/다음) ── */}
      <nav className="cp-pagination" aria-label="페이지">
        <div className="cp-num">
          {page}페이지 · 한 페이지 상품 {productsPerPage}개
          {loading && ' · 불러오는 중…'}
        </div>
        <div className="cp-pages">
          <button type="button" className="cp-page-btn" disabled={!hasPrev || loading} onClick={onFirst}>처음</button>
          <button type="button" className="cp-page-btn" aria-label="이전 페이지" disabled={!hasPrev || loading} onClick={onPrev}>‹ 이전</button>
          <span className="cp-page-btn is-active" aria-current="page">{page}</span>
          <button type="button" className="cp-page-btn" aria-label="다음 페이지" disabled={!hasNext || loading} onClick={onNext}>다음 ›</button>
        </div>
      </nav>
    </>
  )
}

export default CoupangProductTable
