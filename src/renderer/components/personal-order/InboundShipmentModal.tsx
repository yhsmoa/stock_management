/* ================================================================
   InboundShipmentModal — 입고준비 대상 shipment 선택 모달
   - ft_shipments.shipment_no 드롭박스 (created_at 31일 이내)
   - [준비] 클릭 시 선택된 shipment_id 로 매칭 실행
   ================================================================ */

import React, { useState, useEffect } from 'react'
import type { ShipmentPickerOption } from '../../services/orderFulfillmentService'

interface Props {
  isOpen: boolean
  options: ShipmentPickerOption[]
  loading?: boolean        // 옵션 조회 / 매칭 진행 중
  onClose: () => void
  onConfirm: (shipmentId: string) => void
}

const InboundShipmentModal: React.FC<Props> = ({ isOpen, options, loading, onClose, onConfirm }) => {
  const [selectedId, setSelectedId] = useState('')

  // 열릴 때 첫 옵션 기본 선택
  useEffect(() => {
    if (isOpen) setSelectedId(options[0]?.id ?? '')
  }, [isOpen, options])

  if (!isOpen) return null

  const fmt = (iso: string | null) => (iso ? iso.slice(0, 10) : '')

  return (
    <div className="modal-overlay" onClick={loading ? undefined : onClose}>
      <div className="modal-content" style={{ width: '360px' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 600 }}>입고준비 — shipment 선택</h3>
        <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#6B7280' }}>
          최근 31일 이내 shipment ({options.length}건)
        </p>

        {options.length === 0 ? (
          <div style={{ fontSize: '13px', color: '#9CA3AF', padding: '8px 0' }}>
            최근 31일 이내 shipment 가 없습니다.
          </div>
        ) : (
          <select
            value={selectedId}
            disabled={loading}
            onChange={(e) => setSelectedId(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 10px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '14px',
              outline: 'none',
            }}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {(o.shipment_no ?? '(번호없음)')}{o.created_at ? ` · ${fmt(o.created_at)}` : ''}
              </option>
            ))}
          </select>
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
            onClick={() => selectedId && onConfirm(selectedId)}
            disabled={loading || !selectedId}
          >
            {loading ? '매칭 중...' : '준비'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default InboundShipmentModal
