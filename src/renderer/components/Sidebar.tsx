import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { theme } from '../styles/theme'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

// ── 링크 공통 스타일 ─────────────────────────────────────────────
const linkBase: React.CSSProperties = {
  padding: '12px 16px',
  color: theme.colors.sidebarText,
  textDecoration: 'none',
  borderRadius: theme.radius.sm,
  transition: 'background 0.2s',
}

const subLinkBase: React.CSSProperties = {
  ...linkBase,
  padding: '10px 16px 10px 32px',
  color: theme.colors.sidebarSubText,
  fontSize: '14px',
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen }) => {
  const [isCoupangOpen, setIsCoupangOpen] = useState(false)
  const [isShipmentOpen, setIsShipmentOpen] = useState(false)

  const hoverIn = (e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.backgroundColor = theme.colors.sidebarHover }
  const hoverOut = (e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }

  const subHoverIn = (e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLElement
    el.style.backgroundColor = theme.colors.sidebarHover
    el.style.color = theme.colors.sidebarText
  }
  const subHoverOut = (e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLElement
    el.style.backgroundColor = 'transparent'
    el.style.color = theme.colors.sidebarSubText
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: isOpen ? 0 : '-250px',
        width: '250px',
        height: '100%',
        backgroundColor: theme.colors.sidebarBg,
        color: 'white',
        transition: 'left 0.3s ease',
        zIndex: 998,
        display: 'flex',
        flexDirection: 'column',
        padding: '20px',
        boxShadow: isOpen ? '4px 0 16px rgba(0,0,0,0.15)' : 'none',
      }}
    >
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <Link to="/" style={linkBase} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
          홈 / 공지사항
        </Link>

        {/* ── 쿠팡관리 (접이식 하위 메뉴) ──────────────────────── */}
        <div
          onClick={() => setIsCoupangOpen(!isCoupangOpen)}
          style={{
            ...linkBase,
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            userSelect: 'none',
          }}
          onMouseEnter={hoverIn}
          onMouseLeave={hoverOut}
        >
          쿠팡관리
          <span style={{ fontSize: '12px' }}>{isCoupangOpen ? '▾' : '▸'}</span>
        </div>
        {isCoupangOpen && (
          <>
            <Link to="/coupang" style={subLinkBase} onMouseEnter={subHoverIn} onMouseLeave={subHoverOut}>
              쿠팡관리
            </Link>
            <Link to="/purchase-management" style={subLinkBase} onMouseEnter={subHoverIn} onMouseLeave={subHoverOut}>
              사입관리
            </Link>
          </>
        )}

        <Link to="/inventory" style={linkBase} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
          재고관리
        </Link>

        <Link to="/in-management" style={linkBase} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
          입고 관리
        </Link>

        {/* ── 출고관리 (접이식 하위 메뉴) ──────────────────────── */}
        <div
          onClick={() => setIsShipmentOpen(!isShipmentOpen)}
          style={{
            ...linkBase,
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            userSelect: 'none',
          }}
          onMouseEnter={hoverIn}
          onMouseLeave={hoverOut}
        >
          출고관리
          <span style={{ fontSize: '12px' }}>{isShipmentOpen ? '▾' : '▸'}</span>
        </div>
        {isShipmentOpen && (
          <>
            <Link to="/shipment-list" style={subLinkBase} onMouseEnter={subHoverIn} onMouseLeave={subHoverOut}>
              출고리스트
            </Link>
            <Link to="/rocket-shipment" style={subLinkBase} onMouseEnter={subHoverIn} onMouseLeave={subHoverOut}>
              로켓출고
            </Link>
          </>
        )}

        <Link to="/coupang-return" style={linkBase} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
          Q 반품
        </Link>
      </nav>
    </div>
  )
}

export default Sidebar
