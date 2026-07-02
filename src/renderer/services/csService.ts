/* ================================================================
   CS관리 (고객문의 / 쿠팡문의) 서비스
   - Vite/Express 프록시를 통한 쿠팡 CS API 호출
   - 상품별 고객문의(onlineInquiries): 조회기간 7일 제한 →
     30일 조회를 위해 7일 × 5회 분할 호출 후 inquiryId 기준 병합/정렬
   - 참고 가이드: coupang_api_md/coupang_cs.md
   ================================================================ */

import type { AuthUser } from '../types/auth'
import { STATUS_MAP } from './personalOrderService'

// ── 상수 ──────────────────────────────────────────────────────────
const INQUIRY_PAGE_SIZE = 50   // 쿠팡 onlineInquiries 최대 페이지 크기
const WINDOW_DAYS = 7          // 1회 조회 최대 기간 (쿠팡 제한)
const WINDOW_COUNT = 5         // 7일 × 5 = 최근 35일(≈30일) 커버
const MAX_RETRIES = 3          // 페이지 조회 실패 시 재시도 횟수
const RETRY_BASE_DELAY_MS = 500 // 지수 백오프 기본 지연 (0.5s → 1s → 2s)

// ══════════════════════════════════════════════════════════════════
// 타입 (참고: coupang_cs.md 3-4 추천 데이터 모델)
// ══════════════════════════════════════════════════════════════════

/** 상품별 고객문의 답변 이력 항목 */
export interface OnlineInquiryComment {
  inquiryCommentId: number
  inquiryId: number
  content: string
  inquiryCommentAt: string
}

/** 상품별 고객문의 (onlineInquiries content 항목) */
export interface OnlineInquiry {
  inquiryId: number
  productId: number
  sellerProductId: number
  sellerItemId: number
  vendorItemId: number
  content: string
  inquiryAt: string          // ISO-8601
  answered?: boolean
  orderIds: number[]
  buyerName?: string         // 응답에 있을 경우만 (없으면 마스킹 표기)
  commentDtoList: OnlineInquiryComment[]
}

/** 답변 상태 필터 — 미답변 / 답변완료 / 전체(이전문의 조회용) */
export type AnsweredType = 'NOANSWER' | 'ANSWERED' | 'ALL'

// ══════════════════════════════════════════════════════════════════
// 쿠팡 인증 (purchaseService.ts / personalOrderService.ts와 동일 패턴)
// ══════════════════════════════════════════════════════════════════

function getCoupangCredentials() {
  const raw = localStorage.getItem('user')
  if (!raw) throw new Error('로그인 정보가 없습니다. 다시 로그인해 주세요.')

  const user: AuthUser = JSON.parse(raw)
  if (!user.coupang_access_key || !user.coupang_secret_key || !user.vendor_id) {
    throw new Error('쿠팡 API 키가 설정되지 않았습니다. 관리자에게 문의하세요.')
  }

  return {
    accessKey: user.coupang_access_key,
    secretKey: user.coupang_secret_key,
    vendorCode: user.vendor_id,
  }
}

function getCoupangHeaders(): Record<string, string> {
  const { accessKey, secretKey, vendorCode } = getCoupangCredentials()
  return {
    'X-Coupang-Access-Key': accessKey,
    'X-Coupang-Secret-Key': secretKey,
    'X-Vendor-Code': vendorCode,
  }
}

// ══════════════════════════════════════════════════════════════════
// 날짜 유틸
// ══════════════════════════════════════════════════════════════════

/**
 * N일 전 날짜를 yyyy-MM-dd(KST) 형식으로 반환 (0 = 오늘)
 * - 쿠팡 문의 일시는 KST 기준. 브라우저 타임존/UTC 변환으로 인해
 *   KST 새벽(00~09시)에 '오늘'이 하루 밀리는 문제를 방지하기 위해
 *   UTC+9 로 보정한 뒤 날짜를 계산한다.
 */
function daysAgo(n: number): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  kst.setUTCDate(kst.getUTCDate() - n)
  return kst.toISOString().slice(0, 10)
}

