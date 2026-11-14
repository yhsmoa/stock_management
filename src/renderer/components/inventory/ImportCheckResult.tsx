// ═══════════════════════════════════════════════════════════════════
// ImportCheckResult — [엑셀 추가] ④ 검사 결과
//   - 요약 숫자 · 실행을 막는 오류 목록 · 막지 않는 안내 · 작업 미리 보기
//   - 계획은 services/stockImportService.ts 의 planStockImport 결과 그대로
// ═══════════════════════════════════════════════════════════════════

import React from 'react'
import {
  type StockImportError,
  type StockImportMode,
  type StockImportPlan,
  type StockNameSource,
} from '../../services/stockImportService'
import type { ImportCheckState } from './useStockExcelImport'

// ── 상수 ──────────────────────────────────────────────────────────
/** 오류 목록에 그리는 최대 줄 수 (넘으면 '외 n건') */
const ERROR_DISPLAY_LIMIT = 200
/** 행 번호를 나열할 때 보여 줄 최대 개수 */
const ROW_NUMBER_DISPLAY_LIMIT = 12

const NAME_SOURCE_LABELS: Record<StockNameSource, string> = {
  coupang: '쿠팡 매칭',
  stock: '기존 재고',
  excel: '엑셀',
  none: '없음',
}

/** [3, 7, 9, …] → "3, 7, 9 외 4개" */
const formatRowNumbers = (rows: readonly number[]) => {
  if (rows.length === 0) return '-'
  const shown = rows.slice(0, ROW_NUMBER_DISPLAY_LIMIT).join(', ')
  return rows.length > ROW_NUMBER_DISPLAY_LIMIT ? `${shown} 외 ${rows.length - ROW_NUMBER_DISPLAY_LIMIT}개` : shown
}

const n = (v: number) => v.toLocaleString()

// ══════════════════════════════════════════════════════════════════
// 작은 부품
// ══════════════════════════════════════════════════════════════════

const Stat: React.FC<{ label: string; value: string; tone?: 'blue' | 'red' | 'muted' }> = ({ label, value, tone }) => (
  <div className={`sxi-stat${tone ? ` is-${tone}` : ''}`}>
    <div className="sxi-stat-label">{label}</div>
    <div className="sxi-stat-value">{value}</div>
  </div>
)

