/* ================================================================
   CS 공용 — 주문정보 라인 (문의내용 위 표시)
   - 고객문의(CustomerInquiry) · 쿠팡문의(CoupangInquiry) 공유.
   - 주문번호로 조회한 주문 상세(OrderDetail)의 해당 옵션 라인을
     "등록상품명 · 옵션명 · 수취인 · 수량 · 금액 · 송장 · 배송상태
      (+ fulfillment 상태점)" 한 줄로 표시한다.
   ================================================================ */

import React from 'react'
import { theme } from '../../styles/theme'
import type { OrderDetail, OrderLineInfo } from '../../services/csService'
import type { FulfillmentStatus } from '../../services/orderFulfillmentService'
import { STATUS_DOT_LABELS } from '../../pages/usePersonalOrder'

// ── fulfillment 상태 색 (PersonalOrder.css .po-status-dot 과 동일) ──
export const STATUS_DOT_COLORS: Record<FulfillmentStatus, string> = {
  shipped: '#22C55E', // 출고완료
  green:   '#FB923C', // 포장완료(주황)
  red:     '#EF4444', // 전량취소
  gray:    '#D1D5DB', // 미발송
  multi:   '#A855F7', // 이력 확인 필요
  cart:    '',        // 카트 → 🛒
  none:    '',        // 미주문 → 미표시
}

/** 주문 상세의 해당 옵션(vendorItemId) 라인을 선택 (없으면 첫 라인) */
export function pickLine(detail: OrderDetail, vendorItemId: string): OrderLineInfo | null {
  return detail.lines.find((l) => l.vendorItemId === vendorItemId) ?? detail.lines[0] ?? null
}

// ── fulfillment 상태 점 + 상태명 (개인주문 '상태' 열과 동일) ──
const StatusDot: React.FC<{ status: FulfillmentStatus }> = ({ status }) => {
  if (status === 'none') return null
  const label = STATUS_DOT_LABELS[status]
  if (status === 'cart') {
    return <span style={{ whiteSpace: 'nowrap' }}>🛒 {label}</span>
  }
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: STATUS_DOT_COLORS[status],
          marginRight: 4,
          verticalAlign: 'middle',
        }}
      />
      {label}
    </span>
  )
}

// ══════════════════════════════════════════════════════════════════
// 주문정보 라인
// ══════════════════════════════════════════════════════════════════

export interface OrderInfoLineProps {
  orderId: string
  vendorItemId: string
  /** undefined = 로딩중, null = 주문없음/실패, OrderDetail = 조회완료 */
  detail: OrderDetail | null | undefined
  /** 주문/라인 없을 때 폴백 표기 (예: '상품 12345' 또는 문의 itemName) */
  fallbackName: string
  status?: FulfillmentStatus
  /** 상태 클릭 → fulfillment 이력 드로어 (있으면 밑줄+커서) */
  onStatusClick?: () => void
}

const OrderInfoLine: React.FC<OrderInfoLineProps> = ({
  orderId,
  vendorItemId,
  detail,
  fallbackName,
  status,
  onStatusClick,
}) => {
  // 주문번호 없음 → 폴백 표기
  if (!orderId) {
    return <div style={{ color: theme.colors.primary, marginBottom: 2 }}>{fallbackName}</div>
  }
  // 로딩중
  if (detail === undefined) {
    return <div style={{ color: theme.colors.textMuted, marginBottom: 2 }}>주문정보 불러오는 중...</div>
  }
  // 조회 실패 / 주문 없음
  if (detail === null) {
    return <div style={{ color: theme.colors.textMuted, marginBottom: 2 }}>주문정보 없음 ({fallbackName})</div>
  }

  const line = pickLine(detail, vendorItemId)
  if (!line) {
    return <div style={{ color: theme.colors.textMuted, marginBottom: 2 }}>주문정보 없음 ({fallbackName})</div>
  }

  return (
    <div
      style={{
        marginBottom: 6,
        paddingBottom: 6,
        borderBottom: `1px dashed ${theme.colors.border}`,
        fontSize: theme.fontSize.xs,
        lineHeight: 1.7,
      }}
    >
      {/* 상품명 + 옵션명 (동일 색) + 수취인 ~ 배송상태: 전부 한 줄 */}
      <span style={{ color: theme.colors.primary, fontWeight: 600 }}>
        {line.sellerProductName || fallbackName}
        {line.optionName && ` · ${line.optionName}`}
      </span>
      <span style={{ color: theme.colors.textSecondary }}>
        {' · '}{line.receiverName || '-'}
        {' · '}{line.shippingCount}개
        {' · '}{line.amount.toLocaleString()}원
        {' · 송장 '}{line.invoiceNumber || '-'}
        {' · 배송상태 '}{line.statusLabel || '-'}
        {status && status !== 'none' && (
          <>
            {' · '}
            {onStatusClick ? (
              <span
                onClick={onStatusClick}
                title="fulfillment 이력 보기"
                style={{ cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}
              >
                <StatusDot status={status} />
              </span>
            ) : (
              <StatusDot status={status} />
            )}
          </>
        )}
      </span>
    </div>
  )
}

export default OrderInfoLine
