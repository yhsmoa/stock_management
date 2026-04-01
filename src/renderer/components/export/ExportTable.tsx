import React, { useState, useEffect } from 'react'
import { theme } from '../../styles/theme'
import type { Export } from '../../types/export'
import { EXPORT_TABLE_HEADERS } from '../../types/export'

interface ExportTableProps {
  data: Export[]
  loading?: boolean
  /** 체크박스 선택 변경 시 선택된 ID 목록을 부모에 전달 */
  onSelectionChange?: (ids: string[]) => void
}

const ExportTable: React.FC<ExportTableProps> = ({ data, loading, onSelectionChange }) => {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())

  // data가 변경되면(삭제 후 등) 선택 상태 초기화
  useEffect(() => {
    setSelectedItems(new Set())
    onSelectionChange?.([])
  }, [data])

  // 선택 상태 업데이트 + 부모 콜백 호출
  const updateSelection = (next: Set<string>) => {
    setSelectedItems(next)
    onSelectionChange?.(Array.from(next))
  }

  // 전체 선택/해제
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      updateSelection(new Set(data.map((item, index) => item.id || `index-${index}`)))
    } else {
      updateSelection(new Set())
    }
  }

  // 개별 선택/해제
  const handleSelectItem = (itemId: string, checked: boolean) => {
    const next = new Set(selectedItems)
    if (checked) {
      next.add(itemId)
    } else {
      next.delete(itemId)
    }
    updateSelection(next)
  }

  // 테이블 스타일 정의
  const tableStyles = {
    container: {
      ...theme.table.container,
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
      ...theme.table.thead,
    },
    th: {
      ...theme.table.th,
    },
    tbody: {
      backgroundColor: theme.colors.bgCard,
    },
    tr: {
      ...theme.table.tr,
    },
    trHover: {
      backgroundColor: theme.colors.bgHover,
    },
    td: {
      ...theme.table.td,
    },
    emptyMessage: {
      padding: '40px',
      textAlign: 'center' as const,
      color: theme.colors.textSecondary,
      fontSize: '16px',
    },
    loadingMessage: {
      padding: '40px',
      textAlign: 'center' as const,
      color: theme.colors.textSecondary,
      fontSize: '16px',
    },
  }

  if (loading) {
    return (
      <div style={tableStyles.container}>
        <div style={tableStyles.loadingMessage}>데이터를 불러오는 중...</div>
      </div>
    )
  }

  return (
    <div style={tableStyles.container}>
      <div style={tableStyles.tableWrapper}>
        <table style={tableStyles.table}>
          <thead style={tableStyles.thead}>
            <tr>
              {EXPORT_TABLE_HEADERS.map(header => (
                <th
                  key={header.key}
                  style={{
                    ...tableStyles.th,
                    width: header.width,
                    textAlign: header.key === 'checkbox' || header.key === 'qty' ? 'center' : 'left',
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
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = tableStyles.trHover.backgroundColor }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                  >
                    <td style={{ ...tableStyles.td, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedItems.has(itemId)}
                        onChange={(e) => handleSelectItem(itemId, e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td style={tableStyles.td}>{item.packageType || '-'}</td>
                    <td style={tableStyles.td}>{item.location || '-'}</td>
                    <td style={tableStyles.td}>{item.barcode || '-'}</td>
                    <td style={tableStyles.td}>{item.itemName || '-'}</td>
                    <td style={{ ...tableStyles.td, textAlign: 'center' }}>{item.qty || 0}</td>
                    <td style={tableStyles.td}>{item.qualityGrade || '-'}</td>
                    <td style={tableStyles.td}>{item.returnReason || '-'}</td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={EXPORT_TABLE_HEADERS.length} style={tableStyles.emptyMessage}>
                  데이터가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default ExportTable
