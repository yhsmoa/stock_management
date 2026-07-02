/* ================================================================
   쿠팡문의 우측 드로어 (CoupangInquiryDrawer)
   - mode='reply'   : 단건 조회로 parentAnswerId 확보 → 답변 작성/전송
   - mode='confirm' : TRANSFER(미확인) 건 확인 처리
   - 문의 내용 + 답변 타임라인(csAgent/vendor) 표시
   - 액션 버튼은 모달 최하단(footer)에 배치
   - 처리 완료(답변완료/확인완료) 시 버튼이 완료 상태로 변경, 재열람 가능
   ================================================================ */

import React, { useEffect, useState } from 'react'
import { theme } from '../../styles/theme'
import {
  fetchCallCenterInquiryDetail,
  extractParentAnswerId,
  type CallCenterInquiry,
} from '../../services/ccInquiryService'
import LinkedText from '../common/LinkedText'

// ── 답변 템플릿 ────────────────────────────────────────────────────
const REPLY_TEMPLATES: { label: string; text: string }[] = [
  { label: '배송지연 안내', text: '안녕하세요, 고객님.\n주문하신 상품이 입고 지연으로 배송이 다소 지연되고 있습니다.\n빠른 시일 내에 발송해 드리겠습니다. 양해 부탁드립니다.' },
  { label: '출고예정 안내', text: '안녕하세요, 고객님.\n주문하신 상품은 출고 예정일에 맞춰 순차 발송될 예정입니다.\n조금만 기다려 주시면 감사하겠습니다.' },
  { label: '취소 안내', text: '안녕하세요, 고객님.\n요청하신 주문 취소 처리 도와드리겠습니다.\n확인 후 신속히 처리해 드리겠습니다.' },
  { label: '반품-회수진행', text: '해당 주문건 현재 회수중에 있으며 기사님 방문 시 회수할 수 있도록 준비해주시면 감사드리겠습니다.' },
  { label: '반품-입고완료', text: '해당 주문건 현재 입고되었으며 순차적으로 처리될 예정입니다.' },
]

type DoneState = '답변완료' | '확인완료' | null

// ── 유틸 ──────────────────────────────────────────────────────────
function fmt(iso: string): string {
  if (!iso) return '-'
  return iso.replace('T', ' ').slice(0, 19).replace(/-/g, '.')
}

// ── Props ──────────────────────────────────────────────────────────
interface Props {
  open: boolean
  mode: 'reply' | 'confirm' | null
  inquiry: CallCenterInquiry | null
  replyByDefault: string
  alreadyHandled: DoneState // 이미 처리된 건이면 완료 상태로 표시 (재열람)
  onSubmitReply: (content: string, replyBy: string, parentAnswerId: number | string) => Promise<void>
  onConfirm: (confirmBy: string) => Promise<void>
  onClose: () => void
}

