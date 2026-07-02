/* ================================================================
   쿠팡문의 (쿠팡 고객센터 문의) 서비스 — callCenterInquiries
   - 리스트 조회는 7일 기간제한 → 30일을 7일×5회 분할 후 병합
   - 단건 조회로 parentAnswerId 확보 → 답변(POST replies)
   - TRANSFER(미확인) 건은 확인(POST confirms)
   - 참고: coupang_api_md/coupang_cs.md (2장)
   ================================================================ */

import type { AuthUser } from '../types/auth'

// ── 상수 ──────────────────────────────────────────────────────────
const PAGE_SIZE = 30      // callCenterInquiries 최대 페이지 크기
const WINDOW_DAYS = 7
const WINDOW_COUNT = 5    // 7일 × 5 ≈ 최근 35일
const MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 500

// ══════════════════════════════════════════════════════════════════
// 타입
// ══════════════════════════════════════════════════════════════════

/** 문의 상태 필터 */
export type CcStatus = 'NONE' | 'ANSWER' | 'NO_ANSWER' | 'TRANSFER'

/** 답변 타임라인 항목 */
export interface CcReply {
  answerId: number
  parentAnswerId: number | string | null
  partnerTransferStatus: string | null // none / requestAnswer / answered
  answerType: string                    // csAgent / vendor
  needAnswer?: boolean
  receptionistName?: string
  replyAt: string
  content: string
}

/** 쿠팡 고객센터 문의 */
export interface CallCenterInquiry {
  inquiryId: number
  inquiryStatus: string                 // progress / complete
  csPartnerCounselingStatus?: string    // requestAnswer / answered
  vendorItemId?: number | number[]
  itemName?: string
  content: string
  replies: CcReply[]
  inquiryAt: string
  buyerPhone?: string
  orderId?: number
  orderDate?: string
  receiptCategory?: string
}

// ══════════════════════════════════════════════════════════════════
// 쿠팡 인증 헤더
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

// ── 날짜 유틸 (KST 기준) ──────────────────────────────────────────
// 쿠팡 문의 일시는 KST. UTC 변환으로 KST 새벽에 '오늘'이 하루 밀리는
// 문제를 막기 위해 UTC+9 보정 후 날짜 계산.
function daysAgo(n: number): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  kst.setUTCDate(kst.getUTCDate() - n)
  return kst.toISOString().slice(0, 10)
}

function buildRanges(): Array<{ start: string; end: string }> {
  const ranges: Array<{ start: string; end: string }> = []
  for (let i = 0; i < WINDOW_COUNT; i++) {
    ranges.push({ start: daysAgo(i * WINDOW_DAYS + (WINDOW_DAYS - 1)), end: daysAgo(i * WINDOW_DAYS) })
  }
  return ranges
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ══════════════════════════════════════════════════════════════════
// 리스트 조회 (30일 = 7일×5 병합)
// ══════════════════════════════════════════════════════════════════

async function fetchPage(
  status: CcStatus,
  start: string,
  end: string,
  pageNum: number,
  headers: Record<string, string>,
): Promise<{ content: CallCenterInquiry[]; totalPages: number }> {
  const params = new URLSearchParams({
    partnerCounselingStatus: status,
    inquiryStartAt: start,
    inquiryEndAt: end,
    pageNum: String(pageNum),
    pageSize: String(PAGE_SIZE),
  })

  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`/api/coupang/cc-inquiries?${params.toString()}`, { headers })
      const text = await res.text()
      if (!text) throw new Error(`프록시 응답 비어있음 (status=${res.status})`)
      const json = JSON.parse(text)
      if (!json.success) throw new Error(json.error || `쿠팡문의 조회 실패 (status=${res.status})`)

      const body = json.data?.data ?? {}
      const content: CallCenterInquiry[] = Array.isArray(body.content)
        ? body.content
        : Array.isArray(body) ? body : []
      const totalPages: number = body.pagination?.totalPages ?? 1
      return { content, totalPages }
    } catch (err: any) {
      lastErr = err
      if (attempt < MAX_RETRIES) {
        const wait = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
        console.warn(`[cc-inquiries 재시도] ${attempt + 1}/${MAX_RETRIES} — ${err.message} (${wait}ms)`)
        await delay(wait)
      }
    }
  }
  throw lastErr ?? new Error('쿠팡문의 조회 실패 (알 수 없는 오류)')
}

