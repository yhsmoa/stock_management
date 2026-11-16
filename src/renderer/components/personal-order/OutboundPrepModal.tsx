/* ================================================================
   OutboundPrepModal — 개인주문 [출고준비] 배정 원천 선택
   - 쉽먼트 박스: ft_shipments 체크 리스트 (created_at 31일 이내, 여러 개 선택 가능)
   - 재고 박스  : [재고 사용] 체크 + 방식 (재고 전체 / 재고 — 미주문건만)
   - 배정 순서는 쉽먼트 → 재고 (규칙은 services/outboundPrepService.ts)
   - 둘 중 하나 이상 골라야 [준비] 가 켜진다
   ================================================================ */

import React, { useState, useEffect } from 'react'
import type { ShipmentPickerOption } from '../../services/orderFulfillmentService'
import {
  OUTBOUND_SHIPMENT_DAYS,
  OUTBOUND_STOCK_MODE_OPTIONS,
  type OutboundPrepSelection,
  type OutboundStockMode,
} from '../../services/outboundPrepService'

// ── 상수 ──────────────────────────────────────────────────────────
/** 재고 방식 기본값 — 열 때마다 이 값으로 */
const DEFAULT_STOCK_MODE: OutboundStockMode = 'all'

const listBoxStyle: React.CSSProperties = {
  maxHeight: '220px',
  overflowY: 'auto',
  border: '1px solid #E5E7EB',
  borderRadius: '6px',
}
const mutedText: React.CSSProperties = { color: '#6B7280', fontSize: '12px' }

interface Props {
  isOpen: boolean
  options: ShipmentPickerOption[]
  /** 재고 요약 (화면에 읽어 둔 si_stocks — 바코드 종류 · 수량 합) */
  stockSummary: { barcodes: number; units: number }
  loading?: boolean        // 옵션 조회 / 배정 진행 중
  onClose: () => void
  onConfirm: (selection: OutboundPrepSelection) => void
}

const OutboundPrepModal: React.FC<Props> = ({ isOpen, options, stockSummary, loading, onClose, onConfirm }) => {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [useStock, setUseStock] = useState(false)
  const [stockMode, setStockMode] = useState<OutboundStockMode>(DEFAULT_STOCK_MODE)

  // 열릴 때 선택 초기화
  useEffect(() => {
    if (!isOpen) return
    setChecked(new Set())
    setUseStock(false)
    setStockMode(DEFAULT_STOCK_MODE)
  }, [isOpen])

  if (!isOpen) return null

  const fmt = (iso: string | null) => (iso ? iso.slice(0, 10) : '')
  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const sourceCount = checked.size + (useStock ? 1 : 0)
  const canConfirm = !loading && sourceCount > 0
  const confirm = () => {
    if (!canConfirm) return
    // 화면 순서(최근 생성순)를 그대로 넘긴다 — Set 은 누른 순서라 매번 달라질 수 있다
    onConfirm({
      shipmentIds: options.filter((o) => checked.has(o.id)).map((o) => o.id),
      stockMode: useStock ? stockMode : null,
    })
  }

  return (
    <div className="modal-overlay" onClick={loading ? undefined : onClose}>
      <div className="modal-content" style={{ width: '420px' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600 }}>출고준비 — 배정할 물량 선택</h3>
        <p style={{ ...mutedText, margin: '0 0 4px' }}>
          쉽먼트를 먼저 배정하고, 남은 수량에 재고를 배정합니다.
        </p>

        {/* ── 쉽먼트 ─────────────────────────────────────────── */}
        <div className="order-modal-section">
          <div className="order-modal-section-title">
            쉽먼트 <span style={{ ...mutedText, fontWeight: 400 }}>· 최근 {OUTBOUND_SHIPMENT_DAYS}일 {options.length}건 · 여러 개 선택 가능</span>
          </div>
          {options.length === 0 ? (
            <div style={{ fontSize: '13px', color: '#9CA3AF', padding: '4px 0' }}>
              최근 {OUTBOUND_SHIPMENT_DAYS}일 이내 쉽먼트가 없습니다.
            </div>
          ) : (
            <div style={listBoxStyle}>
              {options.map((o) => (
                <label
                  key={o.id}
                  className="order-modal-checkbox"
                  style={{ padding: '6px 10px', borderBottom: '1px solid #F3F4F6' }}
                >
                  <input
                    type="checkbox"
                    checked={checked.has(o.id)}
                    disabled={loading}
                    onChange={() => toggle(o.id)}
                  />
                  <span style={{ fontWeight: 500 }}>{o.shipment_no ?? '(번호없음)'}</span>
                  {o.created_at && <span style={mutedText}> · {fmt(o.created_at)}</span>}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* ── 재고 ───────────────────────────────────────────── */}
        <div className="order-modal-section">
          <div className="order-modal-section-title">재고</div>
          <div style={{ ...listBoxStyle, padding: '4px 10px 8px' }}>
            <label className="order-modal-checkbox">
              <input
                type="checkbox"
                checked={useStock}
                disabled={loading}
                onChange={(e) => setUseStock(e.target.checked)}
              />
              <span style={{ fontWeight: 500 }}>재고 사용</span>
              <span style={mutedText}>
                · 바코드 {stockSummary.barcodes.toLocaleString()}종 · {stockSummary.units.toLocaleString()}개
              </span>
            </label>
            <div role="radiogroup" aria-label="재고 배정 방식" style={{ paddingLeft: '24px' }}>
              {OUTBOUND_STOCK_MODE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="order-modal-checkbox"
                  style={{ alignItems: 'flex-start', opacity: useStock ? 1 : 0.45 }}
                >
                  <input
                    type="radio"
                    name="outbound-stock-mode"
                    value={opt.value}
                    checked={stockMode === opt.value}
                    disabled={loading || !useStock}
                    onChange={() => setStockMode(opt.value)}
                    style={{ marginTop: '3px' }}
                  />
                  <span>
                    <span style={{ fontWeight: 500 }}>{opt.label}</span>
                    <span style={{ ...mutedText, display: 'block' }}>{opt.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="order-modal-footer">
          <button
            className="po-btn"
            onClick={onClose}
            disabled={loading}
            style={{ background: '#f3f4f6', color: '#374151' }}
          >
            취소
          </button>
          <button className="po-btn po-acknowledge-btn" onClick={confirm} disabled={!canConfirm}>
            {loading ? '배정 중...' : `준비${sourceCount > 0 ? ` (${sourceCount})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default OutboundPrepModal
