/* ================================================================
   고객문의 우측 드로어 (CustomerInquiryDrawer)
   - mode='reply'   : 답변 작성 폼 + 템플릿 + 기존/제출 답변 타임라인
                      헤더 우측 '답변하기' 버튼으로 전송
   - mode='history' : 해당 주문번호의 이전 문의 + 답변 내역
   - personal-order FulfillmentDrawer 와 동일한 우측 슬라이드 UX (inline theme)
   ================================================================ */

import React, { useEffect, useMemo, useState } from 'react'
import { theme } from '../../styles/theme'
import type { OnlineInquiry, OrderDetail } from '../../services/csService'
import LinkedText from '../common/LinkedText'

// ── 답변 템플릿 (편집 가능) ────────────────────────────────────────
const REPLY_TEMPLATES: { label: string; text: string }[] = [
  {
    label: '배송지연 안내',
    text: '안녕하세요, 고객님.\n주문하신 상품이 입고 지연으로 배송이 다소 지연되고 있습니다.\n빠른 시일 내에 발송해 드리겠습니다. 양해 부탁드립니다.',
  },
  {
    label: '출고예정 안내',
    text: '안녕하세요, 고객님.\n주문하신 상품은 출고 예정일에 맞춰 순차 발송될 예정입니다.\n조금만 기다려 주시면 감사하겠습니다.',
  },
  {
    label: '취소 안내',
    text: '안녕하세요, 고객님.\n요청하신 주문 취소 처리 도와드리겠습니다.\n확인 후 신속히 처리해 드리겠습니다.',
  },
  {
    label: '재고확인 안내',
    text: '안녕하세요, 고객님.\n문의하신 상품의 재고를 확인한 뒤 안내드리겠습니다.\n잠시만 기다려 주세요.',
  },
]

// ── 유틸 ──────────────────────────────────────────────────────────
function fmtDateTime(iso: string): string {
  if (!iso) return '-'
  return iso.replace('T', ' ').slice(0, 19).replace(/-/g, '.')
}

/** 주문 상세에서 해당 옵션(vendorItemId) 라인 선택 */
function pickLine(detail: OrderDetail | null | undefined, vendorItemId: string) {
  if (!detail) return null
  return detail.lines.find((l) => l.vendorItemId === vendorItemId) ?? detail.lines[0] ?? null
}

// ── Props ──────────────────────────────────────────────────────────
export interface Answer {
  content: string
  at: string
}

interface Props {
  open: boolean
  mode: 'reply' | 'history' | null
  inquiry: OnlineInquiry | null
  detail: OrderDetail | null | undefined
  answers: Answer[]                 // reply 모드: 기존 + 제출된 답변
  replyByDefault: string
  onSubmitReply: (content: string, replyBy: string) => Promise<void>
  historyLoading: boolean
  historyItems: OnlineInquiry[]     // history 모드: 같은 주문의 이전 문의
  onClose: () => void
}

// ══════════════════════════════════════════════════════════════════
// 컴포넌트
// ══════════════════════════════════════════════════════════════════

