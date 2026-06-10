/* ================================================================
   CartNameInputModal
   - [주문 전송] 시 ft_carts.cart_name 으로 들어갈 이름을 사용자에게 입력받는 모달
   - 단일 텍스트 입력 + [취소] / [저장]
   - 부모가 onSubmit 안에서 실제 전송. 실패(예: UNIQUE 충돌) 시 throw 하면
     모달은 그대로 유지 → 사용자가 다른 이름으로 재시도
   ================================================================ */

import React, { useEffect, useRef, useState } from 'react'
import Button from '../common/Button'
import { theme } from '../../styles/theme'

// ── 상수 ──────────────────────────────────────────────────────────
const MAX_CART_NAME_LENGTH = 100

// ── Props ─────────────────────────────────────────────────────────
interface CartNameInputModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (cartName: string) => Promise<void> | void
  loading?: boolean
}

// ══════════════════════════════════════════════════════════════════
// 컴포넌트
// ══════════════════════════════════════════════════════════════════

const CartNameInputModal: React.FC<CartNameInputModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  loading = false,
}) => {
  const [cartName, setCartName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // ── 열릴 때 초기화 + 포커스 ───────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setCartName('')
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isOpen])

  if (!isOpen) return null

  const trimmed = cartName.trim()
  const canSubmit = trimmed.length > 0 && !loading

  // ── 저장 ──────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!canSubmit) return
    await onSubmit(trimmed)
    // 성공·실패 모두 부모가 모달 닫기 제어 (실패 시 그대로 유지)
  }

  // ── 키보드: Enter 제출 / Esc 취소 ─────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && canSubmit) {
      e.preventDefault()
      void handleSubmit()
    } else if (e.key === 'Escape' && !loading) {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="modal-overlay" onClick={loading ? undefined : onClose}>
      <div
        className="modal-content"
        style={{ width: 380 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 헤더 ──────────────────────────────────────────── */}
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: theme.colors.textPrimary,
            marginBottom: 8,
          }}
        >
          주문 전송 — 카트 이름
        </div>
        <div
          style={{
            fontSize: 13,
            color: theme.colors.textSecondary,
            marginBottom: 16,
          }}
        >
          이번 주문 묶음을 식별할 카트 이름을 입력해 주세요. (최대 {MAX_CART_NAME_LENGTH}자)
        </div>

        {/* ── 입력 ──────────────────────────────────────────── */}
        <input
          ref={inputRef}
          type="text"
          value={cartName}
          onChange={(e) => setCartName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="예) 2026-06-15 정기발주"
          maxLength={MAX_CART_NAME_LENGTH}
          disabled={loading}
          style={{
            width: '100%',
            padding: '10px 12px',
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radius.md,
            fontSize: 14,
            boxSizing: 'border-box',
            outline: 'none',
          }}
        />

        {/* ── 푸터 ──────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 20,
          }}
        >
          <Button
            variant="default"
            onClick={onClose}
            disabled={loading}
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            취소
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            {loading ? '전송 중...' : '저장'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default CartNameInputModal
