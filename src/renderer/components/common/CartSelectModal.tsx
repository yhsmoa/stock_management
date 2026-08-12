/* ================================================================
   CartSelectModal — 장바구니 추가 대상 선택 모달
   - 기존 카트에 추가하거나, '신규' 를 골라 새 카트를 만든다.
   - 카트 드롭박스: 선택 / (기존 카트 목록) / 신규
   - '새 카트 이름' 입력은 '신규' 선택 시에만 활성화된다.
   - 실제 전송은 부모가 onSubmit 안에서 수행. 실패 시 throw 하면
     모달이 유지되어 사용자가 다시 시도할 수 있다.
   ================================================================ */

import React, { useEffect, useRef, useState } from 'react'
import Button from './Button'
import { theme } from '../../styles/theme'
import type { CartOption, CartTarget } from '../../services/orderSendService'

// ── 상수 ──────────────────────────────────────────────────────────
const MAX_CART_NAME_LENGTH = 100
/** 드롭박스에서 '신규 생성'을 뜻하는 값 (실제 카트 id 와 충돌하지 않는 값) */
const NEW_CART_VALUE = '__NEW__'

// ── Props ─────────────────────────────────────────────────────────
interface CartSelectModalProps {
  isOpen: boolean
  /** 전송 대상 건수 (제목에 표시) */
  count: number
  /** 선택 가능한 기존 카트 목록 */
  carts: CartOption[]
  /** 카트 목록 로딩 중 여부 */
  cartsLoading?: boolean
  /** 전송 진행 중 여부 */
  loading?: boolean
  onClose: () => void
  onSubmit: (target: CartTarget) => Promise<void> | void
}

// ══════════════════════════════════════════════════════════════════
// 컴포넌트
// ══════════════════════════════════════════════════════════════════

const CartSelectModal: React.FC<CartSelectModalProps> = ({
  isOpen,
  count,
  carts,
  cartsLoading = false,
  loading = false,
  onClose,
  onSubmit,
}) => {
  const [selected, setSelected] = useState('')      // '' = 미선택
  const [cartName, setCartName] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  const isNew = selected === NEW_CART_VALUE

  // ── 열릴 때 초기화 ────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setSelected('')
      setCartName('')
    }
  }, [isOpen])

  // ── '신규' 선택 시 이름 입력으로 포커스 ───────────────────────
  useEffect(() => {
    if (isNew) setTimeout(() => nameRef.current?.focus(), 0)
  }, [isNew])

  if (!isOpen) return null

  const trimmed = cartName.trim()
  const canSubmit =
    !loading
    && (isNew ? trimmed.length > 0 : selected !== '')

  // ── 저장 ──────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!canSubmit) return
    await onSubmit(
      isNew
        ? { mode: 'new', cartName: trimmed }
        : { mode: 'existing', cartId: selected },
    )
    // 성공·실패 모두 부모가 모달 닫기를 제어 (실패 시 유지)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSubmit) {
      e.preventDefault()
      void handleSubmit()
    } else if (e.key === 'Escape' && !loading) {
      e.preventDefault()
      onClose()
    }
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: theme.colors.textPrimary,
    marginBottom: 6,
  }

  return (
    <div className="modal-overlay" onClick={loading ? undefined : onClose}>
      <div
        className="modal-content"
        style={{ width: 380 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* ── 헤더 ──────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 20,
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 600, color: theme.colors.textPrimary }}>
            장바구니 추가 ({count.toLocaleString()}건)
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label="닫기"
            style={{
              border: 'none', background: 'none', fontSize: 18, lineHeight: 1,
              color: theme.colors.textMuted,
              cursor: loading ? 'not-allowed' : 'pointer', padding: 2,
            }}
          >
            ×
          </button>
        </div>

        {/* ── 카트 선택 ─────────────────────────────────────── */}
        <label style={labelStyle} htmlFor="cart-select">카트</label>
        <select
          id="cart-select"
          value={selected}
          disabled={loading || cartsLoading}
          onChange={(e) => setSelected(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radius.md,
            fontSize: 14,
            boxSizing: 'border-box',
            outline: 'none',
            background: '#fff',
            marginBottom: 18,
          }}
        >
          <option value="">{cartsLoading ? '불러오는 중...' : '선택'}</option>
          {carts.map((c) => (
            <option key={c.id} value={c.id}>{c.cart_name}</option>
          ))}
          <option value={NEW_CART_VALUE}>신규</option>
        </select>

        {/* ── 새 카트 이름 ('신규' 선택 시에만 활성) ─────────── */}
        <label
          style={{ ...labelStyle, color: isNew ? theme.colors.textPrimary : theme.colors.textMuted }}
          htmlFor="cart-name"
        >
          새 카트 이름
        </label>
        <input
          id="cart-name"
          ref={nameRef}
          type="text"
          value={cartName}
          onChange={(e) => setCartName(e.target.value)}
          placeholder={isNew ? '예) 2026-08-11 정기발주' : '신규를 선택하면 활성화됩니다'}
          maxLength={MAX_CART_NAME_LENGTH}
          disabled={!isNew || loading}
          style={{
            width: '100%',
            padding: '10px 12px',
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radius.md,
            fontSize: 14,
            boxSizing: 'border-box',
            outline: 'none',
            background: isNew ? '#fff' : theme.colors.bgHover,
            color: isNew ? theme.colors.textPrimary : theme.colors.textMuted,
            cursor: isNew ? 'text' : 'not-allowed',
          }}
        />

        {/* ── 푸터 ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
          <Button
            variant="default"
            onClick={onClose}
            disabled={loading}
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            닫기
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

export default CartSelectModal
