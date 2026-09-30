/* ================================================================
   BoxRangeSelectModal — 로켓그로스 출고 [조건 선택]
   - 박스 letter(A/B/C) + 박스 번호 from~to 범위로 체크 대상을 한 번에 선택
   - 열 때 현재 탭의 letter, 그 letter 의 최소~최대 박스 번호로 채운다
   - 입력하는 동안 해당 행·박스 수를 미리 보여준다
   ================================================================ */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import Button from '../common/Button'
import { theme } from '../../styles/theme'
import {
  SIZE_BY_LETTER,
  locationLetter,
  locationBoxNumber,
  isInBoxRange,
  type RocketShipmentRow,
} from '../../services/rocketShipmentService'

// ── 상수 ──────────────────────────────────────────────────────
const LETTERS = Object.keys(SIZE_BY_LETTER)

// ── Props ─────────────────────────────────────────────────────
interface BoxRangeSelectModalProps {
  isOpen: boolean
  onClose: () => void
  rows: RocketShipmentRow[]
  /** 열 때 기본 선택할 letter (현재 탭) */
  defaultLetter: string
  onConfirm: (letter: string, from: number, to: number) => void
}

// ── 박스 번호 입력값 → 양의 정수 (아니면 null) ─────────────────
const parseBoxNo = (text: string): number | null => {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n >= 1 ? n : null
}

// ══════════════════════════════════════════════════════════════════
// 컴포넌트
// ══════════════════════════════════════════════════════════════════

const BoxRangeSelectModal: React.FC<BoxRangeSelectModalProps> = ({
  isOpen,
  onClose,
  rows,
  defaultLetter,
  onConfirm,
}) => {
  const [letter, setLetter] = useState(defaultLetter)
  const [fromText, setFromText] = useState('')
  const [toText, setToText] = useState('')
  const fromRef = useRef<HTMLInputElement>(null)

  // ── letter 별 박스 번호 범위 (등록된 파일 기준) ──────────────────
  const rangeByLetter = useMemo(() => {
    const map = new Map<string, { min: number; max: number }>()
    for (const r of rows) {
      const l = locationLetter(r.location)
      const n = locationBoxNumber(r.location)
      if (!l || n == null) continue
      const cur = map.get(l)
      map.set(l, cur ? { min: Math.min(cur.min, n), max: Math.max(cur.max, n) } : { min: n, max: n })
    }
    return map
  }, [rows])

  // ── letter 변경 시 from/to 를 그 letter 의 최소~최대로 채운다 ─────
  const applyLetter = (l: string) => {
    setLetter(l)
    const range = rangeByLetter.get(l)
    setFromText(range ? String(range.min) : '')
    setToText(range ? String(range.max) : '')
  }

  // ── 열릴 때 초기화 + 포커스 ───────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    applyLetter(defaultLetter)
    setTimeout(() => fromRef.current?.select(), 0)
    // 열릴 때 한 번만 초기화 — rows/rangeByLetter 는 모달이 열린 동안 바뀌지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // ── 입력 검증 + 미리보기 (해당 행 수 / 박스 수) ────────────────
  const from = parseBoxNo(fromText)
  const to = parseBoxNo(toText)
  const inputError =
    from == null || to == null ? '박스 번호는 1 이상의 숫자로 입력해 주세요.'
    : from > to ? '시작 번호가 끝 번호보다 클 수 없습니다.'
    : ''

  const preview = useMemo(() => {
    if (inputError || from == null || to == null) return { rowCount: 0, boxCount: 0 }
    const boxes = new Set<string>()
    let rowCount = 0
    for (const r of rows) {
      if (!isInBoxRange(r.location, letter, from, to)) continue
      rowCount++
      boxes.add(r.location)
    }
    return { rowCount, boxCount: boxes.size }
  }, [rows, letter, from, to, inputError])

  if (!isOpen) return null

  const canConfirm = !inputError && preview.rowCount > 0
  const range = rangeByLetter.get(letter)

  const handleConfirm = () => {
    if (!canConfirm || from == null || to == null) return
    onConfirm(letter, from, to)
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleConfirm()
    }
  }

  // ── 박스 번호 입력칸 공통 스타일 ──
  const numberInputStyle: React.CSSProperties = {
    width: 80,
    padding: '8px 10px',
    border: `1px solid ${inputError ? theme.colors.danger : theme.colors.border}`,
    borderRadius: theme.radius.md,
    fontSize: 14,
    textAlign: 'center',
    boxSizing: 'border-box',
    outline: 'none',
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ width: 380 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 헤더 ──────────────────────────────────────────── */}
        <div style={{ fontSize: 16, fontWeight: 600, color: theme.colors.textPrimary, marginBottom: 8 }}>
          조건 선택
        </div>
        <div style={{ fontSize: 13, color: theme.colors.textSecondary, marginBottom: 16 }}>
          박스 범위에 해당하는 행만 체크합니다. 기존 선택은 해제됩니다.
        </div>

        {/* ── 박스 letter (A/B/C = Small/Medium/Large 탭) ────── */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {LETTERS.map((l) => {
            const active = l === letter
            return (
              <button
                key={l}
                type="button"
                onClick={() => applyLetter(l)}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  borderRadius: theme.radius.md,
                  border: `1px solid ${active ? theme.colors.primary : theme.colors.border}`,
                  background: active ? theme.colors.primaryLight : theme.colors.bgCard,
                  color: active ? theme.colors.primary : theme.colors.textPrimary,
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  cursor: 'pointer',
                }}
              >
                {l} <span style={{ fontSize: 11, color: theme.colors.textSecondary }}>({SIZE_BY_LETTER[l]})</span>
              </button>
            )
          })}
        </div>

        {/* ── 박스 번호 범위 입력: A [from] 번 ~ [to] 번 박스 ─── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: theme.colors.textPrimary }}>
          <span style={{ fontWeight: 600 }}>{letter}</span>
          <input
            ref={fromRef}
            type="text"
            inputMode="numeric"
            value={fromText}
            onChange={(e) => setFromText(e.target.value)}
            onKeyDown={handleKeyDown}
            style={numberInputStyle}
          />
          <span>번 ~</span>
          <input
            type="text"
            inputMode="numeric"
            value={toText}
            onChange={(e) => setToText(e.target.value)}
            onKeyDown={handleKeyDown}
            style={numberInputStyle}
          />
          <span>번 박스</span>
        </div>

        {/* ── 등록된 범위 안내 · 검증 에러 · 미리보기 ─────────── */}
        <div style={{ marginTop: 10, fontSize: 12, color: theme.colors.textSecondary }}>
          {range ? `등록된 ${letter} 박스: ${range.min}번 ~ ${range.max}번` : `등록된 ${letter} 박스가 없습니다.`}
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 12,
            fontWeight: 500,
            color: inputError ? theme.colors.danger : theme.colors.primary,
          }}
        >
          {inputError || `해당 ${preview.rowCount.toLocaleString()}건 (박스 ${preview.boxCount}개)`}
        </div>

        {/* ── 푸터 ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <Button
            variant="default"
            onClick={onClose}
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            취소
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            선택
          </Button>
        </div>
      </div>
    </div>
  )
}

export default BoxRangeSelectModal