const CustomerInquiryDrawer: React.FC<Props> = ({
  open, mode, inquiry, detail, answers, replyByDefault,
  onSubmitReply, historyLoading, historyItems, onClose,
}) => {
  const [answerText, setAnswerText] = useState('')
  const [replyBy, setReplyBy] = useState(replyByDefault)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [doneMsg, setDoneMsg] = useState('')

  // 문의/모드 변경 시 폼 초기화
  useEffect(() => {
    setAnswerText('')
    setError('')
    setDoneMsg('')
    setReplyBy(replyByDefault)
  }, [inquiry?.inquiryId, mode, replyByDefault])

  // ESC 로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const line = useMemo(
    () => pickLine(detail, String(inquiry?.vendorItemId ?? '')),
    [detail, inquiry?.vendorItemId],
  )
  const productLabel =
    line ? [line.sellerProductName, line.optionName].filter(Boolean).join(' · ')
         : inquiry ? `상품 ${inquiry.productId}` : ''
  const orderId = String(inquiry?.orderIds?.[0] ?? '')

  // ── 답변 전송 ────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!inquiry) return
    setSubmitting(true)
    setError('')
    setDoneMsg('')
    try {
      await onSubmitReply(answerText, replyBy)
      try { localStorage.setItem('cs_reply_by', replyBy.trim()) } catch { /* 무시 */ }
      setDoneMsg('답변이 전송되었습니다.')
      setAnswerText('')
    } catch (e: any) {
      setError(e?.message ?? '전송에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = !submitting && answerText.trim().length > 0 && replyBy.trim().length > 0

  return (
    <>
      {/* ── Backdrop ── */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.3)',
          zIndex: 1010,
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.2s',
        }}
      />

      {/* ── Drawer ── */}
      <aside
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: '100%',
          width: 480,
          maxWidth: '95vw',
          background: theme.colors.bgCard,
          boxShadow: theme.shadows.lg,
          zIndex: 1011,
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s ease',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '18px 22px',
            borderBottom: `1px solid ${theme.colors.borderLight}`,
            flexShrink: 0,
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                display: 'inline-block',
                fontSize: 11,
                color: '#fff',
                background: mode === 'reply' ? theme.colors.primary : theme.colors.secondary,
                padding: '2px 8px',
                borderRadius: 4,
                marginBottom: 6,
              }}
            >
              {mode === 'reply' ? '답변하기' : '이전문의'}
            </span>
            <p style={{ fontSize: 13, color: theme.colors.textPrimary, margin: '0 0 4px', lineHeight: 1.5 }}>
              {productLabel || '상품 정보 없음'}
            </p>
            <p style={{ fontSize: 12, color: theme.colors.textMuted, margin: 0, fontFamily: 'monospace' }}>
              주문번호 {orderId || '-'}
            </p>
          </div>

          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 18, color: theme.colors.textMuted, cursor: 'pointer', flexShrink: 0 }}
          >
            ✕
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
          {mode === 'reply' ? (
            <ReplyBody
              inquiry={inquiry}
              answers={answers}
              answerText={answerText}
              setAnswerText={setAnswerText}
              replyBy={replyBy}
              setReplyBy={setReplyBy}
              error={error}
              doneMsg={doneMsg}
            />
          ) : (
            <HistoryBody loading={historyLoading} items={historyItems} currentInquiryId={inquiry?.inquiryId} />
          )}
        </div>

        {/* ── Footer: 답변하기 (최하단) ── */}
        {mode === 'reply' && (
          <div style={{ flexShrink: 0, padding: '14px 22px', borderTop: `1px solid ${theme.colors.borderLight}` }}>
            <button
              onClick={handleSubmit}
              disabled={!!doneMsg || !canSubmit}
              style={{
                width: '100%',
                padding: '11px 16px',
                border: 'none',
                borderRadius: theme.radius.sm,
                background: doneMsg ? theme.colors.success : canSubmit ? theme.colors.primary : theme.colors.border,
                color: '#fff',
                fontSize: theme.fontSize.base,
                fontWeight: 700,
                cursor: doneMsg || !canSubmit ? 'default' : 'pointer',
              }}
            >
              {doneMsg ? '✓ 답변완료' : submitting ? '전송 중...' : '답변하기'}
            </button>
          </div>
        )}
      </aside>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════
// 답변 작성 본문
// ══════════════════════════════════════════════════════════════════