async function fetchRange(
  status: CcStatus,
  start: string,
  end: string,
  headers: Record<string, string>,
): Promise<CallCenterInquiry[]> {
  const all: CallCenterInquiry[] = []
  let page = 1
  while (true) {
    const { content, totalPages } = await fetchPage(status, start, end, page, headers)
    all.push(...content)
    if (page >= totalPages) break
    page++
  }
  return all
}

/** 최근 30일 쿠팡 고객센터 문의 조회 (7일×5 병합, inquiryId dedup, 최신순) */
export async function fetchCallCenterInquiries30d(
  status: CcStatus,
  onProgress?: (done: number, total: number) => void,
): Promise<CallCenterInquiry[]> {
  const headers = getCoupangHeaders()
  const ranges = buildRanges()
  const merged: CallCenterInquiry[] = []
  let done = 0
  for (const r of ranges) {
    merged.push(...(await fetchRange(status, r.start, r.end, headers)))
    done++
    onProgress?.(done, ranges.length)
  }
  const uniq = new Map<number, CallCenterInquiry>()
  for (const inq of merged) if (!uniq.has(inq.inquiryId)) uniq.set(inq.inquiryId, inq)
  return Array.from(uniq.values()).sort((a, b) => (b.inquiryAt ?? '').localeCompare(a.inquiryAt ?? ''))
}

// ══════════════════════════════════════════════════════════════════
// 단건 조회 (parentAnswerId 확보)
// ══════════════════════════════════════════════════════════════════

/** 단건 조회 — 과도한 호출 방지 위해 클릭당 1회 권장 */
export async function fetchCallCenterInquiryDetail(inquiryId: number): Promise<CallCenterInquiry | null> {
  const headers = getCoupangHeaders()
  const res = await fetch(`/api/coupang/cc-inquiry-detail?inquiryId=${encodeURIComponent(String(inquiryId))}`, { headers })
  const text = await res.text()
  if (!text) return null
  const json = JSON.parse(text)
  if (!json.success) throw new Error(json.error || '문의 단건 조회 실패')
  return (json.data?.data ?? null) as CallCenterInquiry | null
}

/**
 * 답변 대상 parentAnswerId 추출
 * - requestAnswer 상태(답변 필요) 답변의 answerId 우선
 * - 없으면 마지막 csAgent 답변, 그래도 없으면 첫 답변
 */
export function extractParentAnswerId(inq: CallCenterInquiry): number | string | null {
  const replies = inq.replies ?? []
  const req = replies.find((r) => r.partnerTransferStatus === 'requestAnswer')
  if (req) return req.answerId
  const csAgents = replies.filter((r) => r.answerType === 'csAgent')
  if (csAgents.length > 0) return csAgents[csAgents.length - 1].answerId
  return replies[0]?.answerId ?? null
}

// ══════════════════════════════════════════════════════════════════
// 답변 / 확인
// ══════════════════════════════════════════════════════════════════

/** 공통 응답 code 검증 */
function assertOk(json: any, fallback: string) {
  if (!json.success) throw new Error(json.error || fallback)
  const code = json.data?.code != null ? String(json.data.code).toUpperCase() : ''
  if (code && code !== '200' && code !== 'OK' && code !== 'SUCCESS') {
    throw new Error(json.data?.message || fallback)
  }
}

/** 문의 답변 전송 */
export async function submitCallCenterReply(
  inquiryId: number,
  content: string,
  replyBy: string,
  parentAnswerId: number | string,
): Promise<void> {
  const safe = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (safe.length < 2 || safe.length > 1000) throw new Error('답변은 2~1,000자여야 합니다.')
  if (!replyBy.trim()) throw new Error('응답자(WING) ID를 입력하세요.')
  if (parentAnswerId == null || parentAnswerId === '') throw new Error('parentAnswerId를 찾을 수 없습니다.')

  const res = await fetch('/api/coupang/cc-inquiry-reply', {
    method: 'POST',
    headers: { ...getCoupangHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ inquiryId, content: safe, replyBy: replyBy.trim(), parentAnswerId }),
  })
  assertOk(await res.json(), '답변 전송에 실패했습니다.')
}

/** 문의 확인 (TRANSFER 건) */
export async function confirmCallCenterInquiry(inquiryId: number, confirmBy: string): Promise<void> {
  if (!confirmBy.trim()) throw new Error('응답자(WING) ID를 입력하세요.')
  const res = await fetch('/api/coupang/cc-inquiry-confirm', {
    method: 'POST',
    headers: { ...getCoupangHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ inquiryId, confirmBy: confirmBy.trim() }),
  })
  assertOk(await res.json(), '문의 확인에 실패했습니다.')
}
