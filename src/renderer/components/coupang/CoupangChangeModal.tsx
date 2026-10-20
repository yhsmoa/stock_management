/* ================================================================
   상품관리 — 변경 모달 (판매가 · 재고 · 할인율 기준가 · 판매 재개/중지)
   - 금액 지정 / % 올리기·내리기 / 원 더하기·빼기 → 10원 단위 정리 → 미리보기 → 적용
   - 쿠팡 규칙: 판매가는 한 번에 50% 초과 인하·100% 초과 인상 불가 (강제 적용 체크로 우회)
   ================================================================ */

import React, { useMemo, useState } from 'react'
import type { CoupangProductRow } from '../../types/coupangProduct'
import type { ChangeKind, ChangeTarget } from '../../services/coupangProductService'
import { CHANGE_KIND_LABELS } from '../../services/coupangProductService'
import { num, estimateDuration } from './format'
import { PRICE_UNIT, priceLimitViolation } from './priceRules'

interface Props {
  kind: ChangeKind
  rows: CoupangProductRow[]
  onApply: (targets: ChangeTarget[], force: boolean) => void
  onClose: () => void
}

type Mode = 'set' | 'percent' | 'delta'
type Rounding = 'floor' | 'round' | 'ceil'

function roundTo(value: number, unit: number, mode: Rounding): number {
  const q = value / unit
  const r = mode === 'floor' ? Math.floor(q) : mode === 'ceil' ? Math.ceil(q) : Math.round(q)
  return Math.max(0, r * unit)
}

