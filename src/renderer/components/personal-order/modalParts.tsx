/* ================================================================
   개인주문 작업 모달 공용 부품 — DeliveryInstructModal([배송준비]) · ShipmentStopModal([출고중지])
   - 요약 칸(Stat) · 제목 + 스크롤 표(ListSection) · 표 머리글/칸 스타일 · 진행 막대 · 주의 안내 색
   - 색·둥글기는 theme 토큰. 두 모달의 모양을 맞추려고 한곳에 둔다.
   ================================================================ */

import React from 'react'
import { theme } from '../../styles/theme'

// ── 화면 상수 ─────────────────────────────────────────────────────
/** 목록 표 최대 높이 (넘으면 표 안에서 스크롤) */
const LIST_MAX_HEIGHT = 220

/** 주의 안내 배경 · 테두리 (앰버) */
export const WARNING_BG = '#FFFBEB'
export const WARNING_BORDER = '#FCD34D'

// ══════════════════════════════════════════════════════════════════
// 요약 칸 (라벨 + 큰 숫자)
// ══════════════════════════════════════════════════════════════════

export const Stat: React.FC<{ label: string; value: React.ReactNode; color?: string }> = ({ label, value, color }) => (
  <div style={{ flex: 1, minWidth: 0, padding: '8px 10px', border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius.md, background: theme.colors.bgCard }}>
    <div style={{ fontSize: 11.5, color: theme.colors.textSecondary }}>{label}</div>
    <div style={{ fontSize: 16, fontWeight: 600, color: color ?? theme.colors.textPrimary, marginTop: 2 }}>{value}</div>
  </div>
)

// ══════════════════════════════════════════════════════════════════
// 목록 표 — 머리글 · 칸 공통 스타일 + 제목이 붙은 스크롤 표
// ══════════════════════════════════════════════════════════════════

export const listTh: React.CSSProperties = {
  position: 'sticky', top: 0, background: theme.colors.bgTableHeader, textAlign: 'left',
  fontSize: 11.5, fontWeight: 600, color: theme.colors.textSecondary, padding: '5px 8px',
  borderBottom: `1px solid ${theme.colors.border}`, whiteSpace: 'nowrap',
}

export const listTd: React.CSSProperties = {
  fontSize: 11.5, color: theme.colors.textPrimary, padding: '4px 8px',
  borderBottom: `1px solid ${theme.colors.borderLight}`, verticalAlign: 'top',
}

/** 제목 + 스크롤 표 (children = thead · tbody) */
export const ListSection: React.FC<{ title: string; color: string; children: React.ReactNode }> = ({ title, color, children }) => (
  <div style={{ marginTop: 12 }}>
    <div style={{ fontSize: 12.5, fontWeight: 600, color, marginBottom: 4 }}>{title}</div>
    <div style={{ maxHeight: LIST_MAX_HEIGHT, overflowY: 'auto', border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius.sm }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>{children}</table>
    </div>
  </div>
)

// ══════════════════════════════════════════════════════════════════
// 진행 막대 (완료 / 전체)
// ══════════════════════════════════════════════════════════════════

export const ProgressBar: React.FC<{ done: number; total: number }> = ({ done, total }) => {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      style={{ height: 8, borderRadius: theme.radius.full, background: theme.colors.borderLight, overflow: 'hidden' }}
    >
      <div style={{ width: `${percent}%`, height: '100%', background: theme.colors.primary, transition: 'width 0.2s' }} />
    </div>
  )
}
