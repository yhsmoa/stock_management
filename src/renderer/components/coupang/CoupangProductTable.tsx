/* ================================================================
   상품관리 — 목록 (상품 묶음 머리줄 + 옵션 줄) · 페이지 이동
   - 행 단위 페이지(100행)를 등록상품 ID 로 묶어 보여 준다. 묶음 머리줄의
     "옵션 N개 · 판매중 M" 은 페이지에 안 보이는 옵션까지 센 값(summary)
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
  // 페이지
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
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

// ── 페이지 번호 ──────────────────────────────────────────────────
function pageNumbers(current: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  if (current <= 4) return [1, 2, 3, 4, 5, '…', totalPages]
  if (current >= totalPages - 3) return [1, '…', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  return [1, '…', current - 1, current, current + 1, '…', totalPages]
}

const CoupangProductTable: React.FC<Props> = ({
  groups, loading, error, selected, noteEditing,
  page, pageSize, total, onPage,
  onToggleOption, onToggleRows, onOpenDetail, onFetchDetail,
  onPackageType, onStartNote, onNoteValue, onCommitNote, onDelete,
}) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <>
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
            const approvalBad = !!g.approval && g.approval !== '승인완료'
            const detailMissing = !summary?.detailSynced
            return (
              <div key={g.itemId} className="cp-product">
                {/* ── 상품 머리줄 ── */}
                <div className="cp-product-head">
                  <input
                    type="checkbox"
                    className="cp-checkbox"
                    checked={allChecked}
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
                      {summary && summary.totalOptions > g.rows.length && ` (이 페이지 ${g.rows.length})`}
                    </div>
                  </div>
                  <div className="cp-product-side">
                    {summary && (
                      <div className="cp-product-summary cp-num">
                        판매중 {num(summary.onSale)} / {num(summary.totalOptions)}
                      </div>
                    )}
                    <button type="button" className="cp-btn cp-btn-icon" aria-label="상세 보기" onClick={() => onOpenDetail(g.itemId)}>
                      <ChevronIcon />
                    </button>
                  </div>
                </div>

                {detailMissing && (
                  <div className="cp-product-notice">
                    상세를 아직 받지 않았습니다 — 가격 · 재고 · 이미지 · 업체상품코드는 상세를 받은 뒤 최신이 됩니다.
                    <button type="button" className="cp-btn cp-btn-xs" onClick={() => onFetchDetail(g.itemId)}>이 상품만 받기</button>
                  </div>
                )}

                {/* ── 옵션 줄 ── */}
                {g.rows.map((row) => {
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

      {/* ── 페이지 이동 ── */}
      <nav className="cp-pagination" aria-label="페이지">
        <div className="cp-num">
          {total === 0 ? '옵션 0개' : `옵션 ${num(from)}–${num(to)} / ${num(total)} · 한 페이지 ${pageSize}개`}
          {loading && ' · 불러오는 중…'}
        </div>
        <div className="cp-pages">
          <button type="button" className="cp-page-btn" aria-label="이전 페이지" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</button>
          {pageNumbers(page, totalPages).map((p, i) => (
            p === '…'
              ? <span key={`e${i}`} className="cp-page-ellipsis">…</span>
              : (
                <button
                  key={p}
                  type="button"
                  className={`cp-page-btn${p === page ? ' is-active' : ''}`}
                  aria-current={p === page ? 'page' : undefined}
                  onClick={() => onPage(p)}
                >
                  {p}
                </button>
              )
          ))}
          <button type="button" className="cp-page-btn" aria-label="다음 페이지" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>›</button>
        </div>
      </nav>
    </>
  )
}

export default CoupangProductTable