const CoupangChangeModal: React.FC<Props> = ({ kind, rows, onApply, onClose }) => {
  const isValueKind = kind === 'price' || kind === 'quantity' || kind === 'originalPrice'
  const isMoney = kind === 'price' || kind === 'originalPrice'
  const [mode, setMode] = useState<Mode>(kind === 'quantity' ? 'set' : 'percent')
  const [input, setInput] = useState<string>(kind === 'price' ? '-10' : '')
  const [rounding, setRounding] = useState<Rounding>('floor')
  const [force, setForce] = useState(false)

  const current = (r: CoupangProductRow): number | null =>
    kind === 'price' ? r.price : kind === 'quantity' ? r.stock : kind === 'originalPrice' ? r.regular_price : null

  // ── 미리보기 ──
  const preview = useMemo(() => {
    const value = Number(input.replace(/,/g, ''))
    const valid = input.trim() !== '' && Number.isFinite(value)
    return rows.map((r) => {
      const before = current(r)
      let after: number | null = null
      let blocked: string | null = null

      if (!isValueKind) {
        if (kind === 'resume' && r.sales_status === '판매중') blocked = '이미 판매중'
        if (kind === 'stop' && r.sales_status === '판매중지') blocked = '이미 판매중지'
      } else if (!valid) {
        blocked = '값 없음'
      } else if (mode === 'set') {
        after = value
      } else if (before == null) {
        blocked = '현재 값 없음 — 금액 지정만 가능'
      } else if (mode === 'percent') {
        after = before * (1 + value / 100)
      } else {
        after = before + value
      }

      if (after != null) {
        after = isMoney ? roundTo(after, PRICE_UNIT, rounding) : Math.max(0, Math.round(after))
        if (!Number.isInteger(after) || after < 0) blocked = '값이 올바르지 않음'
        else if (kind === 'price' && after === 0) blocked = '판매가는 0원 불가'
        else if (kind === 'price' && !force) {
          const violation = priceLimitViolation(before, after)
          if (violation === 'down') blocked = '50% 넘게 인하 — 강제 적용 필요'
          else if (violation === 'up') blocked = '100% 넘게 인상 — 강제 적용 필요'
        }
        if (!blocked && before === after) blocked = '변경 없음'
      }
      return { row: r, before, after, blocked }
    })
  }, [rows, input, mode, rounding, force, kind, isValueKind, isMoney]) // eslint-disable-line react-hooks/exhaustive-deps

  const applicable = preview.filter((p) => !p.blocked)
  const needsForce = kind === 'price' && preview.some((p) => p.blocked?.includes('강제 적용'))

  const submit = () => {
    const targets: ChangeTarget[] = applicable.map((p) => ({ optionId: p.row.option_id, value: p.after ?? undefined }))
    onApply(targets, force)
  }

  return (
    <div className="cp-overlay" role="dialog" aria-modal="true" aria-labelledby="cp-change-title">
      <div className="cp-modal cp-modal-wide">
        <div>
          <h2 id="cp-change-title" className="cp-modal-title">{CHANGE_KIND_LABELS[kind]} · 옵션 {num(rows.length)}개</h2>
          <div className="cp-modal-desc">쿠팡에 적용된 옵션만 이 앱의 값도 바뀝니다. 실패한 옵션은 결과에 남습니다.</div>
        </div>

        {isValueKind && (
          <>
            <div className="cp-segment" role="radiogroup" aria-label="변경 방식">
              <button type="button" role="radio" aria-checked={mode === 'set'} className={mode === 'set' ? 'is-active' : ''} onClick={() => setMode('set')}>값 지정</button>
              <button type="button" role="radio" aria-checked={mode === 'percent'} className={mode === 'percent' ? 'is-active' : ''} onClick={() => setMode('percent')}>% 올리기 · 내리기</button>
              <button type="button" role="radio" aria-checked={mode === 'delta'} className={mode === 'delta' ? 'is-active' : ''} onClick={() => setMode('delta')}>{isMoney ? '원' : '개'} 더하기 · 빼기</button>
            </div>

            <div className="cp-field-row">
              <div className="cp-field">
                <label htmlFor="cp-change-value">{mode === 'set' ? (isMoney ? '금액' : '수량') : mode === 'percent' ? '변경률' : '변경량'}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    id="cp-change-value"
                    className="cp-input cp-input-num"
                    inputMode="decimal"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={mode === 'percent' ? '-10' : '0'}
                  />
                  <span style={{ color: '#4B5563' }}>{mode === 'percent' ? '%' : isMoney ? '원' : '개'}</span>
                </div>
              </div>
              {isMoney && (
                <div className="cp-field">
                  <div className="cp-section-label" id="cp-round-label">10원 단위 정리 (쿠팡 규칙)</div>
                  <div className="cp-segment" role="radiogroup" aria-labelledby="cp-round-label">
                    {(['floor', 'round', 'ceil'] as Rounding[]).map((r) => (
                      <button key={r} type="button" role="radio" aria-checked={rounding === r} className={rounding === r ? 'is-active' : ''} onClick={() => setRounding(r)}>
                        {r === 'floor' ? '내림' : r === 'round' ? '반올림' : '올림'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── 미리보기 ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="cp-section-label">미리보기</div>
          <div className="cp-preview cp-num">
            <div className="cp-preview-grid cp-preview-head">
              <div>옵션</div>
              <div className="cp-right">{isValueKind ? '지금' : '현재 상태'}</div>
              <div className="cp-right">{isValueKind ? '바꿀 값' : '바꿀 상태'}</div>
              <div className="cp-right">차이</div>
              <div>확인</div>
            </div>
            {preview.map(({ row, before, after, blocked }) => (
              <div key={row.option_id} className={`cp-preview-grid cp-preview-row${blocked ? ' is-blocked' : ''}`}>
                <div style={{ minWidth: 0 }}>
                  <div className="cp-ellipsis" style={{ fontWeight: 500 }} title={`${row.item_name ?? ''} · ${row.option_name ?? ''}`}>
                    {row.item_name ?? '—'} · {row.option_name ?? '—'}
                  </div>
                  <div className="cp-mono" style={{ fontSize: 11, color: '#6B7280' }}>{row.option_id}</div>
                </div>
                <div className="cp-right" style={{ color: '#4B5563' }}>{isValueKind ? num(before) : (row.sales_status ?? '미확인')}</div>
                <div className="cp-right" style={{ fontWeight: 600, color: blocked ? '#6B7280' : undefined }}>
                  {isValueKind ? (blocked ? '—' : num(after)) : (kind === 'resume' ? '판매중' : '판매중지')}
                </div>
                <div className="cp-right" style={{ color: '#4B5563' }}>
                  {isValueKind && !blocked && before != null && after != null ? (after - before >= 0 ? `+${num(after - before)}` : `−${num(before - after)}`) : '—'}
                </div>
                <div className={blocked ? 'cp-preview-warn' : 'cp-preview-ok'}>{blocked ?? '적용 가능'}</div>
              </div>
            ))}
          </div>
        </div>

        {kind === 'price' && (
          <div className="cp-callout">
            <div>쿠팡은 한 번에 <strong>50% 넘게 내리거나 100% 넘게 올리는</strong> 판매가 변경을 막습니다. 이 범위를 넘는 옵션은 아래를 켜야 적용됩니다.{needsForce ? ' (해당 옵션 있음)' : ''}</div>
            <label><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> 제한을 넘어도 적용 (강제 가격 변경)</label>
          </div>
        )}

        <div className="cp-modal-foot">
          <div className="cp-num" style={{ fontSize: 12, color: '#4B5563' }}>
            적용 {num(applicable.length)}개 · 제외 {num(preview.length - applicable.length)}개 · {estimateDuration(applicable.length)}
          </div>
          <div className="cp-modal-actions">
            <button type="button" className="cp-btn" onClick={onClose}>취소</button>
            <button type="button" className="cp-btn cp-btn-primary" disabled={applicable.length === 0} onClick={submit}>
              쿠팡에 적용 ({num(applicable.length)}개)
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CoupangChangeModal
