// ═══════════════════════════════════════════════════════════════════
// StockExcelImportModal — 재고관리 [엑셀 추가] (추가 · 차감)
//   ① 파일 → ② 시트 · 머리글 행 → ③ 열 선택 + 미리 보기 → ④ 자동 검사 → 실행 → 결과
//   - 앞 단계가 끝나야 다음 단계가 켜진다
//   - 실행 중에는 닫을 수 없다 (Esc · 바깥 클릭 · 버튼 모두)
//   - 상태는 useStockExcelImport, 규칙은 services/stockImportService.ts
//   - 스타일은 StockExcelImport.css (.sxi-), 버튼은 purchase-btn
// ═══════════════════════════════════════════════════════════════════

import React, { useEffect, useRef } from 'react'
import './StockExcelImport.css'
import ExcelDropZone from './ExcelDropZone'
import ImportColumnMapper from './ImportColumnMapper'
import ImportCheckResult from './ImportCheckResult'
import { useStockExcelImport } from './useStockExcelImport'
import { cellText, excelRowNumber, type StockImportMode } from '../../services/stockImportService'

// ── 상수 ──────────────────────────────────────────────────────────
/** 머리글 선택지에 붙일 행 내용 미리 보기 칸 수 */
const HEADER_CHOICE_PREVIEW_CELLS = 4

const MODE_OPTIONS: { value: StockImportMode; label: string; desc: string }[] = [
  { value: 'add', label: '추가', desc: '엑셀 수량을 재고에 더합니다. 재고에 없는 위치 + 바코드는 새로 만듭니다.' },
  { value: 'deduct', label: '차감', desc: '엑셀 수량만큼 재고에서 뺍니다. 없는 행이나 모자란 행이 하나라도 있으면 실행할 수 없습니다.' },
]

const n = (v: number) => v.toLocaleString()

// ── 단계 틀 ────────────────────────────────────────────────────────
const Step: React.FC<{ no: string; title: string; hint?: string; disabled?: boolean; children: React.ReactNode }> = ({
  no, title, hint, disabled, children,
}) => (
  <section className={`sxi-section${disabled ? ' is-disabled' : ''}`} aria-disabled={disabled || undefined}>
    <div className="sxi-section-head">
      <span className="sxi-step">{no}</span>
      <span className="sxi-section-title">{title}</span>
      {hint && <span className="sxi-section-hint">{hint}</span>}
    </div>
    {children}
  </section>
)

// ══════════════════════════════════════════════════════════════════
// 메인
// ══════════════════════════════════════════════════════════════════

interface StockExcelImportModalProps {
  /** changed = DB 에 쓴 것이 있어 목록을 다시 읽어야 함 */
  onClose: (changed: boolean) => void
}

