/* ================================================================
   쿠팡문의 (CoupangInquiry) — 쿠팡 고객센터 문의 (callCenterInquiries)
   - 전체(NONE) 30일을 한 번 조회 후, 탭은 상태값으로 클라이언트 필터링
     · 쿠팡 서버의 NO_ANSWER 필터가 실제로 응답필요 건을 반환하지 않아
       (응답필요=csPartnerCounselingStatus:'requestAnswer' 는 TRANSFER로 옴)
       서버 상태필터에 의존하지 않고 클라이언트에서 분류한다.
   - 행 조치: 응답필요+progress → 답변, 응답필요+complete → 확인, answered → 완료
   - 페이지네이션 20개
   ================================================================ */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { theme } from '../styles/theme'
import {
  fetchCallCenterInquiries30d,
  submitCallCenterReply,
  confirmCallCenterInquiry,
  type CallCenterInquiry,
} from '../services/ccInquiryService'
import { fetchOrderDetailsMap, type OrderDetail } from '../services/csService'
import OrderInfoLine from '../components/cs/OrderInfoLine'
import CoupangInquiryDrawer from '../components/cs/CoupangInquiryDrawer'

// ── 상수 ──────────────────────────────────────────────────────────
const PAGE_SIZE = 20

/** 행 조치 (상태로 판정) */
type RowAction = 'reply' | 'confirm' | 'done'
/** 탭 key — 'ALL' + RowAction */
type TabKey = 'ALL' | RowAction

const TABS: { key: TabKey; label: string }[] = [
  { key: 'ALL', label: '전체' },
  { key: 'reply', label: '미답변' },
  { key: 'confirm', label: '미확인' },
  { key: 'done', label: '답변완료' },
]

// ── 표시 유틸 ──────────────────────────────────────────────────────
function formatInquiryAt(iso: string): { date: string; time: string } {
  if (!iso) return { date: '-', time: '' }
  const [d, t] = iso.split('T')
  return { date: (d ?? '').replace(/-/g, '.'), time: (t ?? '').slice(0, 8) }
}

/** 주문번호 문자열 (없으면 '') */
function orderIdOf(inq: CallCenterInquiry): string {
  return inq.orderId != null ? String(inq.orderId) : ''
}

/** vendorItemId 문자열 (배열이면 첫 값) */
function vendorItemIdOf(inq: CallCenterInquiry): string {
  const v = inq.vendorItemId
  if (Array.isArray(v)) return v[0] != null ? String(v[0]) : ''
  return v != null ? String(v) : ''
}

/**
 * 행 조치 판정 (탭과 무관, 상태값 기준)
 * - answered → 완료
 * - requestAnswer(응답필요) + progress → 답변
 * - requestAnswer + complete → 확인(업체이관 확인 대상)
 */
function rowAction(inq: CallCenterInquiry): RowAction {
  const needs =
    inq.csPartnerCounselingStatus === 'requestAnswer' ||
    (inq.replies ?? []).some((r) => r.partnerTransferStatus === 'requestAnswer')
  if (!needs) return 'done'
  return inq.inquiryStatus === 'progress' ? 'reply' : 'confirm'
}

