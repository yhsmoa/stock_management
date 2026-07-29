import React from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar, { CONTENT_OFFSET } from './Sidebar'

/* ================================================================
   Layout — 셸 (edge-to-edge, 감싸는 보드 없음)
   - 사이드바는 좌측에 여백을 두고 떠 있는 다크 라운드 패널 (항상 펼침)
   - 본문은 사이드바 폭 + 좌우 여백(CONTENT_OFFSET)만큼 좌측 여백
   ================================================================ */

const Layout: React.FC = () => {
  return (
    <div style={{ height: '100vh', overflow: 'hidden', background: '#fff' }}>
      <Sidebar />
      <main
        style={{
          marginLeft: `${CONTENT_OFFSET}px`,
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
