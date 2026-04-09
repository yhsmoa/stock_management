import React, { useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import { theme } from '../styles/theme'

const Layout: React.FC = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const navigate = useNavigate()

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen)
  }

  const handleLogout = () => {
    localStorage.removeItem('user')
    navigate('/login')
  }

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
        {/* 왼쪽: 메뉴 버튼 + 타이틀 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <button
            onClick={toggleSidebar}
            style={{
              width: '24px',
              height: '24px',
              border: `1.5px solid ${theme.colors.textSecondary}`,
              background: 'white',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              borderRadius: theme.radius.sm,
            }}
          >
            ☰
          </button>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: theme.colors.textPrimary }}>
            Stock Management
          </h1>
        </div>

        {/* 오른쪽: 로그아웃 버튼 */}
        <button
          onClick={handleLogout}
          style={{
            padding: '8px 16px',
            backgroundColor: theme.colors.danger,
            color: 'white',
            border: 'none',
            borderRadius: theme.radius.md,
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '600',
          }}
        >
          로그아웃
        </button>
      </header>

      {/* 메인 컨텐츠 영역 */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

        {/* 페이지 콘텐츠 */}
        <main style={{
          flex: 1,
          overflow: 'auto',
          padding: '24px',
          marginLeft: isSidebarOpen ? '270px' : '0',
          transition: 'margin-left 0.3s ease',
        }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default Layout
