import React from 'react'
import { Link } from 'react-router-dom'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen }) => {

  return (
    <>
      {/* 배경 오버레이 제거 - 사이드바 외부 클릭해도 닫히지 않도록 */}

      {/* 사이드바 */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: isOpen ? 0 : '-250px',
          width: '250px',
          height: '100%',
          backgroundColor: '#2c3e50',
          color: 'white',
          transition: 'left 0.3s ease',
          zIndex: 998,
          display: 'flex',
          flexDirection: 'column',
          padding: '20px',
          boxShadow: isOpen ? '2px 0 5px rgba(0,0,0,0.3)' : 'none',
        }}
      >
        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <Link
            to="/"
            style={{
              padding: '12px 16px',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '4px',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#34495e')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            홈 / 공지사항
          </Link>

          <Link
            to="/coupang"
            style={{
              padding: '12px 16px',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '4px',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#34495e')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            쿠팡관리
          </Link>

          <Link
            to="/inventory"
            style={{
              padding: '12px 16px',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '4px',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#34495e')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            재고관리
          </Link>

          <Link
            to="/in-management"
            style={{
              padding: '12px 16px',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '4px',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#34495e')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            입고 관리
          </Link>

          <Link
            to="/inout"
            style={{
              padding: '12px 16px',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '4px',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#34495e')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            출고 관리
          </Link>

          <Link
            to="/coupang-return"
            style={{
              padding: '12px 16px',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '4px',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#34495e')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Q 반품
          </Link>

        </nav>
      </div>
    </>
  )
}

export default Sidebar
