/* ================================================================
   로켓그로스 콘솔 — 보드 (단계 1개)
   - 머리: 단계 번호 · 제목 · 붙여넣을 화면
   - 본문: 요약 → 스크립트 미리보기 + [복사]
   - 엑셀이 없으면 안내만, 만들 수 없으면 사유만 보여 준다
   ================================================================ */

import React from 'react'
import type { ConsoleBoard as ConsoleBoardData } from '../../pages/useRocketConsole'

interface ConsoleBoardProps {
  board: ConsoleBoardData
  hasExcel: boolean
  copied: boolean
  onCopy: (board: ConsoleBoardData) => void
}

const ConsoleBoard: React.FC<ConsoleBoardProps> = ({ board, hasExcel, copied, onCopy }) => {
  const { def, script, error, notes } = board

  return (
    <section className={`rc-card${hasExcel ? '' : ' rc-card-idle'}`}>
      {/* ── 머리 ── */}
      <header className="rc-card-head">
        <span className="rc-step">{def.step}</span>
        <div className="rc-card-titles">
          <h3 className="rc-card-title">{def.title}</h3>
          <p className="rc-card-usage">{def.usage}</p>
        </div>
        {script && (
          <button className="rc-btn rc-btn-primary rc-card-copy" onClick={() => onCopy(board)}>
            {copied ? '복사됨 ✓' : '복사'}
          </button>
        )}
      </header>

      {!hasExcel && <p className="rc-file-hint">위에 엑셀을 넣으면 스크립트가 만들어집니다.</p>}
      {error && <p className="rc-error">{error}</p>}

      {script && (
        <>
          {notes.length > 0 && (
            <ul className="rc-summary-list">
              {notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
          <textarea
            className="rc-script"
            value={script}
            readOnly
            spellCheck={false}
            onFocus={(e) => e.currentTarget.select()}
          />
        </>
      )}
    </section>
  )
}

export default ConsoleBoard
