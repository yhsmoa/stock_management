import React from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar, { RAIL_WIDTH } from './Sidebar'

/* ================================================================
   Layout — 미니멀 라이트 셸 (edge-to-edge, 감싸는 보드 없음)
   - 사이드바는 좌측 고정 rail (호버 시 오버레이 확장, 콘텐츠 push 없음)
   - 본문은 rail 폭만큼 좌측 여백. 상단 헤더 없음(로고는 사이드바)
   ================================================================ */

const Layout: React.FC = () => {
  return (
    <div style={{ height: '100vh', overflow: 'hidden', background: '#fff' }}>
      <Sidebar />
      <main
        style={{
          marginLeft: `${RAIL_WIDTH}px`,
          height: '100vh',
          overflow: 'hidden',
        }}
      >
        <Outlet />
      </main>
    </div>
  )
}

export default Layout
