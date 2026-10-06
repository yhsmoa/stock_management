/* ================================================================
   고객문의 AI 답변 서비스 (inquiryAiService)
   - 고객문의 화면 [AI 답변] → 문의 + 주문 정보 + 같은 주문의 이전 문의를
     서버(/api/ai/inquiry-replies)로 보내 예상 답변 초안을 받는다.
   - 판단 규칙·그룹 키·출력 형식은 src/server/ai/customerInquiryGuide.md 가
     단일 기준이다. 여기의 INQUIRY_CATEGORY_LABELS 키는 그 문서 2장과 같아야 한다.
   - OpenAI 호출은 서버에서만 한다(키 노출 방지). 쿠팡 프록시처럼
     개발(coupangProxy.ts 쪽 플러그인)·운영(prodServer.js) 두 곳에 같은 엔드포인트가 있어야 한다.
   ================================================================ */

import type { OnlineInquiry, OrderDetail, OrderLineInfo } from './csService'

// ── 상수 ──────────────────────────────────────────────────────────
export const AI_REPLY_ENDPOINT = '/api/ai/inquiry-replies'

/** 가이드(customerInquiryGuide.md 2장)의 그룹 키 → 화면 표시명 */
export const INQUIRY_CATEGORY_LABELS: Record<string, string> = {
  CANCEL_REQUEST:     '주문 취소 요청',
  CANCEL_CONFIRM:     '취소 처리 확인',
  SELLER_CANCELLED:   '판매자 취소 문의',
  DELIVERY:           '배송 일정·지연',
  NOT_RECEIVED:       '미수령',
  RETURN_REQUEST:     '반품 요청',
  RETURN_DEFECT:      '불량·오배송 반품',
  RETURN_CONFIRM:     '반품 동의',
  EXCHANGE_REQUEST:   '교환 요청',
  RETURN_FEE_DISPUTE: '반품비 이의',
  RETURN_PICKUP:      '반품 회수',
  REFUND_STATUS:      '환불 문의',
  PRODUCT_INFO:       '상품 정보 문의',
  ORDER_OPTION:       '구매 전 옵션·재고',
  ADDRESS_CHANGE:     '배송지 변경',
  CONTACT_REQUEST:    '연락 요청',
  NO_ORDER_INFO:      '주문 정보 없음',
  COMPLAINT:          '항의',
  ACK:                '확인·감사 응답',
  OTHER:              '기타',
}

/** 확정 전 담당자가 직접 해야 하는 처리 (가이드 4장) */
export type InquiryRequiredAction = 'CANCEL_ORDER' | 'STOP_SHIPMENT' | 'RETURN_REQUEST'

export const REQUIRED_ACTION_LABELS: Record<InquiryRequiredAction, string> = {
  CANCEL_ORDER:   '주문 취소',
  STOP_SHIPMENT:  '출고 중지',
  RETURN_REQUEST: '반품 접수',
}

// ══════════════════════════════════════════════════════════════════
// 타입 — 요청 (서버가 프롬프트에 넣는 문의 맥락)
// ══════════════════════════════════════════════════════════════════

/** 같은 주문의 이전 문의 한 건 (답변 포함) */
export interface InquiryAiHistoryItem {
  inquiryAt: string
  content: string
  answers: string[]
}

/** 문의 한 건의 판단 재료 */
export interface InquiryAiContext {
  inquiryId: number
  inquiryAt: string
  content: string
  /** 등록상품명 · 옵션명 (주문 정보에서) — 없으면 null */
  product: { name: string; option: string } | null
  /** 주문 정보 (가이드 3장 상태표) — 없으면 null */
  order: {
    orderId: string
    status: string
    statusLabel: string
    orderedAt: string | null
    estimatedShippingDate: string | null
    hasInvoice: boolean
    shippingCount: number
  } | null
  /** 이 문의에 이미 달린 답변 (있으면 그 흐름을 잇는다) */
  previousAnswers: string[]
  /** 같은 주문의 다른 문의 (최신순) */
  history: InquiryAiHistoryItem[]
}

// ══════════════════════════════════════════════════════════════════
// 타입 — 응답 (가이드 4장 출력 형식)
// ══════════════════════════════════════════════════════════════════

export interface InquiryAiDraft {
  inquiryId: number
  category: string
  reply: string
  requiredAction: InquiryRequiredAction | null
  needsHuman: boolean
  note: string
}

/** 그룹 키 → 표시명 (모르는 키는 키 그대로) */
export function categoryLabel(key: string): string {
  return INQUIRY_CATEGORY_LABELS[key] ?? key
}