const ReplyBody: React.FC<{
  inquiry: OnlineInquiry | null
  answers: Answer[]
  answerText: string
  setAnswerText: (v: string) => void
  replyBy: string
  setReplyBy: (v: string) => void
  error: string
  doneMsg: string
}> = ({ inquiry, answers, answerText, setAnswerText, replyBy, setReplyBy, error, doneMsg }) => (
  <>
    {/* 문의 내용 */}
    <div style={{ marginBottom: 18 }}>
      <div style={sectionLabel}>문의 내용</div>
      <div style={{ ...boxStyle, whiteSpace: 'pre-wrap' }}>
        {inquiry?.content ? <LinkedText text={inquiry.content} /> : '-'}
        <div style={{ fontSize: theme.fontSize.xs, color: theme.colors.textMuted, marginTop: 6 }}>
          {fmtDateTime(inquiry?.inquiryAt ?? '')}
        </div>
      </div>
    </div>

    {/* 기존/제출 답변 타임라인 */}
    {answers.length > 0 && (
      <div style={{ marginBottom: 18 }}>
        <div style={sectionLabel}>답변 내역</div>
        {answers.map((a, i) => (
          <div
            key={i}
            style={{
              ...boxStyle,
              whiteSpace: 'pre-wrap',
              background: theme.colors.primaryLight,
              borderColor: theme.colors.primary,
              marginBottom: 8,
            }}
          >
            <LinkedText text={a.content} />
            <div style={{ fontSize: theme.fontSize.xs, color: theme.colors.textMuted, marginTop: 6 }}>
              {fmtDateTime(a.at)}
            </div>
          </div>
        ))}
      </div>
    )}

    {/* 답변 입력 */}
    <div style={{ marginBottom: 12 }}>
      <div style={sectionLabel}>답변 입력</div>
      <textarea
        value={answerText}
        onChange={(e) => setAnswerText(e.target.value)}
        placeholder="답변 내용을 입력하세요."
        style={{
          width: '100%',
          minHeight: 120,
          padding: '10px 12px',
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.radius.sm,
          fontSize: theme.fontSize.sm,
          resize: 'vertical',
          boxSizing: 'border-box',
          outline: 'none',
          fontFamily: 'inherit',
          lineHeight: 1.6,
        }}
      />
      <div style={{ fontSize: theme.fontSize.xs, color: theme.colors.textMuted, textAlign: 'right', marginTop: 4 }}>
        {answerText.length}자
      </div>
    </div>

    {/* 템플릿 */}
    <div style={{ marginBottom: 16 }}>
      <div style={sectionLabel}>답변 템플릿</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {REPLY_TEMPLATES.map((t) => (
          <button
            key={t.label}
            onClick={() => setAnswerText(t.text)}
            style={{
              padding: '6px 12px',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radius.full,
              background: theme.colors.bgTableHeader,
              color: theme.colors.textSecondary,
              fontSize: theme.fontSize.xs,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>

    {/* 응답자(WING) ID */}
    <div style={{ marginBottom: 12 }}>
      <div style={sectionLabel}>응답자 ID (WING)</div>
      <input
        value={replyBy}
        onChange={(e) => setReplyBy(e.target.value)}
        placeholder="셀러포탈(WING) 로그인 ID"
        style={{
          width: '100%',
          padding: '8px 12px',
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.radius.sm,
          fontSize: theme.fontSize.sm,
          boxSizing: 'border-box',
          outline: 'none',
        }}
      />
    </div>

    {/* 상태 메시지 */}
    {error && (
      <div style={{ color: theme.colors.danger, fontSize: theme.fontSize.sm, marginTop: 8 }}>{error}</div>
    )}
    {doneMsg && (
      <div style={{ color: theme.colors.success, fontSize: theme.fontSize.sm, marginTop: 8 }}>{doneMsg}</div>
    )}
  </>
)

// ══════════════════════════════════════════════════════════════════
// 이전문의 본문
// ══════════════════════════════════════════════════════════════════

const HistoryBody: React.FC<{
  loading: boolean
  items: OnlineInquiry[]
  currentInquiryId?: number
}> = ({ loading, items, currentInquiryId }) => {
  if (loading) {
    return <div style={{ textAlign: 'center', padding: '60px 0', color: theme.colors.textSecondary }}>불러오는 중...</div>
  }
  if (items.length === 0) {
    return <div style={{ textAlign: 'center', padding: '60px 0', color: theme.colors.textMuted }}>이전 문의 내역이 없습니다.</div>
  }
  return (
    <>
      <div style={{ ...sectionLabel, marginBottom: 12 }}>이 주문의 문의 내역 ({items.length}건)</div>
      {items.map((inq) => {
        const answered = (inq.commentDtoList?.length ?? 0) > 0
        const isCurrent = inq.inquiryId === currentInquiryId
        return (
          <div
            key={inq.inquiryId}
            style={{
              ...boxStyle,
              marginBottom: 10,
              borderColor: isCurrent ? theme.colors.primary : theme.colors.border,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: theme.fontSize.xs, color: theme.colors.textMuted }}>
                {fmtDateTime(inq.inquiryAt)}
                {isCurrent && <span style={{ color: theme.colors.primary, marginLeft: 6 }}>(현재)</span>}
              </span>
              <span
                style={{
                  fontSize: theme.fontSize.xs,
                  fontWeight: 600,
                  color: answered ? theme.colors.success : theme.colors.warning,
                }}
              >
                {answered ? '답변완료' : '미답변'}
              </span>
            </div>
            <div style={{ fontSize: theme.fontSize.sm, color: theme.colors.textPrimary, whiteSpace: 'pre-wrap' }}>
              <LinkedText text={inq.content} />
            </div>
            {(inq.commentDtoList ?? []).map((c) => (
              <div
                key={c.inquiryCommentId}
                style={{
                  marginTop: 8,
                  padding: '8px 10px',
                  background: theme.colors.primaryLight,
                  borderRadius: theme.radius.sm,
                  fontSize: theme.fontSize.xs,
                  color: theme.colors.textPrimary,
                  whiteSpace: 'pre-wrap',
                }}
              >
                ↳ <LinkedText text={c.content} />
                <div style={{ color: theme.colors.textMuted, marginTop: 4 }}>{fmtDateTime(c.inquiryCommentAt)}</div>
              </div>
            ))}
          </div>
        )
      })}
    </>
  )
}

// ── 공통 스타일 ────────────────────────────────────────────────────
const sectionLabel: React.CSSProperties = {
  fontSize: theme.fontSize.xs,
  fontWeight: 600,
  color: theme.colors.textSecondary,
  marginBottom: 6,
}

const boxStyle: React.CSSProperties = {
  padding: '10px 12px',
  border: `1px solid ${theme.colors.border}`,
  borderRadius: theme.radius.sm,
  fontSize: theme.fontSize.sm,
  color: theme.colors.textPrimary,
  lineHeight: 1.6,
}

export default CustomerInquiryDrawer
