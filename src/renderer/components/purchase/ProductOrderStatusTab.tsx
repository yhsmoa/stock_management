/* ================================================================
   ProductOrderStatusTab — 상세 패널 [주문상황] 탭
   - 주문 프로젝트에 들어간 이 바코드의 구매주문 줄과 진행 단계를 보여 준다.
   - 기본은 '진행 중'(PROCESSING)만, [전체] 를 누르면 완료 줄도 함께.
   - 데이터는 useProductOrderStatus, 단계 규칙은 productOrderStatusService.
   ================================================================ */

import React, { useMemo, useState } from 'react'
import { theme } from '../../styles/theme'
import {
  ORDER_LINE_STAGE_LABELS,
  shipmentTypeLabel,
  type OrderLineStage,
  type ProductOrderLine,
} from '../../services/productOrderStatusService'
import { useProductOrderStatus } from './useProductOrderStatus'

// ── 단계 칩 색 (테두리형 — 진행 중 파랑 · 끝남 회색 · 취소 빨강) ──
const STAGE_COLORS: Record<OrderLineStage, string> = {
  waiting: theme.colors.textSecondary,
  partial: theme.colors.primary,
  arrived: theme.colors.primary,
  packed: theme.colors.primary,
  shipped: theme.colors.success,
  canceled: theme.colors.danger,
}

// ── 주문일 표기 (YYYY-MM-DD, 로컬 시간) ───────────────────────────
const formatDate = (iso: string): string => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('sv-SE')
}

// ── 스타일 ──────────────────────────────────────────────────────────
const styles = {
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
  },
  filterBtn: (active: boolean): React.CSSProperties => ({
    padding: '4px 12px',
    fontSize: theme.fontSize.sm,
    borderRadius: theme.radius.full,
    border: `1px solid ${active ? theme.colors.primary : theme.colors.border}`,
    background: active ? theme.colors.primaryLight : theme.colors.bgCard,
    color: active ? theme.colors.primary : theme.colors.textSecondary,
    cursor: 'pointer',
  }),
  reloadBtn: {
    marginLeft: 'auto',
    padding: '4px 10px',
    fontSize: theme.fontSize.sm,
    borderRadius: theme.radius.md,
    border: `1px solid ${theme.colors.border}`,
    background: theme.colors.bgCard,
    color: theme.colors.textSecondary,
    cursor: 'pointer',
  },
  summary: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginBottom: '12px',
    lineHeight: 1.5,
  },
  message: {
    padding: '32px 0',
    textAlign: 'center' as const,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  errorMsg: {
    padding: '12px',
    fontSize: theme.fontSize.sm,
    color: theme.colors.danger,
    background: theme.colors.dangerLight,
    borderRadius: theme.radius.md,
  },
  card: (done: boolean): React.CSSProperties => ({
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radius.lg,
    padding: '12px 14px',
    marginBottom: '10px',
    opacity: done ? 0.65 : 1,
  }),
  cardHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
    flexWrap: 'wrap' as const,
  },
  date: {
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.colors.textPrimary,
  },
  orderNo: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSecondary,
  },
  chip: (color: string): React.CSSProperties => ({
    fontSize: theme.fontSize.xs,
    padding: '1px 8px',
    borderRadius: theme.radius.full,
    border: `1px solid ${color}`,
    color,
    whiteSpace: 'nowrap',
  }),
  qtyRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    gap: '4px',
    textAlign: 'center' as const,
  },
  qtyLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },
  qtyValue: (emphasis: boolean): React.CSSProperties => ({
    fontSize: theme.fontSize.md,
    fontWeight: emphasis ? 700 : 500,
    color: emphasis ? theme.colors.primary : theme.colors.textPrimary,
  }),
  meta: {
    marginTop: '8px',
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSecondary,
    lineHeight: 1.6,
    wordBreak: 'break-all' as const,
  },
}

