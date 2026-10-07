/* ================================================================
   고객문의 (CustomerInquiry) — 상품별 고객문의 (onlineInquiries)
   - 탭: 미답변(NOANSWER) / 답변완료(ANSWERED), 각 탭 최근 30일 (csService 가 7일×5회 분할)
   - 페이지네이션 20개 (클라이언트)
   - 행마다 주문번호(orderIds[0])로 주문 상세를 조회해 상품·수취인·수량·금액·출고예정·배송상태 표시
     + 개인주문 '상태' 열과 같은 fulfillment 상태점 (orderFulfillmentService 공유)
   - 답변 응답자(replyBy)는 계정의 si_users.coupang_user_name 고정 (입력란 없음, 비어 있으면 전송 차단)
   - [AI 답변 생성]: 미답변 행에 예상 답변 초안 → 담당자가 고쳐서 [확정] → 쿠팡 전송
     (초안 상태 components/cs/useInquiryAiDrafts.ts · 규칙 src/server/ai/customerInquiryGuide.md)
   - 디자인 v2 (2026-10-07): 문의 1건 = 카드 1장 — components/cs/CustomerInquiryList.tsx, 스타일 CustomerInquiry.css (.ci-*)
     전역 액션(새로고침 · 초안 모두 지우기 · AI 답변 생성)은 헤더, 행 작업은 카드 왼쪽 레일
   ================================================================ */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './CustomerInquiry.css'
import {
  fetchOnlineInquiries30d,
  fetchCsOrderDetailsMap,
  submitOnlineInquiryReply,
  type OnlineInquiry,
  type OrderDetail,
} from '../services/csService'
import { getOrderUserId, fetchCoupangUserName } from '../services/supabase'
import { isOrderSupabaseConfigured } from '../services/orderSupabase'
import {
  fetchFulfillmentData,
  fetchOrderCartKeys,
  deriveFulfillmentStatus,
  makeFulfillmentKey,
  type FulfillmentStatus,
} from '../services/orderFulfillmentService'
import { pickLine } from '../components/cs/OrderInfoLine'
import CustomerInquiryList from '../components/cs/CustomerInquiryList'
import CustomerInquiryDrawer, { type Answer } from '../components/cs/CustomerInquiryDrawer'
import CancelOrderDrawer from '../components/cs/CancelOrderDrawer'
import { useInquiryAiDrafts } from '../components/cs/useInquiryAiDrafts'
import FulfillmentDrawer from './FulfillmentDrawer'

// ── 상수 ──────────────────────────────────────────────────────────
const PAGE_SIZE = 20 // 페이지당 표시 행 수
/** AI 초안의 판단 근거 문장 표시 여부 (이 브라우저에 기억) */
const SHOW_REASONING_KEY = 'cs_ai_show_reasoning'

type TabKey = 'NOANSWER' | 'ANSWERED'
type DrawerMode = 'reply' | 'history'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'NOANSWER', label: '미답변' },
  { key: 'ANSWERED', label: '답변완료' },
]

/** 문의행 → fulfillment 이력 드로어 열기용 정보 (ft_order_items 매칭 결과) */
interface FfItemInfo {
  itemIds: string[]
  itemName: string | null
  optionName: string | null
  productNo: string | null
  itemNo: string | null
  orderNo: string
}

// ══════════════════════════════════════════════════════════════════
// 유틸
// ══════════════════════════════════════════════════════════════════

/** inquiryAt 으로부터 경과 시간(시간 단위) */
function hoursSince(iso: string): number {
  if (!iso) return Infinity
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return Infinity
  return (Date.now() - t) / (1000 * 60 * 60)
}

/** 로그인 사용자 ID (coupang_personal_orders 격리 키) */
function getUserId(): string {
  try {
    const raw = localStorage.getItem('user')
    return raw ? (JSON.parse(raw)?.id ?? '') : ''
  } catch { return '' }
}

/** HH:mm (마지막 갱신 표시) */
function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 응답자 ID 미등록 안내 (드로어 · AI 확정 공용) */
const REPLY_BY_MISSING_MSG =
  '쿠팡 로그인 ID(si_users.coupang_user_name)가 계정에 등록되어 있지 않아 답변을 보낼 수 없습니다. 관리자에게 등록을 요청하세요.'

// ══════════════════════════════════════════════════════════════════
// 컴포넌트
// ══════════════════════════════════════════════════════════════════

