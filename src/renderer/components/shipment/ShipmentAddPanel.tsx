import React, { useState, useRef, useEffect } from 'react'
import type { Stock } from '../../types/stock'
import type { ShipmentRow, StockLocationInfo } from '../../types/shipment'
import { ShipmentService } from '../../services/shipmentService'
import Button from '../common/Button'
import { theme } from '../../styles/theme'

interface ShipmentAddPanelProps {
  isOpen: boolean
  onClose: () => void
  onAddItem: (item: ShipmentRow) => void
}

// ── 스타일 ──────────────────────────────────────────────────────────
const panelStyles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.overlay,
    zIndex: 999,
  },
  panel: {
    position: 'fixed' as const,
    top: 0,
    right: 0,
    width: '25vw',
    minWidth: '320px',
    height: '100%',
    backgroundColor: theme.colors.bgCard,
    boxShadow: '-4px 0 20px rgba(0,0,0,0.08)',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column' as const,
    transition: 'transform 0.3s ease',
  },
  header: {
    padding: '16px 20px',
    borderBottom: `1px solid ${theme.colors.border}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    color: theme.colors.textSecondary,
    padding: '4px 8px',
  },
  body: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '20px',
  },
  inputGroup: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    marginBottom: '6px',
    fontSize: '13px',
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  input: {
    ...theme.input,
    width: '100%',
  },
  resultItem: {
    padding: '12px',
    border: `1px solid ${theme.colors.borderLight}`,
    borderRadius: theme.radius.sm,
    marginBottom: '8px',
    backgroundColor: theme.colors.bgHover,
  },
  resultLocation: {
    fontSize: '14px',
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginBottom: '4px',
  },
  resultName: {
    fontSize: '13px',
    color: theme.colors.textSecondary,
    marginBottom: '2px',
  },
  resultQty: {
    fontSize: '13px',
    color: theme.colors.primary,
    fontWeight: '500',
  },
  noResult: {
    padding: '20px',
    textAlign: 'center' as const,
    color: theme.colors.textMuted,
    fontSize: '14px',
  },
}

const ShipmentAddPanel: React.FC<ShipmentAddPanelProps> = ({ isOpen, onClose, onAddItem }) => {
  // ── 상태 ──────────────────────────────────────────────────────────
  const [barcode, setBarcode] = useState('')
  const [searchResults, setSearchResults] = useState<Stock[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [qty, setQty] = useState(1)

  const barcodeInputRef = useRef<HTMLInputElement>(null)

  // ── 패널 열릴 때 바코드 입력에 포커스 ─────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => barcodeInputRef.current?.focus(), 300)
    } else {
      // 패널 닫힐 때 상태 초기화
      setBarcode('')
      setSearchResults([])
      setSearched(false)
      setQty(1)
    }
  }, [isOpen])

  // ── 바코드 검색 ──────────────────────────────────────────────────
  const handleSearch = async () => {
    const trimmed = barcode.trim()
    if (!trimmed) return

    const userStr = localStorage.getItem('user')
    const user = userStr ? JSON.parse(userStr) : null
    const userId = user?.id
    if (!userId) {
      alert('로그인 정보를 찾을 수 없습니다.')
      return
    }

    setIsSearching(true)
    setSearched(true)
    try {
      const stocks = await ShipmentService.getStocksByBarcode(trimmed, userId)
      setSearchResults(stocks)
    } catch (err) {
      console.error('바코드 검색 오류:', err)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const handleBarcodeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSearch()
    }
  }

  // ── 항목 추가 ────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (searchResults.length === 0) return
    if (qty <= 0) {
      alert('수량을 1 이상 입력하세요.')
      return
    }

    const first = searchResults[0]

    // 쿠팡 사이즈 조회
    const coupangSize = await ShipmentService.getCoupangShipmentSize(first.barcode)

    // StockLocationInfo 배열 생성
    const stockLocations: StockLocationInfo[] = searchResults.map(stock => ({
      location: stock.location ?? '',
      qty: stock.qty ?? 0,
      scannedQty: 0,
      shipmentBox: null,
    }))

    const newRow: ShipmentRow = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      barcode: first.barcode,
      item_name: first.item_name ?? '',
      option_name: first.option_name ?? '',
      shipmentQty: qty,
      coupangShipmentSize: coupangSize,
      stockLocations,
    }

    onAddItem(newRow)

    // 입력 초기화 (다음 항목 입력 가능)
    setBarcode('')
    setSearchResults([])
    setSearched(false)
    setQty(1)
    barcodeInputRef.current?.focus()
  }

  if (!isOpen) return null

  return (
    <>
      {/* ── 배경 오버레이 ──────────────────────────────────────────── */}
      <div style={panelStyles.overlay} onClick={onClose} />

      {/* ── 슬라이드 패널 ──────────────────────────────────────────── */}
      <div style={panelStyles.panel}>
        {/* ── 헤더 ─────────────────────────────────────────────────── */}
        <div style={panelStyles.header}>
          <span style={panelStyles.headerTitle}>출고 추가</span>
          <button style={panelStyles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        {/* ── 바디 ─────────────────────────────────────────────────── */}
        <div style={panelStyles.body}>
          {/* 바코드 입력 */}
          <div style={panelStyles.inputGroup}>
            <label style={panelStyles.label}>바코드</label>
            <input
              ref={barcodeInputRef}
              type="text"
              value={barcode}
              onChange={e => setBarcode(e.target.value)}
              onKeyDown={handleBarcodeKeyDown}
              placeholder="바코드를 스캔하거나 입력 후 Enter"
              style={panelStyles.input}
            />
          </div>

          {/* 검색 결과 */}
          {isSearching && (
            <div style={panelStyles.noResult}>검색 중...</div>
          )}

          {!isSearching && searched && searchResults.length === 0 && (
            <div style={panelStyles.noResult}>검색 결과가 없습니다.</div>
          )}

          {searchResults.length > 0 && (
            <>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ ...panelStyles.label, marginBottom: '8px' }}>
                  검색 결과 ({searchResults.length}건)
                </label>
                {searchResults.map((stock, idx) => (
                  <div key={stock.id || idx} style={panelStyles.resultItem}>
                    <div style={panelStyles.resultLocation}>{stock.location || '(위치없음)'}</div>
                    <div style={panelStyles.resultName}>
                      {stock.item_name}{stock.option_name ? `, ${stock.option_name}` : ''}
                    </div>
                    <div style={panelStyles.resultQty}>재고: {stock.qty ?? 0}개</div>
                  </div>
                ))}
              </div>

              {/* 수량 입력 + 추가 버튼 */}
              <div style={panelStyles.inputGroup}>
                <label style={panelStyles.label}>출고 수량</label>
                <input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={e => setQty(parseInt(e.target.value, 10) || 0)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }}
                  style={panelStyles.input}
                />
              </div>

              <Button variant="primary" onClick={handleAdd} style={{ width: '100%' }}>
                추가
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

export default ShipmentAddPanel
