/* ================================================================
   라벨 장수 입력 — 라벨출력 모달 위쪽 (LabelPrintModal editableQty)
   - 행마다 [장수] 를 직접 입력 · 위쪽 [전체 N장 적용] · 총 장수 합계
   - 0장인 행은 인쇄에서 빠진다 (모달이 걸러서 인쇄한다)
   - 입력 중 빈칸은 0 으로 본다. 정수만, 0 ~ MAX_QTY_PER_ROW
   ================================================================ */

import React, { useState } from 'react'
import type { LabelPrintItem } from '../../services/labelPrintService'
import './LabelQtyList.css'

// ── 상수 ──────────────────────────────────────────────────────────
/** 한 행에 넣을 수 있는 최대 장수 — 오타(0 하나 더)로 수천 장이 나가는 것 방지 */
export const MAX_QTY_PER_ROW = 999

/** 입력값 → 0 ~ MAX_QTY_PER_ROW 정수 (빈칸·잘못된 값은 0) */
export function clampQty(raw: string | number): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(n, MAX_QTY_PER_ROW)
}

interface Props {
  items: LabelPrintItem[]
  /** items 와 같은 순서의 장수 */
  qtys: number[]
  onChange: (index: number, qty: number) => void
  onApplyAll: (qty: number) => void
  disabled?: boolean
}

const LabelQtyList: React.FC<Props> = ({ items, qtys, onChange, onApplyAll, disabled }) => {
  const [allQty, setAllQty] = useState('1')
  const total = qtys.reduce((n, q) => n + q, 0)
  const activeRows = qtys.filter((q) => q > 0).length

  return (
    <div className="lql-root">
      {/* ── 위쪽: 전체 적용 · 합계 ── */}
      <div className="lql-head">
        <span className="lql-title">장수</span>
        <div className="lql-apply">
          <span>전체</span>
          <input
            type="number"
            min={0}
            max={MAX_QTY_PER_ROW}
            step={1}
            value={allQty}
            disabled={disabled}
            onChange={(e) => setAllQty(e.target.value)}
          />
          <span>장</span>
          <button type="button" disabled={disabled} onClick={() => onApplyAll(clampQty(allQty))}>
            적용
          </button>
        </div>
        <span className="lql-total">
          {activeRows}개 상품 · 총 <b>{total.toLocaleString()}</b>장
        </span>
      </div>

      {/* ── 행별 장수 ── */}
      <div className="lql-list">
        {items.map((it, i) => {
          const name = String(it.data.item_name ?? '')
          const option = String(it.data.option_name ?? '')
          return (
            <div className={`lql-row${qtys[i] > 0 ? '' : ' is-zero'}`} key={i}>
              <div className="lql-info">
                <span className="lql-name" title={option ? `${name} · ${option}` : name}>
                  {name || '(상품명 없음)'}
                  {option ? <em> · {option}</em> : null}
                </span>
                <span className="lql-barcode">{String(it.data.barcode ?? '')}</span>
              </div>
              <input
                type="number"
                min={0}
                max={MAX_QTY_PER_ROW}
                step={1}
                value={qtys[i] ?? 0}
                disabled={disabled}
                onChange={(e) => onChange(i, clampQty(e.target.value))}
                onFocus={(e) => e.target.select()}
              />
              <span className="lql-unit">장</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default LabelQtyList
