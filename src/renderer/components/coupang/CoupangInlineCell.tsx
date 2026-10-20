/* ================================================================
   상품관리 — 목록 칸 바로 수정 (숫자 1개)
   - 클릭 → 입력 → Enter 적용 / Esc · 바깥 클릭 취소 (실수로 값이 쿠팡에 가지 않도록 blur 는 취소)
   - 적용 중에는 입력을 잠그고, 실패하면 원래 값으로 돌아가 사유를 칸 아래에 잠깐 보여 준다
   - 막힌 칸(blockedReason)은 클릭해도 열리지 않고 이유를 툴팁으로 보여 준다
   ================================================================ */

import React, { useEffect, useRef, useState } from 'react'

const ERROR_VISIBLE_MS = 6000   // 실패 사유 표시 시간

interface Props {
  value: number | null
  /** 보기 모드에서 그릴 내용 */
  display: React.ReactNode
  /** 수정 불가 사유 (있으면 잠김) */
  blockedReason: string | null
  /** 입력 칸 접근성 이름 (예: "판매가") */
  label: string
  /** 숫자 입력 단위 표시 (예: "원", "개") */
  unit: string
  /** 적용 — 실패하면 Error 를 던진다 (메시지가 칸에 표시됨) */
  onCommit: (next: number) => Promise<void>
  className?: string
}

const CoupangInlineCell: React.FC<Props> = ({ value, display, blockedReason, label, unit, onCommit, className }) => {
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorTimer = useRef<number | null>(null)

  useEffect(() => () => { if (errorTimer.current) window.clearTimeout(errorTimer.current) }, [])

  const showError = (message: string) => {
    setError(message)
    if (errorTimer.current) window.clearTimeout(errorTimer.current)
    errorTimer.current = window.setTimeout(() => setError(null), ERROR_VISIBLE_MS)
  }

  const open = () => {
    if (blockedReason || saving) return
    setInput(value != null ? String(value) : '')
    setError(null)
    setEditing(true)
  }

  const cancel = () => { if (!saving) setEditing(false) }

  const commit = async () => {
    const raw = input.replace(/[,\s원개]/g, '')
    if (raw === '') { cancel(); return }
    const next = Number(raw)
    if (!Number.isFinite(next)) { showError('숫자로 입력하세요.'); return }
    if (next === value) { cancel(); return }
    setSaving(true)
    try {
      await onCommit(next)
      setEditing(false)
    } catch (err) {
      setEditing(false)
      showError(err instanceof Error ? err.message : '적용 실패')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className={`cp-inline-edit ${className ?? ''}`}>
        <input
          className="cp-inline-input cp-num"
          autoFocus
          inputMode="numeric"
          value={input}
          disabled={saving}
          aria-label={`${label} 입력`}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void commit() }
            else if (e.key === 'Escape') { e.preventDefault(); cancel() }
          }}
          onBlur={cancel}
          onFocus={(e) => e.currentTarget.select()}
        />
        <span className="cp-inline-unit">{saving ? '적용 중…' : unit}</span>
      </div>
    )
  }

  return (
    <div className={className}>
      <button
        type="button"
        className={`cp-inline-view${blockedReason ? ' is-locked' : ''}`}
        title={blockedReason ?? `클릭해서 ${label} 바로 수정 (Enter 적용 · Esc 취소)`}
        aria-label={blockedReason ? `${label} (수정 불가: ${blockedReason})` : `${label} 수정`}
        onClick={open}
      >
        {display}
      </button>
      {error && <div className="cp-inline-error" role="alert">{error}</div>}
    </div>
  )
}

export default CoupangInlineCell