const CustomerInquiry: React.FC = () => {
  const [tab, setTab] = useState<TabKey>('NOANSWER')
  const [rows, setRows] = useState<OnlineInquiry[]>([])
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)
  // AI 초안의 판단 근거 문장 표시 (기본 켬)
  const [showReasoning, setShowReasoning] = useState<boolean>(() => {
    try { return localStorage.getItem(SHOW_REASONING_KEY) !== '0' } catch { return true }
  })
  const toggleReasoning = useCallback(() => {
    setShowReasoning((v) => {
      try { localStorage.setItem(SHOW_REASONING_KEY, v ? '0' : '1') } catch { /* 무시 */ }
      return !v
    })
  }, [])

  // ── 주문정보 보강 상태 ──────────────────────────────────────────
  // orderId → OrderDetail | null 캐시 (탭/페이지 전환 간 재사용)
  const orderCacheRef = useRef<Map<string, OrderDetail | null>>(new Map())
  const [, setEnrichVersion] = useState(0) // 캐시 갱신 시 리렌더 트리거
  const [statusMap, setStatusMap] = useState<Map<number, FulfillmentStatus>>(new Map())

  // ── 드로어(답변/이전문의) 상태 ──────────────────────────────────
  const [drawer, setDrawer] = useState<{ mode: DrawerMode; inquiry: OnlineInquiry } | null>(null)
  // inquiryId → 이번 세션에 제출된 답변 (옵티미스틱)
  const [repliesMap, setRepliesMap] = useState<Map<number, Answer[]>>(new Map())
  // 이전문의: 30일 전체(ALL) 캐시 + 필터 결과 (AI 초안도 같은 캐시를 쓴다)
  const allInquiriesRef = useRef<OnlineInquiry[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyItems, setHistoryItems] = useState<OnlineInquiry[]>([])

  // ── fulfillment 이력 드로어 (상태 클릭 → 개인주문과 동일한 이력) ──
  const [itemInfoMap, setItemInfoMap] = useState<Map<number, FfItemInfo>>(new Map())
  const [ffDrawer, setFfDrawer] = useState<FfItemInfo | null>(null)
  // 취소 드로어 (orderId)
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null)

  // ── 응답자 ID (si_users.coupang_user_name) ──────────────────────
  // 화면 표시용 state + 전송 시점에 쓰는 ref. 비어 있으면 전송 직전에 한 번 더 조회한다
  // (페이지를 연 뒤 관리자가 채운 경우).
  const [replyBy, setReplyBy] = useState('')
  const [replyByStatus, setReplyByStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const replyByRef = useRef('')

  const refreshReplyBy = useCallback(async (): Promise<string> => {
    try {
      const name = await fetchCoupangUserName()
      replyByRef.current = name
      setReplyBy(name)
      setReplyByStatus('ready')
      return name
    } catch (e) {
      console.error('[고객문의] 쿠팡 로그인 ID 조회 실패:', e)
      setReplyByStatus('error')
      throw e
    }
  }, [])

  useEffect(() => {
    refreshReplyBy().catch(() => { /* 상태는 refreshReplyBy 가 기록, 전송 시 재시도 */ })
  }, [refreshReplyBy])

  /** 전송에 쓸 응답자 ID — 없으면 재조회, 그래도 없으면 throw */
  const resolveReplyBy = useCallback(async (): Promise<string> => {
    const name = replyByRef.current || (await refreshReplyBy())
    if (!name) throw new Error(REPLY_BY_MISSING_MSG)
    return name
  }, [refreshReplyBy])

  // ── 데이터 로드 ─────────────────────────────────────────────────
  const load = useCallback(async (answeredType: TabKey) => {
    setLoading(true)
    setError('')
    setProgress('')
    setPage(1)
    setStatusMap(new Map())
    setItemInfoMap(new Map())
    try {
      const result = await fetchOnlineInquiries30d(answeredType, (done, total) => {
        setProgress(`조회 중... ${done}/${total} 구간`)
      })
      setRows(result)
      setLastLoadedAt(new Date())
    } catch (err: any) {
      console.error('[고객문의] 조회 실패:', err)
      setError(`조회 실패: ${err?.message ?? err}`)
      setRows([])
    } finally {
      setLoading(false)
      setProgress('')
    }
  }, [])

  // 탭 변경 시 재조회
  useEffect(() => {
    load(tab)
  }, [tab, load])

  // ── 미답변 경과 집계 (미답변 탭 전용) ──────────────────────────
  const aging = useMemo(() => {
    const b = { within24: 0, within72: 0, over72: 0 }
    for (const r of rows) {
      const h = hoursSince(r.inquiryAt)
      if (h <= 24) b.within24++
      else if (h <= 72) b.within72++
      else b.over72++
    }
    return b
  }, [rows])

  // ── 페이지네이션 ────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const pageRows = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [rows, page],
  )
  const changePage = useCallback((p: number) => {
    setPage(Math.min(totalPages, Math.max(1, p)))
  }, [totalPages])

  // ── 문의별 답변 목록 (기존 commentDtoList + 이번 세션 제출분) ────
  const answersFor = useCallback(
    (inq: OnlineInquiry): Answer[] => {
      const existing: Answer[] = (inq.commentDtoList ?? []).map((c) => ({
        content: c.content,
        at: c.inquiryCommentAt,
      }))
      const submitted = repliesMap.get(inq.inquiryId) ?? []
      return [...existing, ...submitted]
    },
    [repliesMap],
  )

  // ── 30일 전체 문의 (이전문의 · AI 초안 공용 캐시, 최초 1회 조회) ──
  const loadAllInquiries = useCallback(async (): Promise<OnlineInquiry[]> => {
    if (!allInquiriesRef.current) {
      allInquiriesRef.current = await fetchOnlineInquiries30d('ALL')
    }
    return allInquiriesRef.current
  }, [])

  // ── 답변 전송 (드로어 · AI 확정 공용) — 응답자는 항상 coupang_user_name ──
  const sendReply = useCallback(async (inq: OnlineInquiry, content: string) => {
    const by = await resolveReplyBy()
    await submitOnlineInquiryReply(inq.inquiryId, content, by) // 실패 시 throw → 호출 쪽에서 표시
    // 옵티미스틱: 문의 내용 하단 + 드로어 타임라인에 즉시 반영
    const at = new Date().toISOString()
    setRepliesMap((prev) => {
      const next = new Map(prev)
      const arr = next.get(inq.inquiryId) ?? []
      next.set(inq.inquiryId, [...arr, { content: content.replace(/\r\n/g, '\n').trim(), at }])
      return next
    })
  }, [resolveReplyBy])

  // ── AI 예상 답변 초안 ───────────────────────────────────────────
  const aiDeps = useMemo(() => ({
    getDetail: (orderId: string) => orderCacheRef.current.get(orderId),
    getAnswers: (inq: OnlineInquiry) => answersFor(inq).map((a) => a.content),
    loadAllInquiries,
    submitReply: sendReply,
  }), [answersFor, loadAllInquiries, sendReply])
  const ai = useInquiryAiDrafts(aiDeps)

  // ── '답변' → 드로어 열기 ────────────────────────────────────────
  const openReply = useCallback((inq: OnlineInquiry) => {
    setDrawer({ mode: 'reply', inquiry: inq })
  }, [])

  // ── '이전문의' → 같은 주문의 문의내역 조회 후 드로어 열기 ────────
  const openHistory = useCallback(async (inq: OnlineInquiry) => {
    setDrawer({ mode: 'history', inquiry: inq })
    const targetOrderId = Number(inq.orderIds?.[0])
    if (!targetOrderId) {
      setHistoryItems([])
      return
    }
    setHistoryLoading(true)
    try {
      const all = await loadAllInquiries()
      setHistoryItems(all.filter((i) => (i.orderIds ?? []).some((oid) => Number(oid) === targetOrderId)))
    } catch (e) {
      console.error('[고객문의] 이전문의 조회 실패:', e)
      setHistoryItems([])
    } finally {
      setHistoryLoading(false)
    }
  }, [loadAllInquiries])

  // ── 드로어에서 답변 전송 ────────────────────────────────────────
  const handleDrawerSubmit = useCallback(
    async (content: string) => {
      const inq = drawer?.inquiry
      if (!inq) return
      await sendReply(inq, content)
    },
    [drawer, sendReply],
  )

  const closeDrawer = useCallback(() => setDrawer(null), [])

  // ── 상태 클릭 → fulfillment 이력 드로어 (개인주문과 동일) ────────
  const openFulfillment = useCallback((inquiryId: number) => {
    const info = itemInfoMap.get(inquiryId)
    if (info && info.itemIds.length > 0) setFfDrawer(info)
  }, [itemInfoMap])
  const canOpenFulfillment = useCallback((inquiryId: number) => itemInfoMap.has(inquiryId), [itemInfoMap])
  const closeFulfillment = useCallback(() => setFfDrawer(null), [])

  const getDetail = useCallback((orderId: string) => orderCacheRef.current.get(orderId), [])

  // ── 현재 페이지 행의 주문정보 + fulfillment 상태 보강 ───────────
  useEffect(() => {
    if (pageRows.length === 0) return
    let cancelled = false

    ;(async () => {
      const orderIds = Array.from(
        new Set(pageRows.map((r) => String(r.orderIds?.[0] ?? '')).filter(Boolean)),
      )
      if (orderIds.length === 0) return

      // 1) 주문 상세 (캐시 미보유분만 조회)
      const missing = orderIds.filter((id) => !orderCacheRef.current.has(id))
      if (missing.length > 0) {
        const fetched = await fetchCsOrderDetailsMap(missing, getUserId())
        if (cancelled) return
        for (const [id, d] of fetched) orderCacheRef.current.set(id, d)
        setEnrichVersion((v) => v + 1)
      }

      // 2) fulfillment 상태 (주문 프로젝트 DB 연동 시에만)
      if (!isOrderSupabaseConfigured) return
      const orderUserId = await getOrderUserId()
      if (cancelled || !orderUserId) return

      try {
        const [fdata, cartKeys] = await Promise.all([
          fetchFulfillmentData(orderIds, orderUserId),
          fetchOrderCartKeys(orderIds, orderUserId),
        ])
        if (cancelled) return

        const sMap = new Map<number, FulfillmentStatus>()
        const iMap = new Map<number, FfItemInfo>()
        for (const inq of pageRows) {
          const oid = String(inq.orderIds?.[0] ?? '')
          const vId = String(inq.vendorItemId ?? '')
          const detail = orderCacheRef.current.get(oid)
          const line = detail ? pickLine(detail, vId) : null
          const qty = line?.shippingCount ?? 0
          sMap.set(
            inq.inquiryId,
            deriveFulfillmentStatus(oid, vId, qty, {
              aggMap: fdata.aggMap,
              itemAggMap: fdata.itemAggMap,
              orderItemsMap: fdata.orderItemsMap,
              cartKeys,
            }),
          )

          // ── fulfillment 이력 드로어용 itemIds (ft_order_items) 매핑 ──
          const details = fdata.orderItemsMap.get(makeFulfillmentKey(oid, vId)) ?? []
          if (details.length > 0) {
            const first = details[0]
            iMap.set(inq.inquiryId, {
              itemIds: details.map((d) => d.id),
              itemName: line?.sellerProductName ?? first.item_name,
              optionName: line?.optionName ?? first.option_name,
              productNo: first.product_no,
              itemNo: first.item_no,
              orderNo: oid,
            })
          }
        }
        if (!cancelled) {
          setStatusMap(sMap)
          setItemInfoMap(iMap)
        }
      } catch (e) {
        console.error('[고객문의] fulfillment 상태 조회 실패:', e)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [pageRows])

  // ── [AI 답변 생성] 대상: 이 페이지에서 답변도 초안도 없는 미답변 행 ──
  const aiEnabled = tab === 'NOANSWER'
  const aiBusy = ai.generating.size > 0
  const aiTargets = useMemo(
    () => (aiEnabled ? pageRows.filter((r) => !ai.drafts.has(r.inquiryId) && answersFor(r).length === 0) : []),
    [aiEnabled, pageRows, ai.drafts, answersFor],
  )

  // ══════════════════════════════════════════════════════════════
  return (
    <div className="ci-page">
      <div className="ci-inner">
        {/* ── 머리: 제목 · 범위 | 전역 액션 ───────────────────────── */}
        <div className="ci-header">
          <div>
            <h1 className="ci-title">고객문의</h1>
            <div className="ci-subtitle">
              상품문의 · 최근 30일{lastLoadedAt && ` · 마지막 갱신 ${hhmm(lastLoadedAt)}`}
            </div>
          </div>
          <div className="ci-header-actions">
            <button type="button" className="ci-btn" onClick={() => load(tab)} disabled={loading}>
              {loading ? '조회 중…' : '새로고침'}
            </button>
            {ai.drafts.size > 0 && (
              <button type="button" className="ci-btn" onClick={ai.clearAll} disabled={aiBusy}>
                초안 모두 지우기
              </button>
            )}
            <button
              type="button"
              className="ci-btn ci-btn-primary"
              onClick={() => ai.generateFor(aiTargets)}
              disabled={!aiEnabled || loading || aiBusy || aiTargets.length === 0}
              title={aiEnabled ? '이 페이지의 미답변 문의에 예상 답변을 만듭니다' : '미답변 탭에서만 쓸 수 있습니다'}
            >
              {aiBusy ? `AI 답변 생성 중… (${ai.generating.size})` : 'AI 답변 생성'}
            </button>
          </div>
        </div>

        {/* ── 탭 | 미답변 경과 요약 · 근거 표시 ───────────────────── */}
        <div className="ci-tabbar">
          <div className="ci-seg" role="tablist">
            {TABS.map((t) => {
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`ci-seg-btn${active ? ' active' : ''}`}
                  onClick={() => setTab(t.key)}
                  disabled={loading}
                >
                  {t.label}
                  {active && !loading && <span className="ci-seg-count">{rows.length}</span>}
                </button>
              )
            })}
          </div>
          <div className="ci-aging">
            {aiEnabled && !loading && rows.length > 0 && (
              <>
                <span>24시간 이내<b>{aging.within24}</b></span>
                <span>24~72시간<b>{aging.within72}</b></span>
                <span className={aging.over72 > 0 ? 'warn' : undefined}>72시간 초과<b>{aging.over72}</b></span>
              </>
            )}
            {aiEnabled && ai.drafts.size > 0 && (
              <button type="button" className="ci-btn ci-btn-text ci-btn-sm" onClick={toggleReasoning}>
                {showReasoning ? '근거 숨기기' : '근거 표시'}
              </button>
            )}
          </div>
        </div>

        {/* ── 상태 메시지 ──────────────────────────────────────────── */}
        {error && <div className="ci-error">{error}</div>}
        {ai.generateError && <div className="ci-error">{ai.generateError}</div>}

        {/* ── 카드 목록 ────────────────────────────────────────────── */}
        <CustomerInquiryList
          rows={pageRows}
          loading={loading}
          progress={progress}
          page={page}
          totalPages={totalPages}
          onPageChange={changePage}
          getDetail={getDetail}
          statusMap={statusMap}
          canOpenFulfillment={canOpenFulfillment}
          answersFor={answersFor}
          ai={ai}
          aiEnabled={aiEnabled}
          showReasoning={showReasoning}
          onReply={openReply}
          onHistory={openHistory}
          onCancel={setCancelOrderId}
          onFulfillment={openFulfillment}
        />
      </div>

      {/* ── 우측 드로어 (답변 / 이전문의) ─────────────────────────── */}
      <CustomerInquiryDrawer
        open={drawer !== null}
        mode={drawer?.mode ?? null}
        inquiry={drawer?.inquiry ?? null}
        detail={drawer ? orderCacheRef.current.get(String(drawer.inquiry.orderIds?.[0] ?? '')) : null}
        answers={drawer?.inquiry ? answersFor(drawer.inquiry) : []}
        replyBy={replyBy}
        replyByNotice={
          replyByStatus === 'loading' ? '조회 중…'
            : replyByStatus === 'error' ? '조회 실패 — [답변하기] 를 누르면 다시 조회합니다.'
            : replyBy ? '' : REPLY_BY_MISSING_MSG
        }
        onSubmitReply={handleDrawerSubmit}
        historyLoading={historyLoading}
        historyItems={historyItems}
        onClose={closeDrawer}
      />

      {/* ── fulfillment 이력 드로어 (상태 클릭) — 개인주문과 동일 ─── */}
      <FulfillmentDrawer
        open={ffDrawer !== null}
        itemIds={ffDrawer?.itemIds ?? []}
        itemName={ffDrawer?.itemName ?? null}
        optionName={ffDrawer?.optionName ?? null}
        orderNo={ffDrawer?.orderNo ?? null}
        itemNo={ffDrawer?.itemNo ?? null}
        productNo={ffDrawer?.productNo ?? null}
        note=""
        noteResetKey=""
        onSaveNote={() => { /* CS 맥락에서는 비고 미사용 */ }}
        onClose={closeFulfillment}
        showNote={false}
      />

      {/* ── 주문 취소 드로어 (재사용 컴포넌트) ─────────────────────── */}
      <CancelOrderDrawer
        open={cancelOrderId !== null}
        orderId={cancelOrderId}
        onClose={() => setCancelOrderId(null)}
      />
    </div>
  )
}

export default CustomerInquiry
