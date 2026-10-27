/* ================================================================
   로켓그로스 콘솔 — 입고 엑셀 드롭 영역
   - 끌어다 놓기 또는 클릭해서 파일 선택
   - 받은 엑셀 요약(상품 수 · 총 수량)과 뺀 행 · 중복 경고를 보여 준다
   ================================================================ */

import React, { useRef, useState } from 'react'
import type { InboundExcel } from '../../services/rocketConsoleService'
import { ACCEPT_ATTR } from '../../pages/useRocketConsole'

// ── 경고 목록에 펼쳐 보일 최대 개수 (나머지는 '외 N개') ──
const WARN_LIST_LIMIT = 10

const listPreview = (items: string[]): string =>
  items.slice(0, WARN_LIST_LIMIT).join(', ') +
  (items.length > WARN_LIST_LIMIT ? ` 외 ${items.length - WARN_LIST_LIMIT}개` : '')

interface InboundExcelDropProps {
  excel: InboundExcel | null
  fileName: string
  loading: boolean
  error: string
  onFile: (file: File) => void
  onClear: () => void
}

const InboundExcelDrop: React.FC<InboundExcelDropProps> = ({ excel, fileName, loading, error, onFile, onClear }) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  // ── 드래그 · 드롭 ──
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file && !loading) onFile(file)
  }

  return (
    <section className="rc-card">
      <div
        className={`rc-drop${dragOver ? ' rc-drop-over' : ''}${loading ? ' rc-drop-busy' : ''}`}
        onClick={() => !loading && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !loading) inputRef.current?.click() }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''           // 같은 파일을 다시 골라도 onChange 가 오도록
            if (file) onFile(file)
          }}
        />
        <strong className="rc-drop-title">
          {loading ? '엑셀을 읽는 중...' : fileName || '로켓그로스 입고 엑셀을 끌어다 놓거나 클릭해서 선택'}
        </strong>
        <span className="rc-drop-sub">쿠팡윙 [로켓그로스 입고] 다운로드 엑셀 · 옵션 ID 와 입고 수량을 씁니다</span>
      </div>

      {error && <p className="rc-error">{error}</p>}

      {excel && !loading && (
        <div className="rc-excel-summary">
          <ul className="rc-summary-list">
            <li>
              상품 <strong>{excel.rows.length.toLocaleString()}</strong>개 · 총 수량 <strong>{excel.totalQty.toLocaleString()}</strong>개
            </li>
            {excel.duplicateIds.length > 0 && (
              <li className="rc-warn">
                같은 옵션 ID 가 여러 번 나왔습니다 ({excel.duplicateIds.length}개, 첫 행만 사용): {listPreview(excel.duplicateIds)}
              </li>
            )}
            {excel.skippedRows.length > 0 && (
              <li className="rc-warn">
                {excel.skippedRows.length}개 행을 뺐습니다:{' '}
                {listPreview(excel.skippedRows.map((s) => `${s.excelRow}행 ${s.optionId || '(옵션 ID 없음)'} — ${s.reason}`))}
              </li>
            )}
          </ul>
          <button className="rc-btn rc-btn-ghost" onClick={onClear}>지우기</button>
        </div>
      )}
    </section>
  )
}

export default InboundExcelDrop