// ══════════════════════════════════════════════════════════════════
const CoupangInquiry: React.FC = () => {
  const [tab, setTab] = useState<TabKey>('reply')
  const [allRows, setAllRows] = useState<CallCenterInquiry[]>([])
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)

  const [drawer, setDrawer] = useState<{ mode: 'reply' | 'confirm'; inquiry: CallCenterInquiry } | null>(null)
  const [handled, setHandled] = useState<Map<number, '답변완료' | '확인완료'>>(new Map())

  // ── 주문정보 보강 (주문번호 → 등록상품명·옵션명·수취인·개수·금액·송장·배송상태) ──
  // orderId → OrderDetail | null 캐시 (탭/페이지 전환 간 재사용)
  const orderCacheRef = useRef<Map<string, OrderDetail | null>>(new Map())
  const [, setEnrichVersion] = useState(0) // 캐시 갱신 시 리렌더 트리거

  const replyByDefault = useMemo(() => {
    try {
      const saved = localStorage.getItem('cs_reply_by')
      if (saved) return saved
      const raw = localStorage.getItem('user')
      return raw ? (JSON.parse(raw)?.username ?? '') : ''
    } catch { return '' }
  }, [])

  // ── 데이터 로드 (전체 1회) ──────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setError(''); setProgress(''); setPage(1)
    try {
      const result = await fetchCallCenterInquiries30d('NONE', (done, total) => {
        setProgress(`조회 중... ${done}/${total} 구간`)
      })
      setAllRows(result)
    } catch (err: any) {
      console.error('[쿠팡문의] 조회 실패:', err)
      setError(`조회 실패: ${err?.message ?? err}`)
      setAllRows([])
    } finally { setLoading(false); setProgress('') }
  }, [])

  useEffect(() => { load() }, [load])

  // ── 탭별 클라이언트 필터 ────────────────────────────────────────
  const rows = useMemo(() => {
    if (tab === 'ALL') return allRows
    return allRows.filter((r) => rowAction(r) === tab)
  }, [allRows, tab])

  // 탭 변경 시 페이지 초기화
  useEffect(() => { setPage(1) }, [tab])

  // 탭별 건수 (배지)
  const counts = useMemo(() => {
    const c = { ALL: allRows.length, reply: 0, confirm: 0, done: 0 } as Record<TabKey, number>
    for (const r of allRows) c[rowAction(r)]++
    return c
  }, [allRows])

  // ── 페이지네이션 ────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const pageRows = useMemo(() => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [rows, page])

  // ── 답변/확인 ───────────────────────────────────────────────────
  const handleSubmitReply = useCallback(async (content: string, replyBy: string, parentAnswerId: number | string) => {
    const inq = drawer?.inquiry
    if (!inq) return
    await submitCallCenterReply(inq.inquiryId, content, replyBy, parentAnswerId)
    setHandled((prev) => new Map(prev).set(inq.inquiryId, '답변완료'))
  }, [drawer])

  const handleConfirm = useCallback(async (confirmBy: string) => {
    const inq = drawer?.inquiry
    if (!inq) return
    await confirmCallCenterInquiry(inq.inquiryId, confirmBy)
    setHandled((prev) => new Map(prev).set(inq.inquiryId, '확인완료'))
  }, [drawer])

  // ── 현재 페이지 행의 주문정보 보강 (주문번호 → 주문 상세 조회) ──
  useEffect(() => {
    if (pageRows.length === 0) return
    let cancelled = false

    ;(async () => {
      const orderIds = Array.from(
        new Set(pageRows.map((r) => orderIdOf(r)).filter(Boolean)),
      )
      if (orderIds.length === 0) return

      // 주문 상세 (캐시 미보유분만 조회)
      const missing = orderIds.filter((id) => !orderCacheRef.current.has(id))
      if (missing.length === 0) return
      const fetched = await fetchOrderDetailsMap(missing)
      if (cancelled) return
      for (const [id, d] of fetched) orderCacheRef.current.set(id, d)
      setEnrichVersion((v) => v + 1)
    })()

    return () => {
      cancelled = true
    }
  }, [pageRows])

  // ══════════════════════════════════════════════════════════════
  return (
    <div style={{ padding: '24px 28px' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h1 style={{ fontSize: theme.fontSize['3xl'], fontWeight: 700, color: theme.colors.textPrimary, margin: 0 }}>쿠팡문의</h1>
        <button
          onClick={load}
          disabled={loading}
          style={{ padding: '8px 16px', border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius.sm, background: theme.colors.bgCard, color: theme.colors.textPrimary, fontSize: theme.fontSize.sm, cursor: loading ? 'default' : 'pointer' }}
        >
          {loading ? '조회 중...' : '새로고침'}
        </button>
      </div>

      {/* 탭 */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: `1px solid ${theme.colors.border}`, marginBottom: '20px' }}>
        {TABS.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              disabled={loading}
              style={{ padding: '10px 20px', border: 'none', borderBottom: active ? `2px solid ${theme.colors.primary}` : '2px solid transparent', background: 'transparent', color: active ? theme.colors.primary : theme.colors.textSecondary, fontSize: theme.fontSize.base, fontWeight: active ? 700 : 500, cursor: loading ? 'default' : 'pointer', marginBottom: '-1px' }}
            >
              {t.label}{!loading && allRows.length > 0 ? ` (${counts[t.key]})` : ''}
            </button>
          )
        })}
      </div>

      {/* 조회 조건 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', fontSize: theme.fontSize.sm, color: theme.colors.textSecondary }}>
        <span style={{ padding: '4px 12px', borderRadius: theme.radius.full, border: `1px solid ${theme.colors.border}`, background: theme.colors.bgTableHeader }}>등록일: 지난 30일</span>
        <span>총 <strong style={{ color: theme.colors.textPrimary }}>{rows.length}</strong>개</span>
      </div>

      {error && (
        <div style={{ ...theme.card, padding: '16px 20px', marginBottom: '16px', borderLeft: `3px solid ${theme.colors.danger}`, color: theme.colors.danger, fontSize: theme.fontSize.sm }}>{error}</div>
      )}

      {/* 테이블 */}
      <div style={{ ...theme.table.container }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={theme.table.thead}>
            <tr>
              <th style={{ ...theme.table.th, width: '130px' }}>등록일시</th>
              <th style={theme.table.th}>문의내용</th>
              <th style={{ ...theme.table.th, width: '150px' }}>주문번호</th>
              <th style={{ ...theme.table.th, width: '130px' }}>고객전화</th>
              <th style={{ ...theme.table.th, width: '110px', textAlign: 'center' }}>답변여부</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ ...theme.table.td, textAlign: 'center', padding: '40px', color: theme.colors.textSecondary }}>{progress || '데이터를 조회하는 중...'}</td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={5} style={{ ...theme.table.td, textAlign: 'center', padding: '40px', color: theme.colors.textMuted }}>조회된 문의가 없습니다.</td></tr>
            ) : (
              pageRows.map((r) => {
                const { date, time } = formatInquiryAt(r.inquiryAt)
                const done = handled.get(r.inquiryId)
                const action = rowAction(r)
                return (
                  <tr key={r.inquiryId} style={theme.table.tr}>
                    <td style={theme.table.td}>
                      <div>{date}</div>
                      <div style={{ fontSize: theme.fontSize.xs, color: theme.colors.textMuted }}>{time}</div>
                    </td>
                    <td style={theme.table.td}>
                      <OrderInfoLine
                        orderId={orderIdOf(r)}
                        vendorItemId={vendorItemIdOf(r)}
                        detail={orderIdOf(r) ? orderCacheRef.current.get(orderIdOf(r)) : null}
                        fallbackName={r.itemName || '상품정보 없음'}
                      />
                      {r.receiptCategory && <div style={{ fontSize: theme.fontSize.xs, color: theme.colors.textMuted, marginBottom: 2 }}>{r.receiptCategory}</div>}
                      <div style={{ color: theme.colors.textPrimary }}>{r.content}</div>
                    </td>
                    <td style={{ ...theme.table.td, color: theme.colors.primary }}>{r.orderId ?? '-'}</td>
                    <td style={theme.table.td}>{r.buyerPhone || '-'}</td>
                    <td style={{ ...theme.table.td, textAlign: 'center' }}>
                      {done ? (
                        // 이번 세션 처리 완료 → 클릭 시 재열람 (완료 상태로 표시)
                        <button type="button" onClick={() => setDrawer({ mode: done === '확인완료' ? 'confirm' : 'reply', inquiry: r })} style={outlineBtnStyle(theme.colors.success)}>✓ {done}</button>
                      ) : action === 'reply' ? (
                        <button type="button" onClick={() => setDrawer({ mode: 'reply', inquiry: r })} style={outlineBtnStyle(theme.colors.primary)}>답변하기</button>
                      ) : action === 'confirm' ? (
                        <button type="button" onClick={() => setDrawer({ mode: 'confirm', inquiry: r })} style={outlineBtnStyle(theme.colors.warning)}>확인</button>
                      ) : (
                        // 서버 답변완료 → 클릭 시 재열람
                        <button type="button" onClick={() => setDrawer({ mode: 'reply', inquiry: r })} style={outlineBtnStyle(theme.colors.success)}>✓ 답변완료</button>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {!loading && rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '16px' }}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={pagerBtnStyle(page <= 1)}>이전</button>
          <span style={{ fontSize: theme.fontSize.sm, color: theme.colors.textSecondary }}>{page} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={pagerBtnStyle(page >= totalPages)}>다음</button>
        </div>
      )}

      {/* 드로어 */}
      <CoupangInquiryDrawer
        open={drawer !== null}
        mode={drawer?.mode ?? null}
        inquiry={drawer?.inquiry ?? null}
        replyByDefault={replyByDefault}
        alreadyHandled={
          drawer
            ? (handled.get(drawer.inquiry.inquiryId) ?? (rowAction(drawer.inquiry) === 'done' ? '답변완료' : null))
            : null
        }
        onSubmitReply={handleSubmitReply}
        onConfirm={handleConfirm}
        onClose={() => setDrawer(null)}
      />
    </div>
  )
}

// ── 버튼 스타일 ────────────────────────────────────────────────────
function outlineBtnStyle(color: string): React.CSSProperties {
  return { padding: '5px 10px', border: `1px solid ${color}`, borderRadius: theme.radius.sm, background: theme.colors.bgCard, color, fontSize: theme.fontSize.xs, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }
}
function pagerBtnStyle(disabled: boolean): React.CSSProperties {
  return { padding: '6px 16px', border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius.sm, background: theme.colors.bgCard, color: disabled ? theme.colors.textMuted : theme.colors.textPrimary, fontSize: theme.fontSize.sm, cursor: disabled ? 'default' : 'pointer' }
}

export default CoupangInquiry
