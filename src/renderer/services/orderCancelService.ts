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
// 취소 사유 (WING '반품 접수' 모달 기준)
// ══════════════════════════════════════════════════════════════════

/** 귀책 구분 */
export type FaultType = 'VENDOR' | 'CUSTOMER'

export const FAULT_LABELS: Record<FaultType, string> = {
  VENDOR: '판매자사유',
  CUSTOMER: '고객사유',
}

/** 귀책별 사유 라벨 목록 (WING 화면과 동일 순서) */
export const CANCEL_REASONS: Record<FaultType, string[]> = {
  CUSTOMER: ['단순 변심', '잘못 주문', '배송일정 불만', '상품 불만', '가격 불만'],
  VENDOR: [
    '상품오출고', '상품 누락', '배송 지연', '택배사 미발송', '상품 파손',
    '상품 불량', '상품 품절', '잘못된 가격 기재', '잘못된 상품명 기재', '잘못된 상품정보 기재',
  ],
}

/**
 * 사유 라벨 → 쿠팡 취소 코드 (bigCancelCode / middleCancelCode)
 *
 * ⚠️ 실제 코드값 미확인 상태. 쿠팡 문서의 '취소 사유 코드 표' 또는
 *    WING에서 취소 접수 시 개발자도구(Network)로 전송되는 요청의
 *    bigCancelCode/middleCancelCode 를 확인해 아래를 채우면 전송이 활성화됩니다.
 *    (코드가 비어있는 사유는 CancelOrderDrawer에서 전송 버튼이 비활성화됨)
 */
export const CANCEL_REASON_CODES: Record<string, { big: string; middle: string }> = {
  // ── 고객사유 ──
  '단순 변심':       { big: '', middle: '' },
  '잘못 주문':       { big: '', middle: '' },
  '배송일정 불만':   { big: '', middle: '' },
  '상품 불만':       { big: '', middle: '' },
  '가격 불만':       { big: '', middle: '' },
  // ── 판매자사유 ──
  '상품오출고':          { big: '', middle: '' },
  '상품 누락':           { big: '', middle: '' },
  '배송 지연':           { big: '', middle: '' },
  '택배사 미발송':       { big: '', middle: '' },
  '상품 파손':           { big: '', middle: '' },
  '상품 불량':           { big: '', middle: '' },
  '상품 품절':           { big: '', middle: '' },
  '잘못된 가격 기재':    { big: '', middle: '' },
  '잘못된 상품명 기재':  { big: '', middle: '' },
  '잘못된 상품정보 기재':{ big: '', middle: '' },
}

/** 해당 사유의 코드가 채워져 있는지 (전송 가능 여부 판정용) */
export function hasReasonCode(reason: string): boolean {
  const c = CANCEL_REASON_CODES[reason]
  return !!c && !!c.big && !!c.middle
}

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
  reason: string           // 사유 라벨 (CANCEL_REASON_CODES 키)
  cancelReason: string     // 고객 안내용 직접 입력 사유 (텍스트)
  userId: string           // WING ID
}): Promise<CancelResult> {
  const { orderId, items, reason, cancelReason, userId } = params

  if (items.length === 0) throw new Error('취소할 상품을 선택하세요.')
  const codes = CANCEL_REASON_CODES[reason]
  if (!codes || !codes.big || !codes.middle) {
    throw new Error(`'${reason}' 사유 코드가 설정되지 않았습니다. (관리자 확인 필요)`)
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
      bigCancelCode: codes.big,
      middleCancelCode: codes.middle,
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
