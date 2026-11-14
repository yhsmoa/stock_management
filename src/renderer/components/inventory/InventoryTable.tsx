// ═══════════════════════════════════════════════════════════════════
// InventoryTable — 재고관리 표 (사입관리 · 반출관리와 같은 purchase-table 모양)
//   - 표시 전용: 선택 상태는 useInventory 가 가진다
//   - 머리글 체크 = 지금 페이지 행만
// ═══════════════════════════════════════════════════════════════════

import React from 'react'
import { STOCK_TABLE_COLUMNS, type Stock, type StockTableColumn } from '../../types/stock'

interface InventoryTableProps {
  rows: Stock[]
  selectedIds: Set<string>
  isPageAllSelected: boolean
  onToggleRow: (id: string, checked: boolean) => void
  onTogglePage: (checked: boolean) => void
}

// ── 셀 값 ─────────────────────────────────────────────────────────
const cellText = (col: StockTableColumn, row: Stock): string => {
  const value = row[col.key]
  if (value === null || value === undefined || value === '') return col.key === 'qty' ? '0' : ''
  return col.key === 'qty' ? Number(value).toLocaleString() : String(value)
}

const InventoryTable: React.FC<InventoryTableProps> = ({
  rows, selectedIds, isPageAllSelected, onToggleRow, onTogglePage,
}) => (
  <div className="purchase-table-wrapper">
    <table className="purchase-table inv-table">
      {/* ── colgroup ──────────────────────────────────── */}
      <colgroup>
        <col style={{ width: '30px' }} />
        {STOCK_TABLE_COLUMNS.map(c => (
          <col key={c.key} style={c.width ? { width: c.width } : undefined} />
        ))}
      </colgroup>

      {/* ── thead ─────────────────────────────────────── */}
      <thead>
        <tr>
          <th className="col-checkbox">
            <input
              type="checkbox"
              className="purchase-checkbox"
              checked={isPageAllSelected}
              disabled={rows.length === 0}
              onChange={e => onTogglePage(e.target.checked)}
              aria-label="이 페이지 전체 선택"
            />
          </th>
          {STOCK_TABLE_COLUMNS.map(c => (
            <th key={c.key} className={c.isText ? 'col-product' : undefined}>{c.label}</th>
          ))}
        </tr>
      </thead>

      {/* ── tbody ─────────────────────────────────────── */}
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={STOCK_TABLE_COLUMNS.length + 1} className="purchase-table-empty">
              데이터가 없습니다
            </td>
          </tr>
        ) : (
          rows.map(row => {
            const checked = selectedIds.has(row.id)
            return (
              <tr key={row.id} className={checked ? 'inv-row-selected' : undefined}>
                <td>
                  <input
                    type="checkbox"
                    className="purchase-checkbox"
                    checked={checked}
                    onChange={e => onToggleRow(row.id, e.target.checked)}
                  />
                </td>
                {STOCK_TABLE_COLUMNS.map(c => {
                  const text = cellText(c, row)
                  return (
                    <td
                      key={c.key}
                      className={[c.isText ? 'col-product' : '', c.key === 'qty' ? 'inv-col-qty' : '']
                        .filter(Boolean).join(' ') || undefined}
                      title={c.isText ? text : undefined}
                    >
                      {text}
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
)

export default InventoryTable
