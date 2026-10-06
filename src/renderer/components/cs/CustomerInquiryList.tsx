/* ================================================================
   고객문의 카드 목록 (CustomerInquiryList) — 디자인 v2
   - CustomerInquiry 페이지의 표시 부분 — 상태·조회는 페이지가 갖고 여기는 그린다
   - 문의 1건 = 카드 1장: 왼쪽 168px 레일(날짜 · 주문 · 고객 · 보조 작업) | 본문(상품줄 · 질문 17px · 답변 · AI 초안)
   - 전역 액션(AI 답변 생성 · 초안 모두 지우기)은 페이지 헤더에 있다 — 여기는 행 단위 작업만
   - 스타일: pages/CustomerInquiry.css (.ci-*)
   ================================================================ */

import React from 'react'
import type { OnlineInquiry, OrderDetail, OrderLineInfo } from '../../services/csService'
import type { FulfillmentStatus } from '../../services/orderFulfillmentService'
import LinkedText from '../common/LinkedText'
import { StatusDot, pickLine } from './OrderInfoLine'
import InquiryAiDraftBox from './InquiryAiDraftBox'
import type { Answer } from './CustomerInquiryDrawer'
import type { InquiryAiDrafts } from './useInquiryAiDrafts'

// ── Props ──────────────────────────────────────────────────────────
export interface CustomerInquiryListProps {
  rows: OnlineInquiry[]                 // 현재 페이지 행
  loading: boolean
  progress: string
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  /** 주문번호 → 주문 상세 (undefined=조회중, null=없음) */
  getDetail: (orderId: string) => OrderDetail | null | undefined
  statusMap: Map<number, FulfillmentStatus>
  /** fulfillment 이력 드로어를 열 수 있는 행인지 */
  canOpenFulfillment: (inquiryId: number) => boolean
  answersFor: (inquiry: OnlineInquiry) => Answer[]
  /** AI 초안 — 미답변 탭에서만 켠다 */
  ai: InquiryAiDrafts
  aiEnabled: boolean
  showReasoning: boolean
  onReply: (inquiry: OnlineInquiry) => void
  onHistory: (inquiry: OnlineInquiry) => void
  onCancel: (orderId: string) => void
  onFulfillment: (inquiryId: number) => void
}

// ══════════════════════════════════════════════════════════════════
// 표시 유틸
// ══════════════════════════════════════════════════════════════════

/** ISO-8601 → { date: 'yyyy.MM.dd', time: 'HH:mm' } */
function splitInquiryAt(iso: string): { date: string; time: string } {
  if (!iso) return { date: '-', time: '' }
  const [d, t] = iso.split('T')
  return { date: (d ?? '').replace(/-/g, '.'), time: (t ?? '').slice(0, 5) }
}

/** yyyy-MM-dd(THH:mm) → MM.dd */
function shortDate(s: string | null): string {
  if (!s) return '-'
  return s.slice(5, 10).replace(/-/g, '.')
}

function fmtDateTime(iso: string): string {
  if (!iso) return ''
  return iso.replace('T', ' ').slice(0, 16).replace(/-/g, '.')
}

// ══════════════════════════════════════════════════════════════════
// 카드 조각
// ══════════════════════════════════════════════════════════════════

/** 왼쪽 레일 — 날짜 · 주문 · 고객 · 보조 작업 */
const Rail: React.FC<{
  inquiry: OnlineInquiry
  orderId: string
  line: OrderLineInfo | null
  detail: OrderDetail | null | undefined
  aiEnabled: boolean
  canAi: boolean
  hasDraft: boolean
  onReply: () => void
  onHistory: () => void
  onCancel: () => void
  onAi: () => void
}> = ({ inquiry, orderId, line, detail, aiEnabled, canAi, hasDraft, onReply, onHistory, onCancel, onAi }) => {
  const { date, time } = splitInquiryAt(inquiry.inquiryAt)
  const orderCount = inquiry.orderIds?.length ?? 0
  return (
    <div className="ci-rail">
      <div className="ci-rail-date"><b>{date}</b> {time}</div>
      <div className="ci-rail-id">#{inquiry.inquiryId}</div>

      <div className="ci-rail-sep" />

      {!orderId ? (
        <div className="ci-rail-muted">주문번호 없음</div>
      ) : detail === undefined ? (
        <div className="ci-rail-muted">주문정보 불러오는 중…</div>
      ) : (
        <>
          {line?.receiverName && <div className="ci-rail-name">{line.receiverName}</div>}
          <div>
            <span className="ci-rail-link">{orderId}</span>
            {orderCount > 1 && <span> 외 {orderCount - 1}건</span>}
          </div>
          {line ? (
            <>
              <div>{line.shippingCount}개 · {line.amount.toLocaleString()}원</div>
              <div className="ci-rail-muted">
                주문 {shortDate(line.orderedAt)} · 도착예정 {shortDate(line.estimatedShippingDate)}
              </div>
              {line.invoiceNumber && <div className="ci-rail-muted">송장 {line.invoiceNumber}</div>}
            </>
          ) : (
            <div className="ci-rail-muted">주문정보 없음</div>
          )}
        </>
      )}

      <div className="ci-rail-sep" />

      <div className="ci-rail-actions">
        <button type="button" className="ci-rail-action" onClick={onHistory}>이전 문의 보기</button>
        <button type="button" className="ci-rail-action" onClick={onReply}>직접 답변</button>
        {aiEnabled && !hasDraft && canAi && (
          <button type="button" className="ci-rail-action" onClick={onAi}>AI 초안</button>
        )}
        <button type="button" className="ci-rail-action danger" onClick={onCancel} disabled={!orderId}>문의 취소</button>
      </div>
    </div>
  )
}

