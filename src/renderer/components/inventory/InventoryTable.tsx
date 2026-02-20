import React, { useState } from 'react'
import type { Stock } from '../../types/stock'
import { STOCK_TABLE_HEADERS } from '../../types/stock'

interface InventoryTableProps {
  data: Stock[]
  loading?: boolean
  onSelectionChange?: (ids: string[]) => void
}

const InventoryTable: React.FC<InventoryTableProps> = ({ data, loading, onSelectionChange }) => {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())

  // 전체 선택/해제
  const handleSelectAll = (checked: boolean) => {
    let newSelected: Set<string>
    if (checked) {
      const allIds = new Set(data.map((item, index) => item.id || `index-${index}`))
      newSelected = allIds
    } else {
      newSelected = new Set()
    }
    setSelectedItems(newSelected)
    onSelectionChange?.(Array.from(newSelected))
  }

  // 개별 선택/해제
  const handleSelectItem = (itemId: string, checked: boolean) => {
    const newSelected = new Set(selectedItems)
    if (checked) {
      newSelected.add(itemId)
    } else {
      newSelected.delete(itemId)
    }
    setSelectedItems(newSelected)
    onSelectionChange?.(Array.from(newSelected))
  }
  // 테이블 스타일 정의
  const tableStyles = {
    container: {
      backgroundColor: 'white',
      borderRadius: '8px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      overflow: 'hidden',
    },
    tableWrapper: {
      overflowX: 'auto' as const,
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse' as const,
      fontSize: '14px',
    },
    thead: {
      backgroundColor: '#f8f9fa',
      borderBottom: '2px solid #dee2e6',
    },
    th: {
      padding: '12px',
      textAlign: 'left' as const,
      fontWeight: '600',
      color: '#495057',
      whiteSpace: 'nowrap' as const,
    },
    tbody: {
      backgroundColor: 'white',
    },
    tr: {
      borderBottom: '1px solid #e9ecef',
      transition: 'background-color 0.2s',
    },
    trHover: {
      backgroundColor: '#f8f9fa',
    },
    td: {
      padding: '12px',
      color: '#212529',
    },
    emptyMessage: {
      padding: '40px',
      textAlign: 'center' as const,
      color: '#6c757d',
      fontSize: '16px',
    },
    loadingMessage: {
      padding: '40px',
      textAlign: 'center' as const,
      color: '#6c757d',
      fontSize: '16px',
    }
  }

  if (loading) {
    return (
      <div style={tableStyles.container}>
        <div style={tableStyles.loadingMessage}>
          데이터를 불러오는 중...
        </div>
      </div>
    )
  }

  return (
    <div style={tableStyles.container}>
      <div style={tableStyles.tableWrapper}>
        <table style={tableStyles.table}>
          <thead style={tableStyles.thead}>
            <tr>
              {STOCK_TABLE_HEADERS.map(header => (
                <th
                  key={header.key}
                  style={{
                    ...tableStyles.th,
                    width: header.width,
                    textAlign: header.key === 'checkbox' || header.key === 'qty' ? 'center' : 'left'
                  }}
                >
                  {header.key === 'checkbox' ? (
                    <input
                      type="checkbox"
                      checked={data.length > 0 && selectedItems.size === data.length}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                  ) : (
                    header.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody style={tableStyles.tbody}>
            {data.length > 0 ? (
              data.map((item, index) => {
                const itemId = item.id || `index-${index}`
                return (
                  <tr
                    key={itemId}
                    style={tableStyles.tr}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = tableStyles.trHover.backgroundColor
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                  >
                    <td style={{ ...tableStyles.td, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedItems.has(itemId)}
                        onChange={(e) => handleSelectItem(itemId, e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td style={tableStyles.td}>{item.location || '-'}</td>
                    <td style={tableStyles.td}>{item.barcode}</td>
                    <td style={tableStyles.td}>{item.item_name || '-'}</td>
                    <td style={tableStyles.td}>{item.option_name || '-'}</td>
                    <td style={{ ...tableStyles.td, textAlign: 'center' }}>{item.qty || 0}</td>
                    <td style={tableStyles.td}>{item.season || '-'}</td>
                    <td style={tableStyles.td}>{item.note || '-'}</td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={STOCK_TABLE_HEADERS.length} style={tableStyles.emptyMessage}>
                  검색 결과가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default InventoryTable