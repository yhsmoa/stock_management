/* ================================================================
   PasswordConfirmModal
   - 파괴적 작업(리셋 등) 실행 전 현재 로그인 유저의 패스워드 재확인
   - localStorage.user.username + 입력 패스워드로 si_users 단일 행 조회
   - 일치 시 onConfirm() 호출, 불일치/에러는 인라인 메시지 표시
   ================================================================ */

import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../services/supabase'
import Button from './Button'
import { theme } from '../../styles/theme'

// ── Props ─────────────────────────────────────────────────────
interface PasswordConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title?: string
  description?: string
  confirmLabel?: string
  confirmVariant?: 'primary' | 'danger'
}

// ══════════════════════════════════════════════════════════════════
// 컴포넌트
// ══════════════════════════════════════════════════════════════════

const PasswordConfirmModal: React.FC<PasswordConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title = '비밀번호 확인',
  description = '계속하려면 현재 계정 비밀번호를 입력해주세요.',
  confirmLabel = '확인',
  confirmVariant = 'danger',
}) => {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── 열릴 때 초기화 + 포커스 ───────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setPassword('')
      setError('')
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isOpen])

  if (!isOpen) return null

  // ── 확인: si_users username + password 일치 검증 ──────────────
  const handleConfirm = async () => {
    if (!password) {
      setError('비밀번호를 입력해주세요.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const raw = localStorage.getItem('user')
      if (!raw) {
        setError('로그인 정보를 찾을 수 없습니다. 다시 로그인 해주세요.')
        setLoading(false)
        return
      }

      const user = JSON.parse(raw) as { username?: string }
      const username = user.username
      if (!username) {
        setError('사용자 정보가 올바르지 않습니다.')
        setLoading(false)
        return
      }

      // si_users 는 계정별 1행 → 1000 행 한계 무관 (단일 maybeSingle 조회)
      const { data, error: dbError } = await supabase
        .from('si_users')
        .select('id')
        .eq('username', username)
        .eq('password', password)
        .maybeSingle()

      if (dbError) {
        setError('확인 중 오류가 발생했습니다.')
        setLoading(false)
        return
      }

      if (!data) {
        setError('비밀번호가 일치하지 않습니다.')
        setLoading(false)
        return
      }

      // ── 일치: 상위에 위임 ──
      await onConfirm()
      setLoading(false)
    } catch (err) {
      console.error('[PasswordConfirmModal] 확인 실패:', err)
      setError('확인 중 오류가 발생했습니다.')
      setLoading(false)
    }
  }

  // ── 엔터 제출 ─────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !loading) {
      e.preventDefault()
      void handleConfirm()
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ width: 360 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 헤더 ──────────────────────────────────────────── */}
        <div style={{ fontSize: 16, fontWeight: 600, color: theme.colors.textPrimary, marginBottom: 8 }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: theme.colors.textSecondary, marginBottom: 16 }}>
          {description}
        </div>

        {/* ── 비밀번호 입력 ─────────────────────────────────── */}
        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            if (error) setError('')
          }}
          onKeyDown={handleKeyDown}
          placeholder="비밀번호"
          autoComplete="current-password"
          disabled={loading}
          style={{
            width: '100%',
            padding: '10px 12px',
            border: `1px solid ${error ? theme.colors.danger : theme.colors.border}`,
            borderRadius: theme.radius.md,
            fontSize: 14,
            boxSizing: 'border-box',
            outline: 'none',
          }}
        />

        {/* ── 에러 메시지 ───────────────────────────────────── */}
        {error && (
          <div style={{ marginTop: 8, fontSize: 12, color: theme.colors.danger }}>
            {error}
          </div>
        )}

        {/* ── 푸터 ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <Button
            variant="default"
            onClick={onClose}
            disabled={loading}
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            취소
          </Button>
          <Button
            variant={confirmVariant}
            onClick={() => void handleConfirm()}
            disabled={loading}
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            {loading ? '확인 중...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default PasswordConfirmModal
