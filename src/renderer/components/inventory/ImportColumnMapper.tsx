// ═══════════════════════════════════════════════════════════════════
// ImportColumnMapper — [엑셀 추가] ③ 열 선택 + 미리 보기
//   - 두 가지로 고른다
//     ① 미리 보기의 열(열 문자 · 머리글 칸)을 누르면 다음 빈 역할에 지정
//        (위치 → 바코드 → 수량 → 상품명 → 옵션명 순), 고른 열을 다시 누르면 해제
//     ② 역할마다 "A · 머리글" 목록에서 직접 고르기
//   - 미리 보기: 머리글 행 + 데이터 앞 몇 행, 모든 열 (가로 스크롤 — 마우스로 끌어서도 움직인다)
//     엑셀 열 문자 · 실제 엑셀 행 번호를 보여 주고 고른 열은 파랑 한 톤 + 역할 배지
//   - 색은 파랑 하나만 쓴다 (역할마다 색을 나누지 않는다). 빨강은 모순(같은 열 두 역할)만
// ═══════════════════════════════════════════════════════════════════

import React, { useMemo } from 'react'
import {
  STOCK_IMPORT_ROLE_LABELS,
  cellText,
  columnLetter,
  excelRowNumber,
  isBlankCell,
  isRequiredRole,
  rolesForMode,
  type ExcelSheetData,
  type StockImportError,
  type StockImportMapping,
  type StockImportMode,
  type StockImportRole,
} from '../../services/stockImportService'
import { useDragScroll } from '../../hooks/useDragScroll'

// ── 상수 ──────────────────────────────────────────────────────────
/** 미리 보기 데이터 행 수 (빈 행은 건너뜀) */
const PREVIEW_DATA_ROWS = 5
/** select 의 '선택 안 함' 값 */
const NONE_VALUE = ''

const roleLabel = (role: StockImportRole) => STOCK_IMPORT_ROLE_LABELS[role]

interface ImportColumnMapperProps {
  sheet: ExcelSheetData
  headerRowIndex: number
  mapping: StockImportMapping
  mode: StockImportMode
  /** 아직 고르지 않은 필수 역할 — 안내로만 보여 준다 */
  missingRoles: StockImportRole[]
  /** 고른 열의 모순 (같은 열 두 역할 · 범위 밖) — 오류로 보여 준다 */
  mappingErrors: StockImportError[]
  /** 미리 보기에서 열을 누르면 채워질 역할 (모두 골랐으면 null) */
  nextRole: StockImportRole | null
  disabled: boolean
  onChange: (role: StockImportRole, col: number | null) => void
  onToggleColumn: (col: number) => void
  onClear: () => void
}

