/* ================================================================
   고객문의 (CustomerInquiry) — 상품별 고객문의 (onlineInquiries)
   - 탭: 미답변(NOANSWER) / 답변완료(ANSWERED)
   - 각 탭 최근 30일 조회 (csService가 7일×5회 분할 병합)
   - 페이지네이션 20개 기준 (클라이언트 측)
   - 각 행: 주문번호(orderIds[0])로 주문 상세를 조회해
     주문자명/등록상품명/수량/금액/출고예정일/운송장번호/배송상태 표시.
   - 추가로 개인주문 '상태' 열과 동일한 fulfillment 색 점 + 상태명 표시
     (orderFulfillmentService.deriveFulfillmentStatus 공유).
   ================================================================ */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { theme } from '../styles/theme'
import {
  fetchOnlineInquiries30d,
  fetchCsOrderDetailsMap,
  submitOnlineInquiryReply,
  type OnlineInquiry,
  type OrderDetail,
} from '../services/csService'
import { getOrderUserId } from '../services/supabase'
import { isOrderSupabaseConfigured } from '../services/orderSupabase'
import {
  fetchFulfillmentData,
  fetchOrderCartKeys,
  deriveFulfillmentStatus,
  makeFulfillmentKey,
  type FulfillmentStatus,
} from '../services/orderFulfillmentService'
import OrderInfoLine, { pickLine } from '../components/cs/OrderInfoLine'
import CustomerInquiryDrawer, { type Answer } from '../components/cs/CustomerInquiryDrawer'
import CancelOrderDrawer from '../components/cs/CancelOrderDrawer'
import FulfillmentDrawer from './FulfillmentDrawer'

// ── 상수 ──────────────────────────────────────────────────────────
const PAGE_SIZE = 20 // 페이지당 표시 행 수

type TabKey = 'NOANSWER' | 'ANSWERED'
type DrawerMode = 'reply' | 'history'

/** 문의행 → fulfillment 이력 드로어 열기용 정보 (ft_order_items 매칭 결과) */
interface FfItemInfo {
  itemIds: string[]
  itemName: string | null
  optionName: string | null
  productNo: string | null
  itemNo: string | null
  orderNo: string
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'NOANSWER', label: '미답변' },
  { key: 'ANSWERED', label: '답변완료' },
]

// ══════════════════════════════════════════════════════════════════
// 표시 유틸
// ══════════════════════════════════════════════════════════════════

/** ISO-8601 → { date: 'yyyy.MM.dd', time: 'HH:mm:ss' } 2줄 표기용 */
function formatInquiryAt(iso: string): { date: string; time: string } {
  if (!iso) return { date: '-', time: '' }
  const [datePart, timePartRaw] = iso.split('T')
  const date = (datePart ?? '').replace(/-/g, '.')
  const time = (timePartRaw ?? '').slice(0, 8)
  return { date, time }
}

/** yyyy-MM-dd(THH:mm) → yyyy.MM.dd */
function formatDate(s: string | null): string {
  if (!s) return '-'
  return s.slice(0, 10).replace(/-/g, '.')
}

/** 주문번호 표기: 첫 건 + "외 N건" */
function formatOrderIds(orderIds: number[]): string {
  if (!orderIds || orderIds.length === 0) return '-'
  const first = String(orderIds[0])
  return orderIds.length > 1 ? `${first} 외 ${orderIds.length - 1}건` : first
}

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

// ══════════════════════════════════════════════════════════════════
// 미답변 현황 카드 (미답변 탭 전용)
// ══════════════════════════════════════════════════════════════════