// ══════════════════════════════════════════════════════════════════
// 문의 → 판단 재료 조립
// ══════════════════════════════════════════════════════════════════

/** 주문 상세에서 해당 옵션 라인 (없으면 첫 라인) */
function pickLine(detail: OrderDetail | null | undefined, vendorItemId: string): OrderLineInfo | null {
  if (!detail) return null
  return detail.lines.find((l) => l.vendorItemId === vendorItemId) ?? detail.lines[0] ?? null
}

/**
 * 문의 한 건을 AI 요청 맥락으로 변환
 * @param inquiry      문의
 * @param detail       주문 상세 (undefined=미조회, null=없음)
 * @param answers      이 문의의 답변 목록 (기존 + 이번 세션 제출분)
 * @param sameOrder    같은 주문의 다른 문의 (이전문의 조회 결과)
 */
export function buildInquiryAiContext(
  inquiry: OnlineInquiry,
  detail: OrderDetail | null | undefined,
  answers: string[],
  sameOrder: OnlineInquiry[],
): InquiryAiContext {
  const orderId = String(inquiry.orderIds?.[0] ?? '')
  const line = pickLine(detail, String(inquiry.vendorItemId ?? ''))

  const history: InquiryAiHistoryItem[] = sameOrder
    .filter((i) => i.inquiryId !== inquiry.inquiryId)
    .sort((a, b) => (b.inquiryAt ?? '').localeCompare(a.inquiryAt ?? ''))
    .map((i) => ({
      inquiryAt: i.inquiryAt,
      content: i.content,
      answers: (i.commentDtoList ?? []).map((c) => c.content),
    }))

  return {
    inquiryId: inquiry.inquiryId,
    inquiryAt: inquiry.inquiryAt,
    content: inquiry.content,
    product: line ? { name: line.sellerProductName, option: line.optionName } : null,
    order: line && orderId
      ? {
          orderId,
          status: line.status,
          statusLabel: line.statusLabel,
          orderedAt: line.orderedAt,
          estimatedShippingDate: line.estimatedShippingDate,
          hasInvoice: Boolean(line.invoiceNumber),
          shippingCount: line.shippingCount,
        }
      : null,
    previousAnswers: answers,
    history,
  }
}

// ══════════════════════════════════════════════════════════════════
// 서버 호출
// ══════════════════════════════════════════════════════════════════

/** 서버 응답 한 건을 검증해 InquiryAiDraft 로 (형식이 깨진 건은 null) */
function normalizeDraft(raw: any): InquiryAiDraft | null {
  const inquiryId = Number(raw?.inquiryId)
  const reply = typeof raw?.reply === 'string' ? raw.reply.replace(/\r\n/g, '\n').trim() : ''
  if (!Number.isFinite(inquiryId) || !reply) return null
  const action = raw?.requiredAction
  const requiredAction: InquiryRequiredAction | null =
    action === 'CANCEL_ORDER' || action === 'STOP_SHIPMENT' || action === 'RETURN_REQUEST' ? action : null
  return {
    inquiryId,
    category: typeof raw?.category === 'string' && raw.category ? raw.category : 'OTHER',
    reply,
    requiredAction,
    needsHuman: Boolean(raw?.needsHuman),
    note: typeof raw?.note === 'string' ? raw.note.trim() : '',
  }
}

/**
 * 예상 답변 초안 생성
 * - 요청: { items: InquiryAiContext[] } → 응답: { success, data: InquiryAiDraft[] } | { success:false, error }
 * - 서버 엔드포인트가 아직 없으면(SPA 폴백 HTML·404) 그 사실을 분명한 메시지로 던진다.
 */
export async function generateInquiryReplyDrafts(items: InquiryAiContext[]): Promise<InquiryAiDraft[]> {
  if (items.length === 0) return []

  const res = await fetch(AI_REPLY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })
  const text = await res.text()

  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    // Vite/Express 가 index.html 을 돌려준 경우 = 엔드포인트 미구현
    throw new Error(`AI 답변 서버(${AI_REPLY_ENDPOINT})가 아직 연결되지 않았습니다. (status=${res.status})`)
  }
  if (res.status === 404 || !json?.success) {
    throw new Error(json?.error || `AI 답변 생성 실패 (status=${res.status})`)
  }

  const list: any[] = Array.isArray(json.data) ? json.data : []
  return list.map(normalizeDraft).filter((d): d is InquiryAiDraft => d !== null)
}
