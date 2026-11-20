// ═══════════════════════════════════════════════════════════════════
// 재고입력 (/stock-input — 물류 › 재고관리 › 재고입력)
//   위치(왼쪽) · 바코드(오른쪽) 입력폼 → 스캔 목록(최신이 맨 위) → [재고 추가]
//   - 화면 틀 · 표는 재고관리와 같은 purchase-* (PurchaseManagement.css),
//     여기에만 필요한 규칙은 StockInput.css (.sin-)
//   - 상태 · 동작은 useStockInput, 규칙 · DB 작업은 services/stockInputService.ts
// ═══════════════════════════════════════════════════════════════════

import React from 'react'
import './PurchaseManagement.css'
import './StockInput.css'
import UnsavedChangesGuard from '../components/common/UnsavedChangesGuard'
import { useStockInput } from './useStockInput'
import type { StockInputRow } from '../services/stockInputService'

// ── 스캔 목록 열 ──────────────────────────────────────────────────
//   width 를 비운 열(상품명)이 남는 폭을 가진다 (table-layout: fixed)
interface ScanColumn {
  key: keyof Pick<StockInputRow, 'location' | 'barcode' | 'item_name' | 'option_name' | 'qty'>
  label: string
  width?: string
  isText?: boolean
}

const SCAN_COLUMNS: readonly ScanColumn[] = [
  { key: 'location',    label: '위치',   width: '140px' },
  { key: 'barcode',     label: '바코드', width: '160px' },
  { key: 'item_name',   label: '상품명', isText: true },
  { key: 'option_name', label: '옵션명', width: '220px', isText: true },
  { key: 'qty',         label: '수량',   width: '80px' },
]

const REMOVE_COLUMN_WIDTH = '48px'

const LEAVE_MESSAGE =
  '재고에 추가하지 않은 스캔 목록이 있습니다.\n저장하지 않고 이동하면 목록이 사라집니다.'

const cellText = (col: ScanColumn, row: StockInputRow): string => {
  const value = row[col.key]
  if (col.key === 'qty') return row.qty.toLocaleString()
  return value == null ? '' : String(value)
}

const StockInput: React.FC = () => {
  const s = useStockInput()
  const isReady = s.indexState.kind === 'ready'
  const inputsLocked = s.isSaving

  // Enter (한글 조합 중 Enter 는 글자 확정이라 넘긴다)
  const onEnter = (action: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) action()
  }

  const barcodePlaceholder =
    s.indexState.kind === 'loading' ? '바코드 불러오는 중...'
      : s.indexState.kind === 'error' ? '바코드를 불러오지 못했습니다'
        : '바코드'

  return (
    <div className="purchase-container">
      {/* ── 상단: 타이틀 | 재고 추가 ─────────────────────────── */}
      <div className="purchase-top-actions">
        <div className="purchase-toolbar-left">
          <h1 className="purchase-title">재고입력</h1>
        </div>
        <div className="purchase-toolbar-right">
          <button
            className="purchase-btn sin-save-btn"
            onClick={() => void s.save()}
            disabled={s.isSaving || s.rows.length === 0}
            title="아래 목록을 재고에 더합니다 — 같은 위치 + 바코드 재고가 있으면 수량만 더하고, 없으면 새로 만듭니다"
          >
            {s.isSaving ? '추가하는 중...' : '재고 추가'}
          </button>
        </div>
      </div>

      {/* ── 입력폼: 위치 | 바코드 (1:1) ───────────────────────── */}
      <div className="sin-form-row">
        <input
          ref={s.locationRef}
          className="sin-input"
          type="text"
          placeholder="위치"
          value={s.location}
          onChange={e => s.setLocation(e.target.value)}
          onKeyDown={onEnter(s.submitLocation)}
          onFocus={e => e.currentTarget.select()}
          disabled={inputsLocked}
          aria-label="위치"
        />
        <input
          ref={s.barcodeRef}
          className="sin-input"
          type="text"
          placeholder={barcodePlaceholder}
          value={s.barcode}
          onChange={e => s.setBarcode(e.target.value)}
          onKeyDown={onEnter(s.submitBarcode)}
          disabled={inputsLocked || !isReady}
          aria-label="바코드"
        />
      </div>

      {/* ── 안내: 색인 오류(다시 시도) · 스캔/저장 결과 ─────────── */}
      {s.indexState.kind === 'error' && (
        <div className="sin-notice sin-notice-error">
          <span>{s.indexState.message}</span>
          <button className="purchase-btn" onClick={s.retryIndex}>다시 시도</button>
        </div>
      )}
      {s.notice && (
        <div className={`sin-notice sin-notice-${s.notice.tone}`} role="status">
          {s.notice.text}
        </div>
      )}

      {/* ── 스캔 목록 (최신이 맨 위) ──────────────────────────── */}
      <div className="purchase-table-area">
        <div className="purchase-table-toolbar">
          <div className="purchase-toolbar-left">
            <span className="purchase-filter-count">
              {s.rows.length.toLocaleString()}줄 · 수량 {s.totalQty.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="purchase-table-section">
          <div className="purchase-table-wrapper">
            <table className="purchase-table sin-table">
              <colgroup>
                {SCAN_COLUMNS.map(c => (
                  <col key={c.key} style={c.width ? { width: c.width } : undefined} />
                ))}
                <col style={{ width: REMOVE_COLUMN_WIDTH }} />
              </colgroup>
              <thead>
                <tr>
                  {SCAN_COLUMNS.map(c => (
                    <th key={c.key} className={c.isText ? 'col-product' : undefined}>{c.label}</th>
                  ))}
                  <th aria-label="줄 빼기" />
                </tr>
              </thead>
              <tbody>
                {s.rows.length === 0 ? (
                  <tr>
                    <td colSpan={SCAN_COLUMNS.length + 1} className="purchase-table-empty">
                      위치를 입력하고 바코드를 스캔하세요
                    </td>
                  </tr>
                ) : (
                  s.rows.map(row => (
                    <tr key={row.key}>
                      {SCAN_COLUMNS.map(c => {
                        const text = cellText(c, row)
                        return (
                          <td
                            key={c.key}
                            className={[c.isText ? 'col-product' : '', c.key === 'qty' ? 'sin-col-qty' : '']
                              .filter(Boolean).join(' ') || undefined}
                            title={c.isText ? text : undefined}
                          >
                            {text}
                          </td>
                        )
                      })}
                      <td>
                        <button
                          className="sin-remove-btn"
                          onClick={() => s.removeRow(row.key)}
                          disabled={s.isSaving}
                          title="이 줄을 목록에서 빼기"
                          aria-label={`${row.location} ${row.barcode} 줄 빼기`}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── 저장 전 이탈 확인 ─────────────────────────────────── */}
      <UnsavedChangesGuard
        when={s.rows.length > 0}
        onSave={s.save}
        message={LEAVE_MESSAGE}
        count={s.rows.length}
      />
    </div>
  )
}

export default StockInput