// ══════════════════════════════════════════════════════════════════
// 주문 줄 카드
// ══════════════════════════════════════════════════════════════════
const OrderLineCard: React.FC<{ line: ProductOrderLine }> = ({ line }) => {
  const qtys: { label: string; value: number; emphasis?: boolean }[] = [
    { label: '주문', value: line.orderQty },
    { label: '입고', value: line.arrival },
    { label: '취소', value: line.cancel },
    { label: '포장', value: line.packed },
    { label: '출고', value: line.shipped },
    { label: '남음', value: line.remaining, emphasis: line.isProcessing && line.remaining > 0 },
  ]

  return (
    <div style={styles.card(!line.isProcessing)}>
      {/* ── 머리: 주문일 · 단계 · 유형 · 진행/완료 ─────────────── */}
      <div style={styles.cardHead}>
        <span style={styles.date}>{formatDate(line.createdAt)}</span>
        <span style={styles.chip(STAGE_COLORS[line.stage])}>{ORDER_LINE_STAGE_LABELS[line.stage]}</span>
        <span style={styles.chip(theme.colors.textSecondary)}>{shipmentTypeLabel(line.shipmentType)}</span>
        {!line.isProcessing && <span style={styles.chip(theme.colors.textMuted)}>주문 완료</span>}
        <span style={{ ...styles.orderNo, marginLeft: 'auto' }}>{line.orderNo ?? '-'}</span>
      </div>

      {/* ── 수량 ──────────────────────────────────────────────── */}
      <div style={styles.qtyRow}>
        {qtys.map((q) => (
          <div key={q.label}>
            <div style={styles.qtyLabel}>{q.label}</div>
            <div style={styles.qtyValue(!!q.emphasis)}>{q.value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* ── 부가 정보: 품목번호 · 쉽먼트 · 개인주문번호 ──────────── */}
      <div style={styles.meta}>
        {line.itemNo && <div>품목 {line.itemNo}</div>}
        {line.shipmentNos.length > 0 && <div>쉽먼트 {line.shipmentNos.join(', ')}</div>}
        {line.personalOrderNo && <div>쿠팡 주문번호 {line.personalOrderNo}</div>}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// 탭 본체
// ══════════════════════════════════════════════════════════════════
interface ProductOrderStatusTabProps {
  barcode: string | null | undefined
  active: boolean   // 탭이 보일 때만 조회
}

const ProductOrderStatusTab: React.FC<ProductOrderStatusTabProps> = ({ barcode, active }) => {
  const { load, reload } = useProductOrderStatus(barcode, active)
  const [showAll, setShowAll] = useState(false)

  // ── 표시 대상 + 진행 중 요약 ────────────────────────────────────
  const { visible, processingCount, remainingSum, doneCount } = useMemo(() => {
    const lines = load.kind === 'ready' ? load.lines : []
    const processing = lines.filter((l) => l.isProcessing)
    return {
      visible: showAll ? lines : processing,
      processingCount: processing.length,
      remainingSum: processing.reduce((sum, l) => sum + l.remaining, 0),
      doneCount: lines.length - processing.length,
    }
  }, [load, showAll])

  if (!active) return null

  return (
    <div>
      {/* ── 툴바: 진행 중 / 전체 · 새로고침 ──────────────────────── */}
      <div style={styles.toolbar}>
        <button style={styles.filterBtn(!showAll)} onClick={() => setShowAll(false)}>
          진행 중 {load.kind === 'ready' ? processingCount : ''}
        </button>
        <button style={styles.filterBtn(showAll)} onClick={() => setShowAll(true)}>
          전체 {load.kind === 'ready' ? processingCount + doneCount : ''}
        </button>
        <button style={styles.reloadBtn} onClick={reload} disabled={load.kind === 'loading'}>
          새로고침
        </button>
      </div>

      {/* ── 상태별 본문 ──────────────────────────────────────────── */}
      {load.kind === 'idle' || load.kind === 'loading' ? (
        <div style={styles.message}>주문 내역을 불러오는 중...</div>
      ) : load.kind === 'unavailable' ? (
        <div style={styles.message}>{load.message}</div>
      ) : load.kind === 'error' ? (
        <div style={styles.errorMsg}>주문 내역을 불러오지 못했습니다: {load.message}</div>
      ) : (
        <>
          <div style={styles.summary}>
            진행 중 {processingCount.toLocaleString()}건 · 들어올 수량 {remainingSum.toLocaleString()}개
            <br />
            <span style={{ color: theme.colors.textMuted }}>
              모든 주문 유형 기준입니다. 표의 '주문' 열은 [주문] 조건(유형 · 출고일)을 따릅니다.
            </span>
          </div>
          {visible.length === 0 ? (
            <div style={styles.message}>
              {showAll ? '이 바코드로 들어간 주문이 없습니다.' : '진행 중인 주문이 없습니다.'}
            </div>
          ) : (
            visible.map((line) => <OrderLineCard key={line.id} line={line} />)
          )}
        </>
      )}
    </div>
  )
}

export default ProductOrderStatusTab
