import React from 'react'
import type { ShipmentRow } from '../../types/shipment'
import { SHIPMENT_TABLE_HEADERS } from '../../types/shipment'
import LocationBadge from './LocationBadge'
import { theme } from '../../styles/theme'

interface ShipmentTableProps {
  data: ShipmentRow[]
  loading?: boolean
  /** 현재 스캔 중인 바코드 (활성 행 표시) */
  activeBarcode?: string | null
  /** 이전에 스캔한 바코드 (이전 행 표시) */
  prevBarcode?: string | null
}

// ── 테이블 스타일 ───────────────────────────────────────────────────
const tableStyles = {
  container: theme.table.container,
  tableWrapper: {
    overflowX: 'auto' as const,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '14px',
  },
  thead: theme.table.thead,
  th: theme.table.th,
  tbody: {
    backgroundColor: theme.colors.bgCard,
  },
  tr: theme.table.tr,
  td: theme.table.td,
  emptyMessage: {
    padding: '40px',
    textAlign: 'center' as const,
    color: theme.colors.textSecondary,
    fontSize: '16px',
  },
}

// ── 행 배경색 결정 ──────────────────────────────────────────────────
const getRowBg = (barcode: string, activeBarcode?: string | null, prevBarcode?: string | null): string => {
  if (activeBarcode && barcode === activeBarcode) return theme.colors.primaryLight   // 현재 스캔 중 (파란 하이라이트)
  if (prevBarcode && barcode === prevBarcode) return '#f5f5f5'       // 이전 스캔 (연한 회색)
  return 'transparent'
}

const ShipmentTable: React.FC<ShipmentTableProps> = React.memo(({
  data, loading, activeBarcode, prevBarcode,
}) => {
  if (loading) {
    return (
      <div style={tableStyles.container}>
        <div style={{ padding: '40px', textAlign: 'center', color: theme.colors.textSecondary, fontSize: '16px' }}>
          데이터를 불러오는 중...
        </div>
      </div>
    )
  }

  return (
    <div style={tableStyles.container}>
      <div style={tableStyles.tableWrapper}>
        <table style={tableStyles.table}>
          {/* ── 테이블 헤더 ──────────────────────────────────────── */}
          <thead style={tableStyles.thead}>
            <tr>
              {SHIPMENT_TABLE_HEADERS.map(header => (
                <th
                  key={header.key}
                  style={{
                    ...tableStyles.th,
                    width: header.width,
                    textAlign: (header.key === 'shipmentQty' || header.key === 'scannedTotal')
                      ? 'center' : 'left',
                  }}
                >
                  {header.label}
                </th>
              ))}
            </tr>
          </thead>

          {/* ── 테이블 바디 ──────────────────────────────────────── */}
          <tbody style={tableStyles.tbody}>
            {data.length > 0 ? (
              data.map(row => {
                const scannedTotal = row.stockLocations.reduce((sum, sl) => sum + sl.scannedQty, 0)
                const rowBg = getRowBg(row.barcode, activeBarcode, prevBarcode)
                const isActive = activeBarcode === row.barcode

                return (
                  <tr
                    key={row.id}
                    style={{
                      ...tableStyles.tr,
                      backgroundColor: rowBg,
                      borderLeft: isActive ? `3px solid ${theme.colors.primary}` : '3px solid transparent',
                    }}
                    onMouseEnter={e => {
                      if (!isActive) e.currentTarget.style.backgroundColor = theme.colors.bgHover
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.backgroundColor = rowBg
                    }}
                  >
                    <td style={tableStyles.td}>{row.barcode}</td>
                    <td style={tableStyles.td}>{row.item_name || '-'}</td>
                    <td style={tableStyles.td}>{row.option_name || '-'}</td>
                    <td style={{ ...tableStyles.td, textAlign: 'center' }}>{row.shipmentQty}</td>
                    <td style={tableStyles.td}>{row.coupangShipmentSize || '-'}</td>
                    <td style={{ ...tableStyles.td, lineHeight: '1.6' }}>
                      {row.stockLocations.map((sl, idx) => (
                        <LocationBadge
                          key={`${sl.location}-${idx}`}
                          location={sl.location}
                          qty={sl.qty}
                          scannedQty={sl.scannedQty}
                        />
                      ))}
                    </td>
                    <td style={{
                      ...tableStyles.td,
                      textAlign: 'center',
                      fontWeight: scannedTotal > 0 ? '700' : '400',
                      color: scannedTotal > 0 ? theme.colors.primary : '#adb5bd',
                    }}>
                      {scannedTotal}
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={SHIPMENT_TABLE_HEADERS.length} style={tableStyles.emptyMessage}>
                  데이터가 없습니다. [출고 추가] 버튼으로 항목을 추가하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
})

ShipmentTable.displayName = 'ShipmentTable'

export default ShipmentTable
