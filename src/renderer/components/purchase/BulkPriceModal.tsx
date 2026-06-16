/* ================================================================
   BulkPriceModal — 선택 행 일괄 '동일 가격' 적용 모달
   - 10원 단위 클라이언트 검증 (비율 제한은 항목별로 API 가 판정)
   ================================================================ */

import React, { useState, useEffect } from 'react'

interface BulkPriceModalProps {
  isOpen: boolean
  count: number              // 선택된 행 수
  loading?: boolean          // 일괄 처리 진행 중
  onClose: () => void
  onSubmit: (price: number) => void
}

const BulkPriceModal: React.FC<BulkPriceModalProps> = ({
  isOpen,
  count,
  loading,
  onClose,
  onSubmit,
}) => {
  const [value, setValue] = useState('')
  const [err, setErr] = useState<string | null>(null)

  // 열릴 때 초기화
  useEffect(() => {
    if (isOpen) {
      setValue('')
      setErr(null)
    }
  }, [isOpen])

  if (!isOpen) return null

  const submit = () => {
    const price = Number(value)
    if (!Number.isFinite(price) || price <= 0) {
      setErr('유효한 금액을 입력하세요.')
      return
    }
    if (price % 10 !== 0) {
      setErr('가격은 10원 단위로 입력 가능합니다.')
      return
    }
    onSubmit(price)
  }

  return (
    <div className="modal-overlay" onClick={loading ? undefined : onClose}>
      <div className="modal-content" style={{ width: '340px' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 600 }}>일괄 가격 수정</h3>
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#374151' }}>
          선택된 <b>{count.toLocaleString()}</b>건에 동일 가격을 적용합니다.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            placeholder="가격 (10원 단위)"
            value={value}
            disabled={loading}
            onChange={(e) => {
              setValue(e.target.value.replace(/[^\d]/g, ''))
              if (err) setErr(null)
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            style={{
              flex: 1,
              padding: '8px 10px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '14px',
              textAlign: 'right',
              outline: 'none',
            }}
          />
          <span style={{ color: '#6B7280' }}>원</span>
        </div>

        {err
          ? <div style={{ fontSize: '12px', color: '#EF4444', fontWeight: 500, marginTop: '6px' }}>{err}</div>
          : <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '6px' }}>
              ※ 기존가 대비 50%↓ ~ 100%↑ 범위를 벗어나는 항목은 실패로 처리됩니다.
            </div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <button
            className="purchase-btn"
            onClick={onClose}
            disabled={loading}
            style={{ background: '#f3f4f6', color: '#374151' }}
          >
            취소
          </button>
          <button className="purchase-btn" onClick={submit} disabled={loading}>
            {loading ? '처리 중...' : '적용'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default BulkPriceModal
