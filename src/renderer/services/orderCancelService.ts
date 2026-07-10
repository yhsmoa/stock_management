/* ================================================================
   주문 취소 서비스 (주문 상품 취소 처리)
   - 엔드포인트: POST /v5/vendors/{vendorId}/orders/{orderId}/cancel (프록시)
   - body: vendorItemIds[] + receiptCounts[] (취소 대상 옵션/수량)
           + bigCancelCode/middleCancelCode(사유 코드) + userId(WING)
   - 재사용 컴포넌트 CancelOrderDrawer 에서 사용
   ================================================================ */

import type { AuthUser } from '../types/auth'

// ══════════════════════════════════════════════════════════════════
// 쿠팡 인증 헤더 (다른 서비스와 동일 패턴)
// ══════════════════════════════════════════════════════════════════

function getCoupangHeaders(): Record<string, string> {
  const raw = localStorage.getItem('user')
  if (!raw) throw new Error('로그인 정보가 없습니다. 다시 로그인해 주세요.')
  const user: AuthUser = JSON.parse(raw)
  if (!user.coupang_access_key || !user.coupang_secret_key || !user.vendor_id) {
    throw new Error('쿠팡 API 키가 설정되지 않았습니다. 관리자에게 문의하세요.')
  }
  return {
    'X-Coupang-Access-Key': user.coupang_access_key,
    'X-Coupang-Secret-Key': user.coupang_secret_key,
    'X-Vendor-Code': user.vendor_id,
  }
}

// ══════════════════════════════════════════════════════════════════
// 취소 사유 (CANCEL_ORDER_PROCESSING API — bigCancelCode / middleCancelCode)
//   - 판매자사유(VENDOR): 확인된 코드. big='CANERR', middle=CCTTER/CCPNER/CCPRER
//   - 고객사유(CUSTOMER): VOC reasonCode 기반 **추정값** (실테스트 검증 필요).
//       big='CANERR' 고정 가정 + middle=VOC reasonCode(CHANGEMIND 등).
//       쿠팡이 거부하면 취소가 안 될 뿐(잘못 취소되진 않음) → 응답 오류로 코드 보정.
// ══════════════════════════════════════════════════════════════════

/** 귀책 구분 */
export type FaultType = 'VENDOR' | 'CUSTOMER'

export const FAULT_LABELS: Record<FaultType, string> = {
  VENDOR: '판매자사유',
  CUSTOMER: '고객사유',
}

/** 취소 사유 옵션 — UI 라벨 + 전송 코드(big/middle) */
export interface CancelReasonOption {
  label: string   // UI 표시 라벨
  big: string     // bigCancelCode
  middle: string  // middleCancelCode
}

export const CANCEL_REASONS: Record<FaultType, CancelReasonOption[]> = {
  // ── 판매자사유 (확인된 코드) ──
  VENDOR: [
    { label: '재고 문제 (품절)',              big: 'CANERR', middle: 'CCTTER' },
    { label: '배송지 오류 (제휴사이트 주소)', big: 'CANERR', middle: 'CCPNER' },
    { label: '가격 오류 (양사 가격)',         big: 'CANERR', middle: 'CCPRER' },
  ],
  // ── 고객사유 (VOC reasonCode 기반 추정 — 실테스트로 검증) ──
  CUSTOMER: [
    { label: '단순 변심',     big: 'CANERR', middle: 'CHANGEMIND' },
    { label: '잘못 주문',     big: 'CANERR', middle: 'WRONGOPT' },
    { label: '배송일정 불만', big: 'CANERR', middle: 'DELIVERYLATER' },
    { label: '상품 불만',     big: 'CANERR', middle: 'DONTLIKESIZECOLOR' },
    { label: '가격 불만',     big: 'CANERR', middle: 'CHEAPER' },
  ],
}

/** 유효한 (big|middle) 조합 집합 (전송 전 검증용) */
const VALID_CODE_PAIRS = new Set(
  [...CANCEL_REASONS.VENDOR, ...CANCEL_REASONS.CUSTOMER].map((o) => `${o.big}|${o.middle}`),
)

// ══════════════════════════════════════════════════════════════════
// 취소 처리 호출
// ══════════════════════════════════════════════════════════════════

export interface CancelItem {
  vendorItemId: number
  cancelCount: number
}

export interface CancelResult {
  receiptType: string | null       // CANCEL / STOP_SHIPMENT
  failedVendorItemIds: number[]
}

/** 주문 상품 취소 처리 */
export async function cancelOrder(params: {
  orderId: number
  items: CancelItem[]
  bigCancelCode: string     // 취소 대분류 코드
  middleCancelCode: string  // 취소 소분류 코드
  cancelReason: string      // 고객 안내용 직접 입력 사유 (텍스트)
  userId: string            // WING ID
}): Promise<CancelResult> {
  const { orderId, items, bigCancelCode, middleCancelCode, cancelReason, userId } = params

  if (items.length === 0) throw new Error('취소할 상품을 선택하세요.')
  if (!bigCancelCode || !middleCancelCode || !VALID_CODE_PAIRS.has(`${bigCancelCode}|${middleCancelCode}`)) {
    throw new Error('취소 사유를 선택하세요.')
  }
  if (!userId.trim()) throw new Error('응답자(WING) ID를 입력하세요.')

  const vendorItemIds = items.map((i) => i.vendorItemId)
  const receiptCounts = items.map((i) => i.cancelCount)
  // 줄바꿈은 \n 만 (CR 제거)
  const reasonText = cancelReason.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()

  const res = await fetch('/api/coupang/order-cancel', {
    method: 'POST',
    headers: { ...getCoupangHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId,
      vendorItemIds,
      receiptCounts,
      bigCancelCode,
      middleCancelCode,
      cancelReason: reasonText,
      userId: userId.trim(),
    }),
  })
  const json = await res.json()

  if (!json.success) throw new Error(json.error || '취소 처리에 실패했습니다.')
  const code = json.data?.code != null ? String(json.data.code).toUpperCase() : ''
  if (code && code !== '200' && code !== 'OK' && code !== 'SUCCESS') {
    throw new Error(json.data?.message || '취소 처리에 실패했습니다.')
  }

  const data = json.data?.data ?? {}
  return {
    receiptType: data.receiptMap?.receiptType ?? null,
    failedVendorItemIds: Array.isArray(data.failedVendorItemIds) ? data.failedVendorItemIds : [],
  }
}