/** 최근 30일을 7일 단위 5구간으로 분할 (양끝 포함) */
function buildInquiryRanges(): Array<{ start: string; end: string }> {
  const ranges: Array<{ start: string; end: string }> = []
  for (let i = 0; i < WINDOW_COUNT; i++) {
    const end = daysAgo(i * WINDOW_DAYS)
    const start = daysAgo(i * WINDOW_DAYS + (WINDOW_DAYS - 1)) // 7일 구간 (diff 6일 ≤ 7)
    ranges.push({ start, end })
  }
  return ranges
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ══════════════════════════════════════════════════════════════════
// 상품별 고객문의 조회
// ══════════════════════════════════════════════════════════════════

/**
 * 단일 페이지 조회 (재시도 포함)
 * @returns { content, totalPages }
 */
async function fetchInquiryPage(
  answeredType: AnsweredType,
  start: string,
  end: string,
  pageNum: number,
  headers: Record<string, string>,
): Promise<{ content: OnlineInquiry[]; totalPages: number }> {
  const params = new URLSearchParams({
    answeredType,
    inquiryStartAt: start,
    inquiryEndAt: end,
    pageNum: String(pageNum),
    pageSize: String(INQUIRY_PAGE_SIZE),
  })

  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`/api/coupang/online-inquiries?${params.toString()}`, { headers })
      const text = await res.text()
      if (!text) throw new Error(`프록시 응답 비어있음 (status=${res.status})`)

      const json = JSON.parse(text)
      if (!json.success) {
        throw new Error(json.error || `고객문의 조회 실패 (status=${res.status})`)
      }

      // 프록시 → { success, data: <쿠팡응답> }
      // 쿠팡응답 → { code, message, data: { content, pagination } }
      const body = json.data?.data ?? {}
      const content: OnlineInquiry[] = Array.isArray(body.content) ? body.content : []
      const totalPages: number = body.pagination?.totalPages ?? 1
      return { content, totalPages }
    } catch (err: any) {
      lastErr = err
      if (attempt < MAX_RETRIES) {
        const wait = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
        console.warn(
          `[online-inquiries 재시도] ${attempt + 1}/${MAX_RETRIES} — ${err.message} (${wait}ms 대기)`,
        )
        await delay(wait)
      }
    }
  }
  throw lastErr ?? new Error('고객문의 조회 실패 (알 수 없는 오류)')
}

/** 한 구간(7일)의 전체 페이지 순회 조회 */
async function fetchInquiryRange(
  answeredType: AnsweredType,
  start: string,
  end: string,
  headers: Record<string, string>,
): Promise<OnlineInquiry[]> {
  const all: OnlineInquiry[] = []
  let page = 1
  while (true) {
    const { content, totalPages } = await fetchInquiryPage(answeredType, start, end, page, headers)
    all.push(...content)
    if (page >= totalPages) break
    page++
  }
  return all
}

/**
 * 최근 30일 상품별 고객문의 조회 (7일 × 5회 분할 → 병합)
 * - inquiryId 기준 중복 제거
 * - inquiryAt 내림차순 정렬 (최신순)
 * @param answeredType 'NOANSWER'(미답변) | 'ANSWERED'(답변완료)
 * @param onProgress 진행 콜백 (완료 구간 수 / 전체 구간 수)
 */
export async function fetchOnlineInquiries30d(
  answeredType: AnsweredType,
  onProgress?: (done: number, total: number) => void,
): Promise<OnlineInquiry[]> {
  const headers = getCoupangHeaders()
  const ranges = buildInquiryRanges()

  const merged: OnlineInquiry[] = []
  let done = 0
  // 구간은 순차 실행 (쿠팡 rate limit 보호)
  for (const r of ranges) {
    const rows = await fetchInquiryRange(answeredType, r.start, r.end, headers)
    merged.push(...rows)
    done++
    onProgress?.(done, ranges.length)
  }

  // ── inquiryId 기준 dedup ──────────────────────────────────────
  const uniqueById = new Map<number, OnlineInquiry>()
  for (const inq of merged) {
    if (!uniqueById.has(inq.inquiryId)) uniqueById.set(inq.inquiryId, inq)
  }

  // ── inquiryAt 내림차순 정렬 ───────────────────────────────────
  return Array.from(uniqueById.values()).sort((a, b) =>
    (b.inquiryAt ?? '').localeCompare(a.inquiryAt ?? ''),
  )
}

// ══════════════════════════════════════════════════════════════════
// 주문 상세 조회 (발주서 단건 by orderId)
//   - 고객문의 행에 주문자명/상품/수량/금액/출고예정일/운송장/배송상태 표시용
//   - 엔드포인트: /v4/vendors/{vendorId}/{orderId}/ordersheets (프록시)
//   - 응답 data[] = shipmentBox 목록. box.orderItems 를 옵션(vendorItemId) 단위로 평탄화.
// ══════════════════════════════════════════════════════════════════

const DETAIL_CONCURRENCY = 5 // 주문 상세 동시 조회 수 (쿠팡 초당 제한 보호)

/** 주문 상세의 옵션(라인) 단위 정보 — box(주문)-level 필드도 함께 보관 */
export interface OrderLineInfo {
  vendorItemId: string
  sellerProductName: string       // 등록상품명
  optionName: string              // 옵션명 (sellerProductItemName)
  shippingCount: number           // 수량
  amount: number                  // 금액 (orderPrice 우선)
  orderedAt: string | null        // 주문일시
  estimatedShippingDate: string | null // 출고예정일
  receiverName: string            // 수취인명
  status: string                  // 배송상태 코드 (ACCEPT/INSTRUCT/...)
  statusLabel: string             // 배송상태 한글 (STATUS_MAP)
  invoiceNumber: string           // 운송장번호
}

/** 주문번호별 상세 (라인 목록) */
export interface OrderDetail {
  orderId: string
  lines: OrderLineInfo[]
}

/**
 * 가격 정규화 — 쿠팡 응답이 숫자(16900) 또는 { units: 16900 } 두 형태로 옴
 * - 발주서 단건(v4): 숫자 / 발주서 목록(v5): { units } 객체
 */