/** 본문 윗줄 — 상품명 · 옵션 · 배송상태(테두리 칩) · fulfillment 상태 */
const ProductLine: React.FC<{
  orderId: string
  line: OrderLineInfo | null
  fallbackName: string
  status?: FulfillmentStatus
  onStatusClick?: () => void
}> = ({ orderId, line, fallbackName, status, onStatusClick }) => (
  <div className="ci-product">
    {line ? (
      <>
        <span>
          {line.sellerProductName || fallbackName}
          {line.optionName && ` · ${line.optionName}`}
        </span>
        {line.statusLabel && <span className="ci-chip">{line.statusLabel}</span>}
      </>
    ) : (
      <span className="ci-product-muted">{orderId ? fallbackName : `주문 없음 · ${fallbackName}`}</span>
    )}
    {status && status !== 'none' && (
      onStatusClick ? (
        <span className="ci-status-link" onClick={onStatusClick} title="fulfillment 이력 보기">
          <StatusDot status={status} />
        </span>
      ) : (
        <StatusDot status={status} />
      )
    )}
  </div>
)

// ══════════════════════════════════════════════════════════════════
// 컴포넌트
// ══════════════════════════════════════════════════════════════════

const CustomerInquiryList: React.FC<CustomerInquiryListProps> = ({
  rows, loading, progress, page, totalPages, onPageChange,
  getDetail, statusMap, canOpenFulfillment, answersFor,
  ai, aiEnabled, showReasoning, onReply, onHistory, onCancel, onFulfillment,
}) => {
  const aiBusy = ai.generating.size > 0

  if (loading) return <div className="ci-empty">{progress || '데이터를 조회하는 중…'}</div>
  if (rows.length === 0) return <div className="ci-empty">조회된 문의가 없습니다.</div>

  return (
    <>
      <div className="ci-list">
        {rows.map((r) => {
          const orderId = String(r.orderIds?.[0] ?? '')
          const detail = orderId ? getDetail(orderId) : null
          const line = detail ? pickLine(detail, String(r.vendorItemId ?? '')) : null
          const answers = answersFor(r)
          const draft = ai.drafts.get(r.inquiryId)
          const rowGenerating = ai.generating.has(r.inquiryId)
          const canAi = aiEnabled && !aiBusy && answers.length === 0

          return (
            <article key={r.inquiryId} className="ci-card">
              <Rail
                inquiry={r}
                orderId={orderId}
                line={line}
                detail={detail}
                aiEnabled={aiEnabled}
                canAi={canAi}
                hasDraft={Boolean(draft)}
                onReply={() => onReply(r)}
                onHistory={() => onHistory(r)}
                onCancel={() => orderId && onCancel(orderId)}
                onAi={() => ai.generateFor([r])}
              />

              <div className="ci-body">
                <ProductLine
                  orderId={orderId}
                  line={line}
                  fallbackName={`상품 ${r.productId}`}
                  status={statusMap.get(r.inquiryId)}
                  onStatusClick={canOpenFulfillment(r.inquiryId) ? () => onFulfillment(r.inquiryId) : undefined}
                />
                <div className="ci-question"><LinkedText text={r.content} /></div>
                {answers.map((a, i) => (
                  <div key={i} className="ci-answer">
                    <LinkedText text={a.content} />
                    <div className="ci-answer-at">{fmtDateTime(a.at)}</div>
                  </div>
                ))}
                {rowGenerating && <div className="ci-generating">AI 초안 생성 중…</div>}
                {draft && !rowGenerating && (
                  <InquiryAiDraftBox
                    state={draft}
                    showReasoning={showReasoning}
                    canRegenerate={canAi}
                    onChange={(t) => ai.setText(r.inquiryId, t)}
                    onConfirm={() => ai.confirm(r)}
                    onDiscard={() => ai.discard(r.inquiryId)}
                    onRegenerate={() => ai.generateFor([r])}
                  />
                )}
              </div>
            </article>
          )
        })}
      </div>

      {/* ── 페이지네이션 ─────────────────────────────────────────── */}
      <div className="ci-pagination">
        <button type="button" className="ci-page-btn" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          이전
        </button>
        <span className="ci-page-num">{page} / {totalPages}</span>
        <button type="button" className="ci-page-btn" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
          다음
        </button>
      </div>
    </>
  )
}

export default CustomerInquiryList
