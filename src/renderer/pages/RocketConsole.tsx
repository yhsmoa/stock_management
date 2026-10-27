/* ================================================================
   로켓그로스 콘솔 (RocketConsole) — 렌더링 컴포넌트
   - 쿠팡윙 로켓그로스 입고 단계별 자동화 콘솔 스크립트를 만든다.
   - 맨 위: 입고 엑셀 드롭 영역 (한 번만 넣으면 모든 보드가 공유)
   - 아래: 단계별 보드 — 스크립트 미리보기 + [복사]
     · 1단계 상품 선택 · 2단계 상품 확인·수량 입력 (이후 단계는 BOARD_DEFS 에 추가)
   - 로직은 useRocketConsole 훅, 엑셀 해석·스크립트는 rocketConsoleService
   ================================================================ */

import React from 'react'
import './RocketConsole.css'
import { useRocketConsole } from './useRocketConsole'
import InboundExcelDrop from '../components/rocket-console/InboundExcelDrop'
import ConsoleBoard from '../components/rocket-console/ConsoleBoard'

const RocketConsole: React.FC = () => {
  const { excel, fileName, loading, error, loadFile, clear, boards, copiedKey, copy } = useRocketConsole()

  return (
    <div className="rc-container">
      {/* ── 타이틀 ── */}
      <div className="rc-header">
        <h2 className="rc-title">로켓그로스 콘솔</h2>
        <p className="rc-subtitle">
          쿠팡윙 로켓그로스 입고 화면에서 F12 › Console 탭에 붙여넣고 Enter
        </p>
      </div>

      <div className="rc-cards">
        {/* ── 입고 엑셀 ── */}
        <InboundExcelDrop
          excel={excel}
          fileName={fileName}
          loading={loading}
          error={error}
          onFile={loadFile}
          onClear={clear}
        />

        {/* ── 단계별 보드 ── */}
        {boards.map((board) => (
          <ConsoleBoard
            key={board.def.key}
            board={board}
            hasExcel={!!excel && !loading}
            copied={copiedKey === board.def.key}
            onCopy={copy}
          />
        ))}
      </div>
    </div>
  )
}

export default RocketConsole
