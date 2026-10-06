/* ================================================================
   AI 초안 박스 (InquiryAiDraftBox)
   - 고객문의 카드의 질문 아래에 붙는 초안 편집 영역 (디자인 v2)
   - 머리: "AI 초안 | 그룹 · 확정 전 처리 · 주문 취소" + 판단 근거 한 줄 / 오른쪽 '담당자 확인 필요'(앰버)
   - 본문: 내용 줄 수만큼 자동으로 늘어나는 textarea (스크롤 없음)
   - 꼬리 한 줄: "N자 · 확정 시 쿠팡으로 바로 전송" | 삭제 · AI 다시 쓰기 · 확정
   - 스타일은 pages/CustomerInquiry.css (.ci-draft-*)
   ================================================================ */

import React, { useLayoutEffect, useRef } from 'react'
import { categoryLabel, REQUIRED_ACTION_LABELS } from '../../services/inquiryAiService'
import type { InquiryDraftState } from './useInquiryAiDrafts'

interface Props {
  state: InquiryDraftState
  /** 판단 근거(note) 표시 여부 */
  showReasoning: boolean
  /** AI 다시 쓰기 가능 여부 (생성 중이면 false) */
  canRegenerate: boolean
  onChange: (text: string) => void
  onConfirm: () => void
  onDiscard: () => void
  onRegenerate: () => void
}

const InquiryAiDraftBox: React.FC<Props> = ({
  state, showReasoning, canRegenerate, onChange, onConfirm, onDiscard, onRegenerate,
}) => {
  const { draft, text, confirming, error } = state
  const canConfirm = !confirming && text.trim().length > 0
  // [담당자: …] 자리표시가 남아 있으면 확정 전에 고쳐야 한다
  const hasPlaceholder = /\[담당자:/.test(text)

  // ── 높이 = 내용 줄 수 (줄바꿈·자동 줄바꿈 모두) — 레이아웃 뒤에 재서 잘리지 않게 ──
  const textRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  return (
    <div className="ci-draft">
      {/* ── 머리 ── */}
      <div className="ci-draft-head">
        <div>
          <div className="ci-draft-meta">
            <span className="ci-draft-title">AI 초안</span>
            <span>{categoryLabel(draft.category)}</span>
            <span className="ci-draft-dot">·</span>
            <span>
              {draft.requiredAction
                ? `확정 전 처리 · ${REQUIRED_ACTION_LABELS[draft.requiredAction]}`
                : '자동 처리 없음'}
            </span>
          </div>
          {showReasoning && draft.note && <div className="ci-draft-note">{draft.note}</div>}
        </div>
        {draft.needsHuman && (
          <span className="ci-chip ci-chip-amber" title="사실 확인 또는 내용 보완이 필요합니다">담당자 확인 필요</span>
        )}
      </div>

      {/* ── 본문 ── */}
      <textarea
        ref={textRef}
        className="ci-draft-text"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        disabled={confirming}
        rows={2}
        spellCheck={false}
      />

      {/* ── 꼬리 ── */}
      <div className="ci-draft-foot">
        {hasPlaceholder ? (
          <span className="ci-draft-warn">[담당자: …] 부분을 채운 뒤 확정하세요.</span>
        ) : error ? (
          <span className="ci-draft-error">{error}</span>
        ) : (
          <span className="ci-draft-hint">{text.length}자 · 확정 시 쿠팡으로 바로 전송</span>
        )}
        <div className="ci-draft-btns">
          <button type="button" className="ci-btn ci-btn-text ci-btn-sm" onClick={onDiscard} disabled={confirming}>
            삭제
          </button>
          <button type="button" className="ci-btn ci-btn-sm" onClick={onRegenerate} disabled={confirming || !canRegenerate}>
            AI 다시 쓰기
          </button>
          <button
            type="button"
            className="ci-btn ci-btn-primary ci-btn-sm"
            onClick={onConfirm}
            disabled={!canConfirm || hasPlaceholder}
          >
            {confirming ? '전송 중…' : '확정'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default InquiryAiDraftBox
