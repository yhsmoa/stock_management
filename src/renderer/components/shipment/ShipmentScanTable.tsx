import React, { useState, useCallback } from 'react'
import type { ShipmentScan } from '../../types/shipment'
import { theme } from '../../styles/theme'

interface ShipmentScanTableProps {
  data: ShipmentScan[]
  loading?: boolean
  onDelete?: (id: string) => void
  onUpdateQty?: (id: string, qty: number) => void
}

// ── 스캔기록 테이블 헤더 ─────────────────────────────────────────────
const SCAN_HEADERS = [
  { key: 'shipment_box',          label: '박스위치',    width: '11%' },
  { key: 'barcode',               label: '바코드',      width: '14%' },
  { key: 'item_name',             label: '상품명',      width: '25%' },
  { key: 'option_name',           label: '옵션명',      width: '18%' },
  { key: 'qty',                   label: '개수',        width: '9%'  },
  { key: 'coupang_shipment_size', label: '쿠팡사이즈',  width: '14%' },
  { key: 'delete',                label: '삭제',        width: '9%'  },
] as const

// ── 테이블 스타일 (ShipmentTable과 동일 패턴) ────────────────────────
const styles = {
  container: theme.table.container,
  tableWrapper: { overflowX: 'auto' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '14px' },
  thead: theme.table.thead,
  th: theme.table.th,
  tbody: { backgroundColor: theme.colors.bgCard },
  tr: theme.table.tr,
  td: theme.table.td,
  empty: { padding: '40px', textAlign: 'center' as const, color: theme.colors.textSecondary, fontSize: '16px' },
}

