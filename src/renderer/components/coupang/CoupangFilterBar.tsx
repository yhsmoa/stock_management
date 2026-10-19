/* ================================================================
   상품관리 — 필터 줄: 구분(전체·일반·로켓) · 판매상태 칩 · 승인 · 검색
   ================================================================ */

import React from 'react'
import type {
  CoupangProductFilters,
  SalesCounts,
  ChannelFilter,
  SalesFilter,
  ApprovalFilter,
  SearchField,
} from '../../types/coupangProduct'
import { SEARCH_FIELD_LABELS } from '../../types/coupangProduct'
import { num } from './format'

interface Props {
  filters: CoupangProductFilters
  counts: SalesCounts | null
  searchInput: string
  onChannel: (v: ChannelFilter) => void
  onSales: (v: SalesFilter) => void
  onApproval: (v: ApprovalFilter) => void
  onSearchField: (v: SearchField) => void
  onSearchInput: (v: string) => void
  onSubmitSearch: () => void
  onClearSearch: () => void
}

const CHANNELS: { key: ChannelFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'MP', label: '일반' },
  { key: 'RG', label: '로켓그로스' },
]

const SALES: { key: SalesFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'on', label: '판매중' },
  { key: 'off', label: '판매중지' },
  { key: 'zeroStock', label: '재고 0' },
  { key: 'unchecked', label: '상태 미확인' },
]

const CoupangFilterBar: React.FC<Props> = ({
  filters, counts, searchInput,
  onChannel, onSales, onApproval, onSearchField, onSearchInput, onSubmitSearch, onClearSearch,
}) => (
  <div className="cp-filter-row">
    <div className="cp-filter-groups">
      <div className="cp-chip-group" role="group" aria-label="구분">
        {CHANNELS.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`cp-chip${filters.channel === c.key ? ' is-active' : ''}`}
            aria-pressed={filters.channel === c.key}
            onClick={() => onChannel(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="cp-filter-divider" />
      <div className="cp-chip-group" role="group" aria-label="판매상태">
        {SALES.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`cp-chip${filters.sales === s.key ? ' is-active' : ''}`}
            aria-pressed={filters.sales === s.key}
            onClick={() => onSales(s.key)}
          >
            {s.label}
            {counts && <span className="cp-chip-count cp-num">{num(counts[s.key])}</span>}
          </button>
        ))}
      </div>
      <div className="cp-filter-divider" />
      <button
        type="button"
        className={`cp-chip${filters.approval === 'pending' ? ' is-active' : ''}`}
        aria-pressed={filters.approval === 'pending'}
        onClick={() => onApproval(filters.approval === 'pending' ? 'all' : 'pending')}
      >
        승인 대기 · 반려
      </button>
    </div>

    <div className="cp-search">
      <label htmlFor="cp-search-field" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>검색 기준</label>
      <select id="cp-search-field" value={filters.searchField} onChange={(e) => onSearchField(e.target.value as SearchField)}>
        {(Object.keys(SEARCH_FIELD_LABELS) as SearchField[]).map((k) => (
          <option key={k} value={k}>{SEARCH_FIELD_LABELS[k]}</option>
        ))}
      </select>
      <input
        type="search"
        value={searchInput}
        placeholder={`${SEARCH_FIELD_LABELS[filters.searchField]} 검색`}
        aria-label="검색어"
        onChange={(e) => onSearchInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmitSearch() }}
      />
      <button type="button" className="cp-btn" onClick={onSubmitSearch}>검색</button>
      {filters.search && (
        <button type="button" className="cp-btn cp-btn-link" onClick={onClearSearch}>지우기</button>
      )}
    </div>
  </div>
)

export default CoupangFilterBar
