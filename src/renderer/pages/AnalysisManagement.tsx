/* ================================================================
   분석관리 (AnalysisManagement) — 사입관리 데이터 통합 요약
   - 사입관리(purchase-management) 페이지의 컬럼 정보를 집계해
     한눈에 보는 요약 대시보드로 제공한다.
   - 집계 로직은 services/analysisService.ts 로 분리.
   ================================================================ */

import React, { useCallback, useEffect, useState } from 'react'
import { theme } from '../styles/theme'
import { fetchAnalysisSummary, type AnalysisSummary } from '../services/analysisService'

// ── 사용자 ID (localStorage) ──────────────────────────────────────
const getUserId = (): string | null => {
  const raw = localStorage.getItem('user')
  if (!raw) return null
  try {
    return JSON.parse(raw)?.id ?? null
  } catch {
    return null
  }
}

// ── 숫자 포맷 (천단위 콤마) ────────────────────────────────────────
const fmt = (n: number): string => n.toLocaleString()

// ══════════════════════════════════════════════════════════════════
// 요약 카드 — 단일 지표 표시
// ══════════════════════════════════════════════════════════════════

const SummaryCard: React.FC<{
  label: string
  value: string
  sub?: string
  accent?: string
}> = ({ label, value, sub, accent }) => (
  <div
    style={{
      ...theme.card,
      padding: '18px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      borderTop: `3px solid ${accent ?? theme.colors.primary}`,
    }}
  >
    <span style={{ fontSize: theme.fontSize.sm, color: theme.colors.textSecondary }}>
      {label}
    </span>
    <span style={{ fontSize: theme.fontSize['3xl'], fontWeight: 700, color: theme.colors.textPrimary }}>
      {value}
    </span>
    {sub && (
      <span style={{ fontSize: theme.fontSize.xs, color: theme.colors.textMuted }}>{sub}</span>
    )}
  </div>
)

// ══════════════════════════════════════════════════════════════════
// 컴포넌트
// ══════════════════════════════════════════════════════════════════

const AnalysisManagement: React.FC = () => {
  const [summary, setSummary] = useState<AnalysisSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ── 데이터 로드 ─────────────────────────────────────────────────
  const load = useCallback(async () => {
    const userId = getUserId()
    if (!userId) {
      setError('로그인 정보를 확인해 주세요.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await fetchAnalysisSummary(userId)
      setSummary(result)
    } catch (err: any) {
      console.error('[분석관리] 집계 실패:', err)
      setError(`집계 실패: ${err?.message ?? err}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div style={{ padding: '24px 28px' }}>
      {/* ── 헤더 ──────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '20px',
        }}
      >
        <h1 style={{ fontSize: theme.fontSize['3xl'], fontWeight: 700, color: theme.colors.textPrimary, margin: 0 }}>
          분석관리
        </h1>
        <button
          onClick={load}
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
          {loading ? '집계 중...' : '새로고침'}
        </button>
      </div>

      <p style={{ fontSize: theme.fontSize.sm, color: theme.colors.textSecondary, marginTop: 0, marginBottom: '20px' }}>
        사입관리 데이터를 통합해 컬럼별 총합을 요약합니다.
        {summary && <> (대상 아이템 {fmt(summary.itemCount)}개)</>}
      </p>

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

      {loading && !summary ? (
        <div style={{ padding: '40px', textAlign: 'center', color: theme.colors.textSecondary }}>
          데이터를 집계하는 중...
        </div>
      ) : summary ? (
        <>
          {/* ── 재고/주문 요약 ─────────────────────────────────── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '14px',
              marginBottom: '24px',
            }}
          >
            <SummaryCard label="주문 (order_qty)" value={fmt(summary.orderQtyTotal)} accent={theme.colors.primary} />
            <SummaryCard label="C.in (입고예정)" value={fmt(summary.cInTotal)} accent={theme.colors.info} />
            <SummaryCard label="C.재고 (주문가능)" value={fmt(summary.cStockTotal)} accent={theme.colors.info} />
            <SummaryCard label="창고 재고" value={fmt(summary.warehouseTotal)} accent={theme.colors.success} />
          </div>

          {/* ── 판매량 요약 ───────────────────────────────────── */}
          <h2 style={{ fontSize: theme.fontSize.lg, fontWeight: 600, color: theme.colors.textPrimary, margin: '0 0 12px' }}>
            판매량
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '14px',
              marginBottom: '24px',
            }}
          >
            <SummaryCard label="7일 판매량" value={fmt(summary.sales7dTotal)} accent={theme.colors.warning} />
            <SummaryCard label="30일 판매량" value={fmt(summary.sales30dTotal)} accent={theme.colors.warning} />
          </div>

          {/* ── 조회수(V1~V5) 요약 ─────────────────────────────── */}
          <h2 style={{ fontSize: theme.fontSize.lg, fontWeight: 600, color: theme.colors.textPrimary, margin: '0 0 12px' }}>
            조회수 (V1~V5)
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: '14px',
              marginBottom: '24px',
            }}
          >
            {summary.viewDateTotals.length === 0 ? (
              <div style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.sm }}>조회수 데이터가 없습니다.</div>
            ) : (
              summary.viewDateTotals.map((v, idx) => (
                <SummaryCard
                  key={v.date}
                  label={`V${idx + 1}`}
                  value={fmt(v.total)}
                  sub={v.date}
                  accent={theme.colors.secondary}
                />
              ))
            )}
            <SummaryCard label="V1~V5 합계" value={fmt(summary.viewGrandTotal)} accent={theme.colors.primary} />
          </div>

          {/* ── 보관료 요약 ───────────────────────────────────── */}
          <h2 style={{ fontSize: theme.fontSize.lg, fontWeight: 600, color: theme.colors.textPrimary, margin: '0 0 12px' }}>
            보관료
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '14px',
            }}
          >
            <SummaryCard
              label="보관료 총액"
              value={`${fmt(summary.storageFeeTotal)} 원`}
              accent={theme.colors.danger}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}

export default AnalysisManagement