// ══════════════════════════════════════════════════════════════════
const CoupangInquiryDrawer: React.FC<Props> = ({
  open, mode, inquiry, replyByDefault, alreadyHandled, onSubmitReply, onConfirm, onClose,
}) => {
  const [detail, setDetail] = useState<CallCenterInquiry | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [answerText, setAnswerText] = useState('')
  const [wingId, setWingId] = useState(replyByDefault)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [localDone, setLocalDone] = useState<DoneState>(null)

  // 문의/모드 변경 시 초기화 + reply/confirm 공통 단건 조회
  useEffect(() => {
    setAnswerText('')
    setError('')
    setLocalDone(null)
    setWingId(replyByDefault)
    setDetail(null)
    if (!open || !inquiry) return
    let cancelled = false
    setLoadingDetail(true)
    ;(async () => {
      try {
        const d = await fetchCallCenterInquiryDetail(inquiry.inquiryId)
        if (!cancelled) setDetail(d ?? inquiry)
      } catch (e: any) {
        if (!cancelled) { setDetail(inquiry); setError(`단건 조회 실패: ${e?.message ?? e}`) }
      } finally {
        if (!cancelled) setLoadingDetail(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, inquiry, replyByDefault])

  // ESC 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const shown = detail ?? inquiry
  const effectiveDone: DoneState = localDone ?? alreadyHandled
  const parentAnswerId = detail ? extractParentAnswerId(detail) : null
  const canReply = !submitting && answerText.trim().length >= 2 && wingId.trim().length > 0 && parentAnswerId != null
  const canConfirm = !submitting && wingId.trim().length > 0

  const handleReply = async () => {
    if (parentAnswerId == null) { setError('parentAnswerId를 찾을 수 없습니다.'); return }
    setSubmitting(true); setError('')
    try {
      await onSubmitReply(answerText, wingId, parentAnswerId)
      try { localStorage.setItem('cs_reply_by', wingId.trim()) } catch { /* 무시 */ }
      setLocalDone('답변완료')
      setAnswerText('')
    } catch (e: any) {
      setError(e?.message ?? '전송 실패')
    } finally { setSubmitting(false) }
  }

  const handleConfirm = async () => {
    setSubmitting(true); setError('')
    try {
      await onConfirm(wingId)
      try { localStorage.setItem('cs_reply_by', wingId.trim()) } catch { /* 무시 */ }
      setLocalDone('확인완료')
    } catch (e: any) {
      setError(e?.message ?? '확인 실패')
    } finally { setSubmitting(false) }
  }

  // ── footer 버튼 ────────────────────────────────────────────────
  const renderFooterButton = () => {
    if (effectiveDone) {
      return (
        <button
          disabled
          style={{ ...footerBtn, background: theme.colors.success, cursor: 'default' }}
        >
          ✓ {effectiveDone}
        </button>
      )
    }
    if (mode === 'reply') {
      return (
        <button
          onClick={handleReply}
          disabled={!canReply}
          style={{ ...footerBtn, background: canReply ? theme.colors.primary : theme.colors.border, cursor: canReply ? 'pointer' : 'default' }}
        >
          {submitting ? '전송 중...' : '답변하기'}
        </button>
      )
    }
    return (
      <button
        onClick={handleConfirm}
        disabled={!canConfirm}
        style={{ ...footerBtn, background: canConfirm ? theme.colors.warning : theme.colors.border, cursor: canConfirm ? 'pointer' : 'default' }}
      >
        {submitting ? '처리 중...' : '확인 처리'}
      </button>
    )
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1010, opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'opacity 0.2s' }}
      />
      <aside
        style={{
          position: 'fixed', top: 0, right: 0, height: '100%', width: 500, maxWidth: '96vw',
          background: theme.colors.bgCard, boxShadow: theme.shadows.lg, zIndex: 1011,
          transform: open ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.25s ease',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '18px 22px', borderBottom: `1px solid ${theme.colors.borderLight}`, gap: 12, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'inline-block', fontSize: 11, color: '#fff', background: effectiveDone ? theme.colors.success : mode === 'confirm' ? theme.colors.warning : theme.colors.primary, padding: '2px 8px', borderRadius: 4, marginBottom: 6 }}>
              {effectiveDone ? effectiveDone : mode === 'confirm' ? '문의 확인' : '답변하기'}
            </span>
            <p style={{ fontSize: 13, color: theme.colors.textPrimary, margin: '0 0 4px', lineHeight: 1.5 }}>
              {shown?.itemName || '상품 정보 없음'}
            </p>
            <p style={{ fontSize: 12, color: theme.colors.textMuted, margin: 0, fontFamily: 'monospace' }}>
              {shown?.orderId ? `주문번호 ${shown.orderId}` : '주문번호 -'}
              {shown?.receiptCategory ? ` · ${shown.receiptCategory}` : ''}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: theme.colors.textMuted, cursor: 'pointer', flexShrink: 0 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
          {/* 문의 내용 */}
          <div style={sectionLabel}>문의 내용</div>
          <div style={{ ...boxStyle, whiteSpace: 'pre-wrap' }}>
            {shown?.content ? <LinkedText text={shown.content} /> : '-'}
            <div style={{ fontSize: theme.fontSize.xs, color: theme.colors.textMuted, marginTop: 6 }}>
              {fmt(shown?.inquiryAt ?? '')}
              {shown?.buyerPhone ? ` · ${shown.buyerPhone}` : ''}
            </div>
          </div>

          {/* 답변 타임라인 */}
          {loadingDetail ? (
            <div style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.sm, margin: '14px 0' }}>상세 불러오는 중...</div>
          ) : (shown?.replies?.length ?? 0) > 0 ? (
            <div style={{ margin: '18px 0' }}>
              <div style={sectionLabel}>답변 내역</div>
              {shown!.replies.map((r) => (
                <div key={r.answerId} style={{ ...boxStyle, whiteSpace: 'pre-wrap', marginBottom: 8, background: r.answerType === 'vendor' ? theme.colors.primaryLight : theme.colors.bgTableHeader }}>
                  <div style={{ fontSize: theme.fontSize.xs, color: theme.colors.textMuted, marginBottom: 4 }}>
                    {r.answerType === 'vendor' ? '판매자' : '쿠팡상담'} · {fmt(r.replyAt)}
                  </div>
                  <LinkedText text={r.content} />
                </div>
              ))}
            </div>
          ) : null}

          {/* 이미 처리됨 → 입력 폼 숨김 */}
          {effectiveDone ? (
            <div style={{ margin: '16px 0', padding: '10px 12px', background: theme.colors.bgTableHeader, borderRadius: theme.radius.sm, fontSize: theme.fontSize.sm, color: theme.colors.success, fontWeight: 600 }}>
              ✓ {effectiveDone} 처리된 문의입니다.
            </div>
          ) : mode === 'reply' ? (
            <>
              <div style={{ ...sectionLabel, marginTop: 14 }}>답변 입력 (2~1,000자)</div>
              <textarea
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                placeholder="답변 내용을 입력하세요."
                style={{ width: '100%', minHeight: 110, padding: '10px 12px', border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius.sm, fontSize: theme.fontSize.sm, resize: 'vertical', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit', lineHeight: 1.6 }}
              />
              <div style={{ fontSize: theme.fontSize.xs, color: theme.colors.textMuted, textAlign: 'right', marginTop: 4 }}>{answerText.length}자</div>

              <div style={{ ...sectionLabel, marginTop: 10 }}>답변 템플릿</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {REPLY_TEMPLATES.map((t) => (
                  <button key={t.label} onClick={() => setAnswerText(t.text)} style={{ padding: '6px 12px', border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius.full, background: theme.colors.bgTableHeader, color: theme.colors.textSecondary, fontSize: theme.fontSize.xs, cursor: 'pointer' }}>
                    {t.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div style={{ margin: '16px 0', padding: '10px 12px', background: theme.colors.bgTableHeader, borderRadius: theme.radius.sm, fontSize: theme.fontSize.xs, color: theme.colors.textSecondary, lineHeight: 1.6 }}>
              쿠팡 상담이 완료되어 업체로 이관된 문의입니다. 답변이 아닌 <strong>확인 처리</strong>만 하면 됩니다.
              <br />24시간 경과 또는 종료된 문의는 확인할 수 없습니다.
            </div>
          )}

          {/* WING ID (미처리 시에만) */}
          {!effectiveDone && (
            <>
              <div style={{ ...sectionLabel, marginTop: 14 }}>응답자 ID (WING)</div>
              <input
                value={wingId}
                onChange={(e) => setWingId(e.target.value)}
                placeholder="셀러포탈(WING) 로그인 ID"
                style={{ width: '100%', padding: '8px 12px', border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius.sm, fontSize: theme.fontSize.sm, boxSizing: 'border-box', outline: 'none' }}
              />
            </>
          )}

          {error && <div style={{ color: theme.colors.danger, fontSize: theme.fontSize.sm, marginTop: 10 }}>{error}</div>}
        </div>

        {/* Footer: 액션 버튼 (최하단) */}
        <div style={{ flexShrink: 0, padding: '14px 22px', borderTop: `1px solid ${theme.colors.borderLight}` }}>
          {renderFooterButton()}
        </div>
      </aside>
    </>
  )
}

// ── 스타일 ─────────────────────────────────────────────────────────
const sectionLabel: React.CSSProperties = { fontSize: theme.fontSize.xs, fontWeight: 600, color: theme.colors.textSecondary, marginBottom: 6 }
const boxStyle: React.CSSProperties = { padding: '10px 12px', border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius.sm, fontSize: theme.fontSize.sm, color: theme.colors.textPrimary, lineHeight: 1.6 }
const footerBtn: React.CSSProperties = { width: '100%', padding: '11px 16px', border: 'none', borderRadius: theme.radius.sm, color: '#fff', fontSize: theme.fontSize.base, fontWeight: 700 }

export default CoupangInquiryDrawer