// ── 개수 수정 모달 스타일 (태블릿 최적화) ────────────────────────────
const modalStyles = {
  overlay: {
    ...theme.modal.overlay,
    zIndex: 10000,
  },
  content: {
    ...theme.modal.content,
    width: '320px',
    padding: '32px',
  },
  title: {
    fontSize: '18px',
    fontWeight: '600' as const,
    color: theme.colors.textPrimary,
    textAlign: 'center' as const,
    marginBottom: '24px',
  },
  input: {
    width: '100%',
    fontSize: '48px',
    fontWeight: '700' as const,
    textAlign: 'center' as const,
    border: `2px solid ${theme.colors.border}`,
    borderRadius: theme.radius.lg,
    padding: '16px',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  hint: {
    fontSize: '13px',
    color: theme.colors.textMuted,
    textAlign: 'center' as const,
    marginTop: '12px',
  },
  buttons: {
    display: 'flex',
    gap: '12px',
    marginTop: '24px',
  },
  btnCancel: {
    flex: 1,
    padding: '14px',
    fontSize: '16px',
    fontWeight: '600' as const,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: '10px',
    backgroundColor: theme.colors.bgCard,
    color: theme.colors.textSecondary,
    cursor: 'pointer',
  },
  btnConfirm: {
    flex: 1,
    padding: '14px',
    fontSize: '16px',
    fontWeight: '600' as const,
    border: 'none',
    borderRadius: '10px',
    backgroundColor: theme.colors.primary,
    color: 'white',
    cursor: 'pointer',
  },
}

// ── 삭제 버튼 스타일 ─────────────────────────────────────────────────
const deleteBtnStyle: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: '13px',
  fontWeight: '500',
  border: `1px solid ${theme.colors.danger}`,
  borderRadius: theme.radius.sm,
  backgroundColor: theme.colors.bgCard,
  color: theme.colors.danger,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

// ── 개수 셀 스타일 (클릭 가능 표시) ──────────────────────────────────
const qtyCellStyle: React.CSSProperties = {
  ...styles.td,
  textAlign: 'center',
  fontWeight: '600',
  cursor: 'pointer',
  borderRadius: '4px',
  transition: 'background-color 0.15s',
}

const ShipmentScanTable: React.FC<ShipmentScanTableProps> = React.memo(({
  data, loading, onDelete, onUpdateQty,
}) => {
  // ── 개수 수정 모달 상태 ─────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<{ id: string; qty: number } | null>(null)
  const [editValue, setEditValue] = useState('')

  const openQtyModal = useCallback((id: string, currentQty: number) => {
    setEditTarget({ id, qty: currentQty })
    setEditValue(String(currentQty))
  }, [])

  const closeQtyModal = useCallback(() => {
    setEditTarget(null)
    setEditValue('')
  }, [])

  const handleConfirmQty = useCallback(() => {
    if (!editTarget || !onUpdateQty) return
    const newQty = parseInt(editValue, 10)
    if (isNaN(newQty) || newQty < 0) return
    onUpdateQty(editTarget.id, newQty)
    closeQtyModal()
  }, [editTarget, editValue, onUpdateQty, closeQtyModal])

  // ── 로딩 상태 ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={styles.container}>
        <div style={{ padding: '40px', textAlign: 'center', color: theme.colors.textSecondary, fontSize: '16px' }}>
          데이터를 불러오는 중...
        </div>
      </div>
    )
  }

  return (
    <>
      <div style={styles.container}>
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead style={styles.thead}>
              <tr>
                {SCAN_HEADERS.map(h => (
                  <th
                    key={h.key}
                    style={{
                      ...styles.th,
                      width: h.width,
                      textAlign: (h.key === 'qty' || h.key === 'delete') ? 'center' : 'left',
                    }}
                  >
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody style={styles.tbody}>
              {data.length > 0 ? (
                data.map((row, idx) => (
                  <tr
                    key={row.id || idx}
                    style={styles.tr}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = theme.colors.bgHover }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
                  >
                    <td style={styles.td}>{row.shipment_box || '-'}</td>
                    <td style={styles.td}>{row.barcode || '-'}</td>
                    <td style={styles.td}>{row.item_name || '-'}</td>
                    <td style={styles.td}>{row.option_name || '-'}</td>
                    {/* ── 개수 (클릭 → 수정 모달) ─────────────────── */}
                    <td
                      style={qtyCellStyle}
                      onClick={() => row.id && openQtyModal(row.id, row.qty ?? 0)}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = theme.colors.primaryLight }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
                    >
                      <span style={{ borderBottom: `1px dashed ${theme.colors.primary}`, color: theme.colors.primary }}>
                        {row.qty ?? 0}
                      </span>
                    </td>
                    <td style={styles.td}>{row.coupang_shipment_size || '-'}</td>
                    {/* ── 삭제 버튼 ───────────────────────────────── */}
                    <td style={{ ...styles.td, textAlign: 'center' }}>
                      <button
                        style={deleteBtnStyle}
                        onClick={() => row.id && onDelete?.(row.id)}
                        onMouseEnter={e => {
                          e.currentTarget.style.backgroundColor = theme.colors.danger
                          e.currentTarget.style.color = 'white'
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.backgroundColor = theme.colors.bgCard
                          e.currentTarget.style.color = theme.colors.danger
                        }}
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={SCAN_HEADERS.length} style={styles.empty}>
                    스캔 기록이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 개수 수정 모달 (태블릿 최적화, 중앙 배치) ────────────────── */}
      {editTarget && (
        <div style={modalStyles.overlay} onClick={closeQtyModal}>
          <div style={modalStyles.content} onClick={e => e.stopPropagation()}>
            <div style={modalStyles.title}>개수 수정</div>
            <input
              type="number"
              inputMode="numeric"
              style={modalStyles.input}
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleConfirmQty() }}
              autoFocus
            />
            <div style={modalStyles.hint}>0 입력 시 해당 기록이 삭제됩니다</div>
            <div style={modalStyles.buttons}>
              <button style={modalStyles.btnCancel} onClick={closeQtyModal}>취소</button>
              <button style={modalStyles.btnConfirm} onClick={handleConfirmQty}>확인</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
})

ShipmentScanTable.displayName = 'ShipmentScanTable'

export default ShipmentScanTable