const ErrorTable: React.FC<{ errors: StockImportError[] }> = ({ errors }) => (
  <div className="sxi-block is-danger">
    <div className="sxi-block-title">
      실행할 수 없습니다 — 오류 {n(errors.length)}건 (엑셀을 고쳐 다시 올리거나 열 선택을 바꿔 주세요)
    </div>
    <div className="sxi-list-wrap">
      <table className="sxi-list">
        <thead>
          <tr>
            <th>엑셀 행</th>
            <th>열</th>
            <th>값</th>
            <th>사유</th>
          </tr>
        </thead>
        <tbody>
          {errors.slice(0, ERROR_DISPLAY_LIMIT).map((err, i) => (
            <tr key={i}>
              <td className="sxi-nowrap">{formatRowNumbers(err.rowNumbers)}</td>
              <td className="sxi-nowrap">{err.column ?? '-'}</td>
              <td className="sxi-cell-value" title={err.value}>{err.value || '(빈 칸)'}</td>
              <td>{err.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {errors.length > ERROR_DISPLAY_LIMIT && (
      <div className="sxi-more">외 {n(errors.length - ERROR_DISPLAY_LIMIT)}건 — 앞의 {ERROR_DISPLAY_LIMIT}건만 보여 줍니다</div>
    )}
  </div>
)

const Notices: React.FC<{ plan: StockImportPlan }> = ({ plan }) => {
  const { notices } = plan
  const items: React.ReactNode[] = []
  if (notices.zeroQtyRows.length > 0) {
    items.push(<>수량 0인 행 {n(notices.zeroQtyRows.length)}개는 제외합니다 (행 {formatRowNumbers(notices.zeroQtyRows)})</>)
  }
  if (notices.blankRowCount > 0) {
    items.push(<>고른 칸이 모두 빈 행 {n(notices.blankRowCount)}개는 건너뜁니다</>)
  }
  if (notices.mergedKeys.length > 0) {
    const rows = notices.mergedKeys.reduce((sum, k) => sum + k.rowNumbers.length, 0)
    items.push(<>같은 위치 + 바코드가 여러 행에 있는 {n(notices.mergedKeys.length)}건({n(rows)}행)은 수량을 합쳐서 처리합니다</>)
  }
  if (plan.mode === 'add' && notices.unnamedInserts > 0) {
    items.push(<>신규 {n(notices.unnamedInserts)}건은 상품명을 찾지 못해 이름 없이 만듭니다 (쿠팡 상품 · 기존 재고 · 엑셀 상품명 모두 없음)</>)
  }
  if (notices.duplicateStockKeys > 0) {
    items.push(<>재고에 같은 위치 + 바코드 행이 여러 개인 {n(notices.duplicateStockKeys)}건은 먼저 만든 행 하나만 고칩니다</>)
  }
  if (items.length === 0) return null
  return (
    <div className="sxi-block is-notice">
      <div className="sxi-block-title">안내</div>
      <ul className="sxi-notice-list">
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  )
}

const PreviewOps: React.FC<{ plan: StockImportPlan; total: number }> = ({ plan, total }) => {
  if (plan.preview.length === 0) return null
  const changeLabel = (kind: 'insert' | 'update') =>
    kind === 'insert' ? '신규' : plan.mode === 'add' ? '합산' : '차감'
  return (
    <div className="sxi-block">
      <div className="sxi-block-title">
        미리 보기 <span className="sxi-muted">— 앞 {plan.preview.length}건{total > plan.preview.length ? ` / 전체 ${n(total)}건` : ''}</span>
      </div>
      <div className="sxi-list-wrap">
        <table className="sxi-list">
          <thead>
            <tr>
              <th>행</th>
              <th>구분</th>
              <th>위치</th>
              <th>바코드</th>
              <th>상품명 / 옵션명</th>
              <th className="sxi-num">현재</th>
              <th className="sxi-num">변경 후</th>
            </tr>
          </thead>
          <tbody>
            {plan.preview.map(row => (
              <tr key={`${row.kind}-${row.rowNumber}-${row.barcode}`}>
                <td className="sxi-nowrap">{row.rowNumber}</td>
                <td className="sxi-nowrap">
                  <span className={`sxi-kind is-${row.kind === 'insert' ? 'insert' : plan.mode}`}>{changeLabel(row.kind)}</span>
                </td>
                <td className="sxi-nowrap">{row.location || '-'}</td>
                <td className="sxi-nowrap">{row.barcode}</td>
                <td className="sxi-cell-value" title={[row.item_name, row.option_name].filter(Boolean).join(' / ')}>
                  {row.item_name || <span className="sxi-muted">(이름 없음)</span>}
                  {row.option_name && <span className="sxi-muted"> / {row.option_name}</span>}
                </td>
                <td className="sxi-num">{row.kind === 'insert' ? '-' : n(row.currentQty)}</td>
                <td className="sxi-num sxi-strong">{n(row.nextQty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// 메인
// ══════════════════════════════════════════════════════════════════

interface ImportCheckResultProps {
  mode: StockImportMode
  check: ImportCheckState
  staleMessage: string | null
  onRecheck: () => void
}

const ImportCheckResult: React.FC<ImportCheckResultProps> = ({ mode, check, staleMessage, onRecheck }) => {
  if (check.status === 'error') {
    return (
      <div className="sxi-block is-danger">
        <div className="sxi-block-title">{check.error}</div>
        <button type="button" className="purchase-btn" onClick={onRecheck}>다시 검사</button>
      </div>
    )
  }
  const plan = check.plan
  if (!plan) {
    return <div className="sxi-placeholder">{check.status === 'checking' ? '검사 중…' : '열을 모두 고르면 자동으로 검사합니다'}</div>
  }

  const checking = check.status === 'checking' || plan.mode !== mode
  const { stats } = plan
  const total = stats.insertCount + stats.updateCount

  return (
    <div className={`sxi-check${checking ? ' is-checking' : ''}`}>
      {checking && <div className="sxi-checking-badge">검사 중…</div>}
      {staleMessage && <div className="sxi-stale">{staleMessage}</div>}

      {/* ── 요약 ── */}
      <div className="sxi-stats">
        <Stat label="처리할 행" value={`${n(stats.processRows)}행`} />
        {plan.mode === 'add' ? (
          <>
            <Stat label="신규" value={`${n(stats.insertCount)}건`} tone="blue" />
            <Stat label="합산" value={`${n(stats.updateCount)}건`} tone="blue" />
          </>
        ) : (
          <Stat label="차감" value={`${n(stats.updateCount)}건`} tone="blue" />
        )}
        <Stat label="총 수량" value={n(stats.totalQty)} />
        <Stat label="제외된 행" value={`${n(stats.excludedRows)}행`} tone="muted" />
        <Stat label="오류" value={`${n(plan.errors.length)}건`} tone={plan.errors.length > 0 ? 'red' : 'muted'} />
      </div>

      {plan.mode === 'add' && stats.insertCount > 0 && (
        <div className="sxi-sources">
          신규 상품명 출처 —{' '}
          {(Object.keys(NAME_SOURCE_LABELS) as StockNameSource[]).map((source, i) => (
            <span key={source}>
              {i > 0 && ' · '}
              {NAME_SOURCE_LABELS[source]} <strong>{n(stats.nameSources[source])}</strong>
            </span>
          ))}
        </div>
      )}

      {plan.errors.length > 0 && <ErrorTable errors={plan.errors} />}
      <Notices plan={plan} />
      {plan.errors.length === 0 && total === 0 && (
        <div className="sxi-placeholder">처리할 행이 없습니다</div>
      )}
      <PreviewOps plan={plan} total={total} />
    </div>
  )
}

export default ImportCheckResult