const ImportColumnMapper: React.FC<ImportColumnMapperProps> = ({
  sheet, headerRowIndex, mapping, mode, missingRoles, mappingErrors, nextRole, disabled,
  onChange, onToggleColumn, onClear,
}) => {
  const roles = useMemo(() => rolesForMode(mode), [mode])
  const previewScrollRef = useDragScroll<HTMLDivElement>()
  const headerRow = sheet.rows[headerRowIndex] ?? []
  const columns = useMemo(
    () => Array.from({ length: sheet.columnCount }, (_, i) => i),
    [sheet.columnCount],
  )
  const hasAnyMapped = roles.some(role => mapping[role] !== null)

  // ── 열 → 역할 (이 모드에서 쓰는 역할만) ──
  const rolesByColumn = useMemo(() => {
    const map = new Map<number, StockImportRole[]>()
    for (const role of roles) {
      const col = mapping[role]
      if (col !== null) map.set(col, [...(map.get(col) ?? []), role])
    }
    return map
  }, [roles, mapping])

  // ── 미리 보기 데이터 행 (머리글 아래 빈 행이 아닌 앞쪽 행) ──
  const previewRows = useMemo(() => {
    const out: number[] = []
    for (let r = headerRowIndex + 1; r < sheet.rows.length && out.length < PREVIEW_DATA_ROWS; r++) {
      if (!sheet.rows[r].every(isBlankCell)) out.push(r)
    }
    return out
  }, [sheet, headerRowIndex])

  const optionLabel = (col: number) => {
    const header = cellText(headerRow[col]).trim()
    return `${columnLetter(sheet, col)} · ${header || '(빈 머리글)'}`
  }

  // ── 열 누르기 (열 문자 칸 · 머리글 칸) ──
  const clickable = (col: number) => !disabled && (rolesByColumn.has(col) || nextRole !== null)
  const clickTitle = (col: number) => {
    const colRoles = rolesByColumn.get(col)
    if (colRoles) return `눌러서 '${colRoles.map(roleLabel).join(' · ')}' 선택 해제`
    return nextRole ? `눌러서 '${roleLabel(nextRole)}' 열로 지정` : undefined
  }
  const clickProps = (col: number) => clickable(col)
    ? {
        role: 'button' as const,
        tabIndex: 0,
        title: clickTitle(col),
        onClick: () => onToggleColumn(col),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggleColumn(col)
          }
        },
      }
    : {}
  const colClass = (col: number) =>
    [rolesByColumn.has(col) ? 'is-mapped' : '', clickable(col) ? 'is-clickable' : ''].filter(Boolean).join(' ')
  /** 머리글 칸은 잘려 보일 수 있어 전체 글자를 먼저, 누를 수 있으면 할 일을 뒤에 */
  const headerCellTitle = (col: number) => {
    const text = cellText(headerRow[col])
    const action = clickable(col) ? clickTitle(col) : undefined
    return action ? (text ? `${text} — ${action}` : action) : text
  }

  return (
    <div>
      {/* ── 역할별 열 고르기 (목록) ──────────────────────── */}
      <div className="sxi-map-grid">
        {roles.map(role => {
          const required = isRequiredRole(role)
          const value = mapping[role]
          const isNext = !disabled && role === nextRole
          return (
            <label key={role} className={`sxi-map-field${isNext ? ' is-next' : ''}`}>
              <span className="sxi-map-label">
                {roleLabel(role)}
                <em className="sxi-role-kind">{required ? '필수' : '선택'}</em>
                {isNext && <em className="sxi-next-tag">다음</em>}
              </span>
              <select
                className="sxi-select"
                value={value === null ? NONE_VALUE : String(value)}
                disabled={disabled}
                onChange={e => onChange(role, e.target.value === NONE_VALUE ? null : Number(e.target.value))}
              >
                <option value={NONE_VALUE}>{required ? '— 열을 고르세요 —' : '선택 안 함'}</option>
                {columns.map(col => (
                  <option key={col} value={String(col)}>{optionLabel(col)}</option>
                ))}
              </select>
            </label>
          )
        })}
      </div>

      {mappingErrors.length > 0 && (
        <ul className="sxi-map-errors">
          {mappingErrors.map((err, i) => (
            <li key={i}>{err.column ? `${err.column} 열 — ` : ''}{err.reason}</li>
          ))}
        </ul>
      )}

      {/* ── 안내 줄: 다음에 누를 열 · 남은 필수 | 선택 초기화 ── */}
      <div className="sxi-map-guide">
        <span className="sxi-map-guide-text">
          {nextRole && isRequiredRole(nextRole) ? (
            <>아래 표에서 <b>{roleLabel(nextRole)}</b> 열의 머리글을 누르세요</>
          ) : nextRole ? (
            <>필수 열은 모두 골랐습니다 · <b>{roleLabel(nextRole)}</b> 열이 있으면 머리글을 누르세요 (선택)</>
          ) : (
            <>열을 모두 골랐습니다 · 고른 열을 다시 누르면 해제됩니다</>
          )}
          {missingRoles.length > 0 && (
            <span className="sxi-muted"> — 남은 필수: {missingRoles.map(roleLabel).join(' · ')}</span>
          )}
        </span>
        <button
          type="button"
          className="sxi-link-btn"
          onClick={onClear}
          disabled={disabled || !hasAnyMapped}
          title="열 선택을 모두 지우고 위치부터 다시 고르기"
        >
          선택 초기화
        </button>
      </div>

      {/* ── 미리 보기 ─────────────────────────────────────── */}
      <div className="sxi-preview-wrap" ref={previewScrollRef}>
        <table className="sxi-preview">
          <thead>
            <tr>
              <th className="sxi-preview-corner" />
              {columns.map(col => (
                <th key={col} className={colClass(col)} {...clickProps(col)}>
                  <span className="sxi-col-letter">{columnLetter(sheet, col)}</span>
                  {rolesByColumn.get(col)?.map(role => (
                    <span key={role} className="sxi-role-badge">{roleLabel(role)}</span>
                  ))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="sxi-preview-header-row">
              <td className="sxi-row-num">{excelRowNumber(sheet, headerRowIndex)}</td>
              {columns.map(col => (
                <td key={col} className={colClass(col)} {...clickProps(col)} title={headerCellTitle(col)}>
                  {cellText(headerRow[col])}
                </td>
              ))}
            </tr>
            {previewRows.map(r => (
              <tr key={r}>
                <td className="sxi-row-num">{excelRowNumber(sheet, r)}</td>
                {columns.map(col => (
                  <td key={col} className={rolesByColumn.has(col) ? 'is-mapped' : ''} title={cellText(sheet.rows[r][col])}>
                    {cellText(sheet.rows[r][col])}
                  </td>
                ))}
              </tr>
            ))}
            {previewRows.length === 0 && (
              <tr>
                <td className="sxi-row-num" />
                <td className="sxi-preview-empty" colSpan={Math.max(columns.length, 1)}>머리글 아래에 데이터 행이 없습니다</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default ImportColumnMapper