const StatusCard: React.FC<{ label: string; count: number }> = ({ label, count }) => (
  <div
    style={{
      ...theme.card,
      padding: '14px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      minWidth: '180px',
      flex: 1,
    }}
  >
    <span style={{ fontSize: theme.fontSize.sm, color: theme.colors.textSecondary }}>{label}</span>
    <span style={{ fontSize: theme.fontSize['2xl'], fontWeight: 700, color: theme.colors.textPrimary }}>
      {count}건
    </span>
  </div>
)

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

  // ── 주문정보 보강 상태 ──────────────────────────────────────────
  // orderId → OrderDetail | null 캐시 (탭/페이지 전환 간 재사용)
  const orderCacheRef = useRef<Map<string, OrderDetail | null>>(new Map())
  const [, setEnrichVersion] = useState(0) // 캐시 갱신 시 리렌더 트리거
  const [statusMap, setStatusMap] = useState<Map<number, FulfillmentStatus>>(new Map())

  // ── 드로어(답변/이전문의) 상태 ──────────────────────────────────
  const [drawer, setDrawer] = useState<{ mode: DrawerMode; inquiry: OnlineInquiry } | null>(null)
  // inquiryId → 이번 세션에 제출된 답변 (옵티미스틱)
  const [repliesMap, setRepliesMap] = useState<Map<number, Answer[]>>(new Map())
  // 이전문의: 30일 전체(ALL) 캐시 + 필터 결과
  const allInquiriesRef = useRef<OnlineInquiry[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyItems, setHistoryItems] = useState<OnlineInquiry[]>([])

  // ── fulfillment 이력 드로어 (상태 클릭 → 개인주문과 동일한 이력) ──
  const [itemInfoMap, setItemInfoMap] = useState<Map<number, FfItemInfo>>(new Map())
  const [ffDrawer, setFfDrawer] = useState<FfItemInfo | null>(null)
  // 취소 드로어 (orderId)
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null)

  // 응답자(WING) ID 기본값 — 저장값 → 로그인 username
  const replyByDefault = useMemo(() => {
    try {
      const saved = localStorage.getItem('cs_reply_by')
      if (saved) return saved
      const raw = localStorage.getItem('user')
      return raw ? (JSON.parse(raw)?.username ?? '') : ''
    } catch {
      return ''
    }
  }, [])

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

  // ── 미답변 현황 집계 (미답변 탭 전용) ──────────────────────────
  const statusBuckets = useMemo(() => {
    const buckets = { within24: 0, within72: 0, within30d: 0 }
    for (const r of rows) {
      const h = hoursSince(r.inquiryAt)
      if (h <= 24) buckets.within24++
      else if (h <= 72) buckets.within72++
      else buckets.within30d++
    }
    return buckets
  }, [rows])

  // ── 페이지네이션 ────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const pageRows = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [rows, page],
  )

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

  // ── '답변하기' 버튼 → 드로어 열기 ───────────────────────────────
  const openReply = useCallback((inq: OnlineInquiry) => {
    setDrawer({ mode: 'reply', inquiry: inq })
  }, [])

  // ── '이전문의' 버튼 → 같은 주문의 문의내역 조회 후 드로어 열기 ──
  const openHistory = useCallback(async (inq: OnlineInquiry) => {
    setDrawer({ mode: 'history', inquiry: inq })
    const targetOrderId = Number(inq.orderIds?.[0])
    if (!targetOrderId) {
      setHistoryItems([])
      return
    }
    setHistoryLoading(true)
    try {
      // ALL 30일 결과 캐시 (최초 1회만 조회)
      if (!allInquiriesRef.current) {
        allInquiriesRef.current = await fetchOnlineInquiries30d('ALL')
      }
      const filtered = allInquiriesRef.current.filter((i) =>
        (i.orderIds ?? []).some((oid) => Number(oid) === targetOrderId),
      )
      setHistoryItems(filtered)
    } catch (e) {
      console.error('[고객문의] 이전문의 조회 실패:', e)
      setHistoryItems([])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  // ── 답변 전송 (드로어에서 호출) ─────────────────────────────────
  const handleSubmitReply = useCallback(
    async (content: string, replyBy: string) => {
      const inq = drawer?.inquiry
      if (!inq) return
      await submitOnlineInquiryReply(inq.inquiryId, content, replyBy) // 실패 시 throw → 드로어에서 표시
      // 옵티미스틱: 문의 내용 하단 + 드로어 타임라인에 즉시 반영
      const at = new Date().toISOString()
      setRepliesMap((prev) => {
        const next = new Map(prev)
        const arr = next.get(inq.inquiryId) ?? []
        next.set(inq.inquiryId, [...arr, { content: content.replace(/\r\n/g, '\n').trim(), at }])
        return next
      })
    },
    [drawer],
  )

  const closeDrawer = useCallback(() => setDrawer(null), [])

  // ── 상태 클릭 → fulfillment 이력 드로어 (개인주문과 동일) ────────
  const openFulfillment = useCallback((inquiryId: number) => {
    const info = itemInfoMap.get(inquiryId)
    if (info && info.itemIds.length > 0) setFfDrawer(info)
  }, [itemInfoMap])

  const closeFulfillment = useCallback(() => setFfDrawer(null), [])

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
          const line = detail
            ? detail.lines.find((l) => l.vendorItemId === vId) ?? detail.lines[0]
            : null
          const qty = line?.shippingCount ?? 0
          sMap.set(
            inq.inquiryId,
            deriveFulfillmentStatus(oid, vId, qty, {
              aggMap: fdata.aggMap,
              multiKeys: fdata.multiKeys,
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

  // ══════════════════════════════════════════════════════════════
  return (
    <div style={{ padding: '24px 28px' }}>
      {/* ── 헤더 ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h1 style={{ fontSize: theme.fontSize['3xl'], fontWeight: 700, color: theme.colors.textPrimary, margin: 0 }}>
          고객문의
        </h1>
        <button
          onClick={() => load(tab)}
          disabled={loading}
          style={{
            padding: '8px 16px',
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radius.sm,
            background: theme.colors.bgCard,
            color: theme.colors.textPrimary,
            fontSize: theme.fontSize.sm,
            cursor: loading ? 'default' : 'pointer',
          }}
        >
          {loading ? '조회 중...' : '새로고침'}
        </button>
      </div>

      {/* ── 탭 ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: `1px solid ${theme.colors.border}`, marginBottom: '20px' }}>
        {TABS.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              disabled={loading}
              style={{
                padding: '10px 20px',
                border: 'none',
                borderBottom: active ? `2px solid ${theme.colors.primary}` : '2px solid transparent',
                background: 'transparent',
                color: active ? theme.colors.primary : theme.colors.textSecondary,
                fontSize: theme.fontSize.base,
                fontWeight: active ? 700 : 500,
                cursor: loading ? 'default' : 'pointer',
                marginBottom: '-1px',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ── 미답변 현황 (미답변 탭 전용) ────────────────────────── */}
      {tab === 'NOANSWER' && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: theme.fontSize.base, fontWeight: 600, color: theme.colors.textPrimary, marginBottom: '10px' }}>
            미답변 현황
          </div>
          <div style={{ display: 'flex', gap: '14px' }}>
            <StatusCard label="24시간 이내" count={statusBuckets.within24} />
            <StatusCard label="24~72시간" count={statusBuckets.within72} />
            <StatusCard label="72시간~30일 이내" count={statusBuckets.within30d} />
          </div>
        </div>
      )}

      {/* ── 조회 조건 요약 바 ──────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginBottom: '12px',
          fontSize: theme.fontSize.sm,
          color: theme.colors.textSecondary,
        }}
      >
        <span
          style={{
            padding: '4px 12px',
            borderRadius: theme.radius.full,
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.bgTableHeader,
          }}
        >
          등록일: 지난 30일
        </span>
        <span>
          총 <strong style={{ color: theme.colors.textPrimary }}>{rows.length}</strong>개
        </span>
      </div>

      {/* ── 상태 표시 ─────────────────────────────────────────── */}
      {error && (
        <div
          style={{
            ...theme.card,
            padding: '16px 20px',
            marginBottom: '16px',
            borderLeft: `3px solid ${theme.colors.danger}`,
            color: theme.colors.danger,
            fontSize: theme.fontSize.sm,
          }}
        >
          {error}
        </div>
      )}

      {/* ── 테이블 ────────────────────────────────────────────── */}
      <div style={{ ...theme.table.container }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={theme.table.thead}>
            <tr>
              <th style={{ ...theme.table.th, width: '130px' }}>등록일시</th>
              <th style={theme.table.th}>문의내용</th>
              <th style={{ ...theme.table.th, width: '160px' }}>문의유형(접수번호)</th>
              <th style={{ ...theme.table.th, width: '160px' }}>주문번호</th>
              <th style={{ ...theme.table.th, width: '110px', textAlign: 'center' }}>답변여부</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} style={{ ...theme.table.td, textAlign: 'center', padding: '40px', color: theme.colors.textSecondary }}>
                  {progress || '데이터를 조회하는 중...'}
                </td>
              </tr>
            ) : pageRows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ ...theme.table.td, textAlign: 'center', padding: '40px', color: theme.colors.textMuted }}>
                  조회된 문의가 없습니다.
                </td>
              </tr>
            ) : (
              pageRows.map((r) => {
                const { date, time } = formatInquiryAt(r.inquiryAt)
                const orderId = String(r.orderIds?.[0] ?? '')
                // 캐시 상태: 미보유 → undefined(로딩), 보유 → OrderDetail|null
                const detail = orderId ? orderCacheRef.current.get(orderId) : null
                // 주문일/출고예정일 표시용 라인 (해당 옵션)
                const orderLine = detail ? pickLine(detail, String(r.vendorItemId ?? '')) : null
                return (
                  <tr key={r.inquiryId} style={theme.table.tr}>
                    {/* 등록일시 */}
                    <td style={theme.table.td}>
                      <div>{date}</div>
                      <div style={{ fontSize: theme.fontSize.xs, color: theme.colors.textMuted }}>{time}</div>
                    </td>
                    {/* 문의내용 (주문정보 + 질문 + 답변) */}
                    <td style={theme.table.td}>
                      <OrderInfoLine
                        orderId={orderId}
                        vendorItemId={String(r.vendorItemId ?? '')}
                        detail={detail}
                        fallbackName={`상품 ${r.productId}`}
                        status={statusMap.get(r.inquiryId)}
                        onStatusClick={
                          itemInfoMap.has(r.inquiryId) ? () => openFulfillment(r.inquiryId) : undefined
                        }
                      />
                      <div style={{ color: theme.colors.textPrimary }}>{r.content}</div>
                      {answersFor(r).map((a, i) => (
                        <div
                          key={i}
                          style={{
                            marginTop: 5,
                            paddingLeft: 8,
                            borderLeft: `2px solid ${theme.colors.primary}`,
                            color: theme.colors.textSecondary,
                            fontSize: theme.fontSize.xs,
                            whiteSpace: 'pre-wrap',
                            lineHeight: 1.5,
                          }}
                        >
                          ↳ {a.content}
                        </div>
                      ))}
                    </td>
                    {/* 문의유형(접수번호) */}
                    <td style={theme.table.td}>
                      <div>상품문의</div>
                      <div style={{ fontSize: theme.fontSize.xs, color: theme.colors.textMuted }}>({r.inquiryId})</div>
                    </td>
                    {/* 주문번호 + 주문일/출고예정일 */}
                    <td style={theme.table.td}>
                      <div style={{ color: theme.colors.primary }}>{formatOrderIds(r.orderIds)}</div>
                      {orderLine && (
                        <div style={{ fontSize: theme.fontSize.xs, color: theme.colors.textMuted, marginTop: 3, lineHeight: 1.6 }}>
                          <div>주문 {formatDate(orderLine.orderedAt)}</div>
                          <div>예정 {formatDate(orderLine.estimatedShippingDate)}</div>
                        </div>
                      )}
                    </td>
                    {/* 답변여부 — 취소하기 / 이전문의 / 답변하기 */}
                    <td style={{ ...theme.table.td, textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => orderId && setCancelOrderId(orderId)}
                          disabled={!orderId}
                          style={outlineBtnStyle(theme.colors.danger)}
                        >
                          취소하기
                        </button>
                        <button
                          type="button"
                          onClick={() => openHistory(r)}
                          style={outlineBtnStyle(theme.colors.secondary)}
                        >
                          이전문의
                        </button>
                        <button
                          type="button"
                          onClick={() => openReply(r)}
                          style={outlineBtnStyle(theme.colors.primary)}
                        >
                          답변하기
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── 페이지네이션 ──────────────────────────────────────── */}
      {!loading && rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '16px' }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={pagerBtnStyle(page <= 1)}
          >
            이전
          </button>
          <span style={{ fontSize: theme.fontSize.sm, color: theme.colors.textSecondary }}>
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            style={pagerBtnStyle(page >= totalPages)}
          >
            다음
          </button>
        </div>
      )}

      {/* ── 우측 드로어 (답변 / 이전문의) ─────────────────────────── */}
      <CustomerInquiryDrawer
        open={drawer !== null}
        mode={drawer?.mode ?? null}
        inquiry={drawer?.inquiry ?? null}
        detail={drawer ? orderCacheRef.current.get(String(drawer.inquiry.orderIds?.[0] ?? '')) : null}
        answers={drawer?.inquiry ? answersFor(drawer.inquiry) : []}
        replyByDefault={replyByDefault}
        onSubmitReply={handleSubmitReply}
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

// ── 답변여부 열 아웃라인 버튼 스타일 ───────────────────────────────
function outlineBtnStyle(color: string): React.CSSProperties {
  return {
    padding: '5px 10px',
    border: `1px solid ${color}`,
    borderRadius: theme.radius.sm,
    background: theme.colors.bgCard,
    color,
    fontSize: theme.fontSize.xs,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }
}

// ── 페이지네이션 버튼 스타일 ───────────────────────────────────────
function pagerBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '6px 16px',
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radius.sm,
    background: theme.colors.bgCard,
    color: disabled ? theme.colors.textMuted : theme.colors.textPrimary,
    fontSize: theme.fontSize.sm,
    cursor: disabled ? 'default' : 'pointer',
  }
}

export default CustomerInquiry
