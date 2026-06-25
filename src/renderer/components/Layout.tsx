import React from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import { theme } from '../styles/theme'

// ── 상수 ──────────────────────────────────────────────────────────
const RAIL_WIDTH = 40     // Sidebar 의 RAIL_WIDTH 와 동일하게 유지

const Layout: React.FC = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* 헤더 영역 - 항상 고정 */}
      <header style={{
        height: '60px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: '15px',
        paddingRight: '20px',
        borderBottom: `1px solid ${theme.colors.border}`,
        backgroundColor: theme.colors.bgCard,
        boxShadow: theme.shadows.sm,
        zIndex: 1000,
        position: 'relative'
      }}>
        {/* 왼쪽: 타이틀 */}
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: theme.colors.textPrimary }}>
          Stock Management
        </h1>
        {/* 로그아웃 버튼은 사이드바 바닥으로 이동 */}
      </header>

      {/* 메인 컨텐츠 영역 — Sidebar 는 항상 보이는 rail (overlay 동작) */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        <Sidebar />

        {/* 페이지 콘텐츠 — rail 폭만큼 좌측 여백 고정 (확장돼도 push 없음) */}
        <main style={{
          flex: 1,
          overflow: 'auto',
          padding: '24px',
          marginLeft: `${RAIL_WIDTH}px`,
        }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default Layout