function priceUnits(v: any): number {
  if (v == null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'object' && typeof v.units === 'number') return v.units
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 동시 실행 제한 러너 (personalOrderService 패턴) */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let cursor = 0
  async function worker() {
    while (true) {
      const idx = cursor++
      if (idx >= tasks.length) return
      results[idx] = await tasks[idx]()
    }
  }
  const workerCount = Math.min(limit, tasks.length)
  await Promise.all(Array.from({ length: workerCount }, worker))
  return results
}

/**
 * 주문번호 단건 상세 조회 → 옵션 라인 목록으로 평탄화
 * - 실패/빈 응답 시 null 반환 (행 렌더는 계속 진행)
 */
export async function fetchOrderDetail(orderId: string): Promise<OrderDetail | null> {
  if (!orderId) return null
  const headers = getCoupangHeaders()

  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(
        `/api/coupang/ordersheet-by-order?orderId=${encodeURIComponent(orderId)}`,
        { headers },
      )
      const text = await res.text()
      if (!text) throw new Error(`프록시 응답 비어있음 (status=${res.status})`)

      const json = JSON.parse(text)
      if (!json.success) {
        throw new Error(json.error || `주문 상세 조회 실패 (status=${res.status})`)
      }

      // 프록시 → { success, data: <쿠팡응답> }, 쿠팡응답 → { code, message, data: [box,...] }
      const boxes: any[] = Array.isArray(json.data?.data) ? json.data.data : []
      const lines: OrderLineInfo[] = []
      for (const box of boxes) {
        const receiverName: string = box?.receiver?.name ?? ''
        const status: string = box?.status ?? ''
        const invoiceNumber: string = box?.invoiceNumber ?? ''
        const orderedAt: string | null = box?.orderedAt || null
        const orderItems: any[] = Array.isArray(box?.orderItems) ? box.orderItems : []
        for (const item of orderItems) {
          lines.push({
            vendorItemId: String(item?.vendorItemId ?? ''),
            sellerProductName: item?.sellerProductName ?? '',
            optionName: item?.sellerProductItemName ?? '',
            shippingCount: item?.shippingCount ?? 0,
            amount: priceUnits(item?.orderPrice) || priceUnits(item?.salesPrice),
            orderedAt,
            estimatedShippingDate: item?.estimatedShippingDate || null,
            receiverName,
            status,
            statusLabel: STATUS_MAP[status] ?? status,
            invoiceNumber,
          })
        }
      }
      return { orderId, lines }
    } catch (err: any) {
      lastErr = err
      if (attempt < MAX_RETRIES) {
        const wait = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
        console.warn(
          `[ordersheet-by-order 재시도] ${orderId} ${attempt + 1}/${MAX_RETRIES} — ${err.message} (${wait}ms)`,
        )
        await delay(wait)
      }
    }
  }
  console.error(`[fetchOrderDetail] ${orderId} 조회 실패:`, lastErr?.message)
  return null
}

/**
 * 여러 주문번호를 동시 조회 (중복 제거 + 동시성 제한)
 * @returns Map<orderId, OrderDetail | null>
 */
export async function fetchOrderDetailsMap(
  orderIds: string[],
): Promise<Map<string, OrderDetail | null>> {
  const uniqueIds = Array.from(new Set(orderIds.filter(Boolean)))
  const map = new Map<string, OrderDetail | null>()
  if (uniqueIds.length === 0) return map

  const tasks = uniqueIds.map((id) => async () => {
    const detail = await fetchOrderDetail(id)
    map.set(id, detail)
  })
  await runWithConcurrency(tasks, DETAIL_CONCURRENCY)
  return map
}

// ══════════════════════════════════════════════════════════════════
// 고객문의 답변 전송 (POST replies)
//   - 엔드포인트: /v4/vendors/{vendorId}/onlineInquiries/{inquiryId}/replies
//   - content 줄바꿈은 \n 만 허용 (CR 제거). 응답 { code:"200", message:"OK" }
// ══════════════════════════════════════════════════════════════════

/** 상품별 고객문의 답변 전송 */
export async function submitOnlineInquiryReply(
  inquiryId: number,
  content: string,
  replyBy: string,
): Promise<void> {
  const safeContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!safeContent) throw new Error('답변 내용을 입력하세요.')
  if (!replyBy.trim()) throw new Error('응답자(WING) ID를 입력하세요.')

  const res = await fetch('/api/coupang/online-inquiry-reply', {
    method: 'POST',
    headers: { ...getCoupangHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ inquiryId, content: safeContent, replyBy: replyBy.trim() }),
  })
  const json = await res.json()

  if (!json.success) throw new Error(json.error || '답변 전송에 실패했습니다.')

  // 쿠팡 응답 code 검증 (200 / OK / SUCCESS 외에는 실패)
  const code = json.data?.code != null ? String(json.data.code).toUpperCase() : ''
  if (code && code !== '200' && code !== 'OK' && code !== 'SUCCESS') {
    throw new Error(json.data?.message || '답변 전송에 실패했습니다.')
  }
}
