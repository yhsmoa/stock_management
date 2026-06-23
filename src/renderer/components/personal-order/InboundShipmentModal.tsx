/* ================================================================
   InboundShipmentModal — 입고준비 대상 shipment 선택 모달 (다중 선택)
   - ft_shipments.shipment_no 체크박스 리스트 (created_at 31일 이내)
   - 여러 shipment 를 동시에 선택 → 재고를 합쳐 매칭
   - [준비] 클릭 시 선택된 shipment_id 배열로 매칭 실행
   ================================================================ */

import React, { useState, useEffect } from 'react'
import type { ShipmentPickerOption } from '../../services/orderFulfillmentService'

interface Props {
  isOpen: boolean
  options: ShipmentPickerOption[]
  loading?: boolean        // 옵션 조회 / 매칭 진행 중
  onClose: () => void
  onConfirm: (shipmentIds: string[]) => void
}

const InboundShipmentModal: React.FC<Props> = ({ isOpen, options, loading, onClose, onConfirm }) => {
  const [checked, setChecked] = useState<Set<string>>(new Set())

  // 열릴 때 선택 초기화
  useEffect(() => {
    if (isOpen) setChecked(new Set())
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

  return (
    <div className="modal-overlay" onClick={loading ? undefined : onClose}>
      <div className="modal-content" style={{ width: '380px' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 600 }}>입고준비 — shipment 선택</h3>
        <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#6B7280' }}>
          최근 31일 이내 shipment ({options.length}건) · 여러 개 동시 선택 가능
        </p>

        {options.length === 0 ? (
          <div style={{ fontSize: '13px', color: '#9CA3AF', padding: '8px 0' }}>
            최근 31일 이내 shipment 가 없습니다.
          </div>
        ) : (
          <div style={{ maxHeight: '260px', overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: '6px' }}>
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
                {o.created_at && (
                  <span style={{ color: '#6B7280', fontSize: '12px' }}> · {fmt(o.created_at)}</span>
                )}
              </label>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <button
            className="po-btn"
            onClick={onClose}
            disabled={loading}
            style={{ background: '#f3f4f6', color: '#374151' }}
          >
            취소
          </button>
          <button
            className="po-btn po-acknowledge-btn"
            onClick={() => checked.size > 0 && onConfirm(Array.from(checked))}
            disabled={loading || checked.size === 0}
          >
            {loading ? '매칭 중...' : `준비${checked.size > 0 ? ` (${checked.size})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default InboundShipmentModal
