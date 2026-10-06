/* ================================================================
   고객문의 [AI 답변] 초안 상태 (useInquiryAiDrafts)
   - 화면의 문의 행 → inquiryAiService 로 초안 생성 → 행 아래 초안 박스(수정 가능)
     → [확정] 하면 페이지가 준 submitReply 로 쿠팡에 전송하고 초안을 지운다.
   - CustomerInquiry 페이지의 조회·캐시 로직과 분리 — 필요한 것은 콜백으로 받는다.
   - 초안은 inquiryId 기준 Map. 같은 행을 다시 생성하면 덮어쓴다.
   ================================================================ */

import { useCallback, useRef, useState } from 'react'
import type { OnlineInquiry, OrderDetail } from '../../services/csService'
import {
  buildInquiryAiContext,
  generateInquiryReplyDrafts,
  type InquiryAiDraft,
} from '../../services/inquiryAiService'

// ── 훅 입력 ───────────────────────────────────────────────────────
export interface InquiryAiDraftsDeps {
  /** 주문번호 → 주문 상세 (undefined=미조회, null=없음) */
  getDetail: (orderId: string) => OrderDetail | null | undefined
  /** 문의의 답변 본문 목록 (기존 + 이번 세션 제출분) */
  getAnswers: (inquiry: OnlineInquiry) => string[]
  /** 30일 전체 문의 (이전문의와 같은 캐시) — 같은 주문의 흐름을 AI 에게 준다 */
  loadAllInquiries: () => Promise<OnlineInquiry[]>
  /** 확정 → 쿠팡 전송 (실패 시 throw) */
  submitReply: (inquiry: OnlineInquiry, content: string) => Promise<void>
}

/** 행 하나의 초안 + 편집 상태 */
export interface InquiryDraftState {
  draft: InquiryAiDraft
  /** 담당자가 고친 본문 (초기값 = draft.reply) */
  text: string
  confirming: boolean
  error: string
}

export interface InquiryAiDrafts {
  drafts: Map<number, InquiryDraftState>
  /** 생성 중인 문의 ID (버튼 문구·중복 클릭 방지) */
  generating: Set<number>
  /** 마지막 생성 오류 (툴바 아래 표시) */
  generateError: string
  generateFor: (rows: OnlineInquiry[]) => Promise<void>
  setText: (inquiryId: number, text: string) => void
  discard: (inquiryId: number) => void
  confirm: (inquiry: OnlineInquiry) => Promise<void>
  clearAll: () => void
}

export function useInquiryAiDrafts(deps: InquiryAiDraftsDeps): InquiryAiDrafts {
  const [drafts, setDrafts] = useState<Map<number, InquiryDraftState>>(new Map())
  const [generating, setGenerating] = useState<Set<number>>(new Set())
  const [generateError, setGenerateError] = useState('')
  const generatingRef = useRef(false) // 한 번에 한 묶음만 (연속 클릭 방지)
  // 이벤트 핸들러에서 최신 초안을 읽기 위한 거울 (setState 갱신 함수는 지연 실행될 수 있어 거기서 읽지 않는다)
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts

  // ── 초안 생성 ───────────────────────────────────────────────────
  const generateFor = useCallback(async (rows: OnlineInquiry[]) => {
    if (generatingRef.current || rows.length === 0) return
    generatingRef.current = true
    setGenerateError('')
    setGenerating(new Set(rows.map((r) => r.inquiryId)))
    try {
      // 같은 주문의 이전 문의 — 실패해도 초안은 만든다 (흐름 정보만 빠짐)
      let all: OnlineInquiry[] = []
      try {
        all = await deps.loadAllInquiries()
      } catch (e) {
        console.warn('[AI 답변] 이전문의 조회 실패 — 흐름 없이 생성:', e)
      }
      const byOrder = new Map<number, OnlineInquiry[]>()
      for (const inq of all) {
        for (const oid of inq.orderIds ?? []) {
          const arr = byOrder.get(Number(oid)) ?? []
          arr.push(inq)
          byOrder.set(Number(oid), arr)
        }
      }

      const items = rows.map((inq) => {
        const orderId = String(inq.orderIds?.[0] ?? '')
        const sameOrder = orderId ? byOrder.get(Number(orderId)) ?? [] : []
        return buildInquiryAiContext(inq, orderId ? deps.getDetail(orderId) : null, deps.getAnswers(inq), sameOrder)
      })

      const result = await generateInquiryReplyDrafts(items)
      setDrafts((prev) => {
        const next = new Map(prev)
        for (const d of result) {
          next.set(d.inquiryId, { draft: d, text: d.reply, confirming: false, error: '' })
        }
        return next
      })
      const missing = rows.length - result.length
      if (missing > 0) setGenerateError(`${missing}건은 초안을 받지 못했습니다. 다시 시도해 주세요.`)
    } catch (e: any) {
      console.error('[AI 답변] 생성 실패:', e)
      setGenerateError(e?.message ?? 'AI 답변 생성에 실패했습니다.')
    } finally {
      generatingRef.current = false
      setGenerating(new Set())
    }
  }, [deps])

  // ── 편집 · 삭제 ─────────────────────────────────────────────────
  const setText = useCallback((inquiryId: number, text: string) => {
    setDrafts((prev) => {
      const cur = prev.get(inquiryId)
      if (!cur) return prev
      const next = new Map(prev)
      next.set(inquiryId, { ...cur, text, error: '' })
      return next
    })
  }, [])

  const discard = useCallback((inquiryId: number) => {
    setDrafts((prev) => {
      if (!prev.has(inquiryId)) return prev
      const next = new Map(prev)
      next.delete(inquiryId)
      return next
    })
  }, [])

  const clearAll = useCallback(() => setDrafts(new Map()), [])

  // ── 확정 → 전송 ─────────────────────────────────────────────────
  const confirm = useCallback(async (inquiry: OnlineInquiry) => {
    const id = inquiry.inquiryId
    const cur = draftsRef.current.get(id)
    if (!cur || cur.confirming) return
    const text = cur.text
    const patch = (p: Partial<InquiryDraftState>) =>
      setDrafts((prev) => {
        const c = prev.get(id)
        if (!c) return prev
        const next = new Map(prev)
        next.set(id, { ...c, ...p })
        return next
      })
    if (!text.trim()) {
      patch({ error: '답변 내용이 비어 있습니다.' })
      return
    }
    patch({ confirming: true, error: '' })
    try {
      await deps.submitReply(inquiry, text)
      discard(id) // 전송 성공 → 초안 제거 (답변은 페이지의 repliesMap 에 반영됨)
    } catch (e: any) {
      patch({ confirming: false, error: e?.message ?? '전송에 실패했습니다.' })
    }
  }, [deps, discard])

  return { drafts, generating, generateError, generateFor, setText, discard, confirm, clearAll }
}