const StockExcelImportModal: React.FC<StockExcelImportModalProps> = ({ onClose }) => {
  const im = useStockExcelImport()
  const closable = !im.running
  const overlayDown = useRef(false)

  // 파일을 올려 열까지 맞춘 뒤 바깥 클릭·Esc 로 실수로 닫으면 처음부터 다시 해야 하므로 묻는다
  const close = () => {
    if (!closable) return
    const losesWork = !!im.file && im.phase === 'edit'
    if (losesWork && !window.confirm('창을 닫을까요? 올린 파일과 열 선택이 사라집니다.')) return
    onClose(im.changed)
  }

  // ── Esc 로 닫기 (실행 중 제외) ──
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const editing = im.phase === 'edit'
  const sheet = im.sheet
  const hasFile = !!im.file && im.sheets.length > 0
  const hasRows = !!sheet && sheet.rows.length > 0
  const modeLabel = im.mode === 'add' ? '추가' : '차감'

  return (
    <div
      className="sxi-overlay"
      onMouseDown={e => { overlayDown.current = e.target === e.currentTarget }}
      onClick={e => { if (overlayDown.current && e.target === e.currentTarget) close() }}
    >
      <div className="sxi-modal" role="dialog" aria-modal="true" aria-labelledby="sxi-title">
        {/* ── 머리 ──────────────────────────────────────────── */}
        <div className="sxi-head">
          <div className="sxi-head-row">
            <h3 id="sxi-title" className="sxi-title">엑셀 추가</h3>
            <div className="sxi-segment" role="radiogroup" aria-label="작업 종류">
              {MODE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={im.mode === opt.value}
                  className={`sxi-segment-btn${im.mode === opt.value ? ' is-active' : ''}${opt.value === 'deduct' ? ' is-deduct' : ''}`}
                  disabled={!editing}
                  onClick={() => im.setMode(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button type="button" className="sxi-close" onClick={close} disabled={!closable} aria-label="닫기">×</button>
          </div>
          <p className="sxi-desc">{MODE_OPTIONS.find(o => o.value === im.mode)?.desc}</p>
        </div>

        {/* ── 본문 ──────────────────────────────────────────── */}
        <div className="sxi-body">
          {im.phase === 'done' && im.result ? (
            <ResultView mode={im.mode} result={im.result} />
          ) : (
            <>
              <Step no="①" title="파일">
                <ExcelDropZone
                  fileName={im.file?.name ?? null}
                  fileSize={im.file?.size ?? null}
                  reading={im.reading}
                  disabled={!editing}
                  onFile={f => void im.loadFile(f)}
                />
                {im.readError && <div className="sxi-inline-error">{im.readError}</div>}
              </Step>

              <Step no="②" title="시트" hint="머리글 행 아래가 데이터입니다" disabled={!hasFile}>
                <div className="sxi-sheet-row">
                  <label className="sxi-field">
                    <span className="sxi-field-label">시트</span>
                    <select
                      className="sxi-select"
                      value={im.sheetIndex}
                      disabled={!hasFile || !editing}
                      onChange={e => im.selectSheet(Number(e.target.value))}
                    >
                      {im.sheets.map((s, i) => (
                        <option key={`${i}-${s.name}`} value={i}>
                          {s.name}{s.rows.length === 0 ? ' (비어 있음)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="sxi-field">
                    <span className="sxi-field-label">머리글 행</span>
                    <select
                      className="sxi-select"
                      value={im.headerRowIndex}
                      disabled={!hasRows || !editing}
                      onChange={e => im.selectHeaderRow(Number(e.target.value))}
                    >
                      {sheet && im.headerChoices.map(r => (
                        <option key={r} value={r}>
                          {excelRowNumber(sheet, r)}행 — {sheet.rows[r]
                            .map(v => cellText(v).trim())
                            .filter(Boolean)
                            .slice(0, HEADER_CHOICE_PREVIEW_CELLS)
                            .join(' · ')}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {hasFile && !hasRows && <div className="sxi-inline-error">이 시트에는 값이 없습니다 — 다른 시트를 고르세요</div>}
              </Step>

              <Step no="③" title="열 선택" hint="표의 머리글을 차례로 누르거나 목록에서 고르세요 · 실행하면 이 선택을 기억합니다" disabled={!hasRows}>
                {sheet && hasRows ? (
                  <ImportColumnMapper
                    sheet={sheet}
                    headerRowIndex={im.headerRowIndex}
                    mapping={im.mapping}
                    mode={im.mode}
                    missingRoles={im.missingRoles}
                    mappingErrors={im.mappingErrors}
                    nextRole={im.nextRole}
                    disabled={!editing}
                    onChange={im.setRoleColumn}
                    onToggleColumn={im.toggleColumn}
                    onClear={im.clearMapping}
                  />
                ) : (
                  <div className="sxi-placeholder">파일과 시트를 고르면 열을 고를 수 있습니다</div>
                )}
              </Step>

              <Step no="④" title="검사 결과" disabled={!im.mappingReady}>
                <ImportCheckResult mode={im.mode} check={im.check} staleMessage={im.staleMessage} onRecheck={im.recheck} />
              </Step>
            </>
          )}
        </div>

        {/* ── 진행 · 실행 오류 ─────────────────────────────────── */}
        {im.phase === 'running' && (
          <div className="sxi-progress">
            <div className="sxi-progress-text">
              저장 중… {n(im.progress.done)} / {n(im.progress.total)}건 — 끝날 때까지 창을 닫을 수 없습니다
            </div>
            <div className="sxi-progress-track">
              <div
                className="sxi-progress-bar"
                style={{ width: `${im.progress.total > 0 ? Math.round((im.progress.done / im.progress.total) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}
        {im.runError && <div className="sxi-run-error">{im.runError}</div>}

        {/* ── 바닥 ──────────────────────────────────────────── */}
        <div className="sxi-foot">
          <button type="button" className="purchase-btn" onClick={close} disabled={!closable}>
            {im.phase === 'done' ? '닫기' : '취소'}
          </button>
          {im.phase !== 'done' && (
            <button
              type="button"
              className={`purchase-btn sxi-btn-primary${im.mode === 'deduct' ? ' is-deduct' : ''}`}
              onClick={() => void im.execute()}
              disabled={!im.canExecute}
            >
              {/* 실행할 수 없을 때 건수를 0 으로 보이면 "할 일이 없다"로 읽히므로 건수를 숨긴다 */}
              {im.running ? '실행 중…' : im.canExecute ? `${modeLabel} 실행 (${n(im.opCount)}건)` : `${modeLabel} 실행`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// 결과 화면
// ══════════════════════════════════════════════════════════════════

const ResultView: React.FC<{
  mode: StockImportMode
  result: { created: number; updated: number; failedInserts: number; failedUpdates: number }
}> = ({ mode, result }) => {
  const failed = result.failedInserts + result.failedUpdates
  return (
    <div className="sxi-result">
      <div className={`sxi-result-title${failed > 0 ? ' is-warn' : ''}`}>
        {failed > 0 ? '일부를 저장하지 못했습니다' : mode === 'add' ? '추가를 마쳤습니다' : '차감을 마쳤습니다'}
      </div>
      <div className="sxi-stats">
        {mode === 'add' && (
          <div className="sxi-stat is-blue">
            <div className="sxi-stat-label">신규</div>
            <div className="sxi-stat-value">{n(result.created)}건</div>
          </div>
        )}
        <div className="sxi-stat is-blue">
          <div className="sxi-stat-label">수정</div>
          <div className="sxi-stat-value">{n(result.updated)}건</div>
        </div>
        <div className={`sxi-stat${failed > 0 ? ' is-red' : ' is-muted'}`}>
          <div className="sxi-stat-label">실패</div>
          <div className="sxi-stat-value">{n(failed)}건</div>
        </div>
      </div>
      {failed > 0 && (
        <div className="sxi-block is-danger">
          <div className="sxi-block-title">
            {[
              result.failedInserts > 0 ? `신규 ${n(result.failedInserts)}건` : '',
              result.failedUpdates > 0 ? `수량 수정 ${n(result.failedUpdates)}건` : '',
            ].filter(Boolean).join(' · ')}을 저장하지 못했습니다.
          </div>
          <div className="sxi-result-note">
            한 번에 모두 되돌리는 방식이 아니어서 성공한 묶음은 이미 저장됐습니다. 닫은 뒤 목록을 확인하고,
            남은 행만 엑셀로 다시 올려 주세요 (같은 파일을 그대로 올리면 성공한 행이 한 번 더 반영됩니다).
          </div>
        </div>
      )}
      <div className="sxi-result-note">[닫기] 를 누르면 지금 검색 조건으로 목록을 다시 읽습니다.</div>
    </div>
  )
}

export default StockExcelImportModal
