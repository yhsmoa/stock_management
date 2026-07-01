/* ================================================================
   Sidebar — Rail + Hover 확장 패턴
   - 기본: 좁은 rail (RAIL_WIDTH) 에 이모지 아이콘만 표시
   - 마우스 호버: EXPANDED_WIDTH 로 확장 + 라벨 표시
   - 하위 메뉴는 부모 클릭으로 접이식 토글 (▸/▾)
   - 현재 라우트의 부모 그룹은 자동으로 펼침 (사용자 위치 표시)
   - 메인 콘텐츠를 push 하지 않는 floating overlay
   ================================================================ */

import React, { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { theme } from '../styles/theme'

// ── 상수 ──────────────────────────────────────────────────────────
const RAIL_WIDTH = 40
const EXPANDED_WIDTH = 230
const HEADER_HEIGHT = 60

// ── 메뉴 데이터 ───────────────────────────────────────────────────
type MenuItem =
  | { type: 'link'; path: string; icon: string; label: string }
  | { type: 'group'; icon: string; label: string; children: { path: string; label: string }[] }

const MENU_ITEMS: MenuItem[] = [
  { type: 'link', path: '/', icon: '🏠', label: '홈 / 공지사항' },
  {
    type: 'group', icon: '💬', label: 'CS관리',
    children: [
      { path: '/cs/customer-inquiry', label: '고객문의' },
      { path: '/cs/coupang-inquiry',  label: '쿠팡문의' },
    ],
  },
  {
    type: 'group', icon: '🛒', label: '쿠팡관리',
    children: [
      { path: '/personal-order',      label: '개인주문' },
      { path: '/coupang',             label: '상품관리' },
      { path: '/purchase-management', label: '사입관리' },
    ],
  },
  {
    type: 'group', icon: '📋', label: '아이템관리',
    children: [
      { path: '/item-info', label: '상품정보' },
    ],
  },
  { type: 'link', path: '/inventory',     icon: '📦', label: '재고관리' },
  {
    type: 'group', icon: '📥', label: '입고관리',
    children: [
      { path: '/in-management',  label: '입고작업' },
      { path: '/coupang-return', label: 'Q반품' },
    ],
  },
  {
    type: 'group', icon: '🚚', label: '출고관리',
    children: [
      { path: '/shipment-list',    label: '출고리스트' },
      { path: '/rocket-shipment',  label: '로켓출고' },
    ],
  },
  { type: 'link', path: '/analysis-management', icon: '📊', label: '분석관리' },
]

// ── 현재 path 가 어느 그룹의 자식인지 찾기 ───────────────────────
function findParentGroupLabel(currentPath: string): string | null {
  for (const item of MENU_ITEMS) {
    if (item.type === 'group' && item.children.some((c) => c.path === currentPath)) {
      return item.label
    }
  }
  return null
}

// ══════════════════════════════════════════════════════════════════
// 컴포넌트
// ══════════════════════════════════════════════════════════════════

const Sidebar: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const currentPath = location.pathname

  // ── 로그아웃 ──────────────────────────────────────────────────
  const handleLogout = () => {
    localStorage.removeItem('user')
    navigate('/login')
  }

  const [expanded, setExpanded] = useState(false)
  // 펼쳐진 그룹 집합 (그룹 label key). 초기값: 현재 path 의 부모 그룹
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const s = new Set<string>()
    const parent = findParentGroupLabel(currentPath)
    if (parent) s.add(parent)
    return s
  })

  // 라우트 변경 시: 새 부모 그룹이 있으면 자동 펼침 (다른 그룹은 그대로 유지)
  useEffect(() => {
    const parent = findParentGroupLabel(currentPath)
    if (!parent) return
    setOpenGroups((prev) => (prev.has(parent) ? prev : new Set([...prev, parent])))
  }, [currentPath])

  // ── 그룹 토글 ───────────────────────────────────────────────────
  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  // ── 호버 헬퍼 ───────────────────────────────────────────────────
  const hoverIn = (e: React.MouseEvent) => {
    ;(e.currentTarget as HTMLElement).style.backgroundColor = theme.colors.sidebarHover
  }
  const hoverOut = (e: React.MouseEvent, isActive: boolean) => {
    ;(e.currentTarget as HTMLElement).style.backgroundColor = isActive
      ? 'rgba(255, 255, 255, 0.1)'
      : 'transparent'
  }

  // ── 항목 1개 렌더 ───────────────────────────────────────────────
  const renderItem = (item: MenuItem, idx: number) => {
    if (item.type === 'link') {
      const isActive = currentPath === item.path
      return (
        <Link
          key={idx}
          to={item.path}
          style={getLinkStyle(expanded, isActive)}
          onMouseEnter={hoverIn}
          onMouseLeave={(e) => hoverOut(e, isActive)}
        >
          <span style={iconStyle}>{item.icon}</span>
          {expanded && <span style={labelStyle}>{item.label}</span>}
        </Link>
      )
    }
    // group
    const isOpen = openGroups.has(item.label)
    const hasActiveChild = item.children.some((c) => c.path === currentPath)
    return (
      <div key={idx} style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          onClick={() => expanded && toggleGroup(item.label)}
          style={{
            ...getLinkStyle(expanded, hasActiveChild),
            cursor: expanded ? 'pointer' : 'default',
          }}
          onMouseEnter={hoverIn}
          onMouseLeave={(e) => hoverOut(e, hasActiveChild)}
        >
          <span style={iconStyle}>{item.icon}</span>
          {expanded && (
            <>
              <span style={{ ...labelStyle, flex: 1 }}>{item.label}</span>
              <span style={{ fontSize: '11px', opacity: 0.7 }}>{isOpen ? '▾' : '▸'}</span>
            </>
          )}
        </div>
        {expanded && isOpen && item.children.map((c) => {
          const isActive = currentPath === c.path
          return (
            <Link
              key={c.path}
              to={c.path}
              style={getSubLinkStyle(isActive)}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement
                el.style.backgroundColor = theme.colors.sidebarHover
                el.style.color = theme.colors.sidebarText
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement
                el.style.backgroundColor = isActive ? 'rgba(255, 255, 255, 0.1)' : 'transparent'
                el.style.color = isActive ? theme.colors.sidebarText : theme.colors.sidebarSubText
              }}
            >
              {c.label}
            </Link>
          )
        })}
      </div>
    )
  }

  return (
    <div
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      style={{
        position: 'fixed',
        top: `${HEADER_HEIGHT}px`,
        left: 0,
        width: expanded ? `${EXPANDED_WIDTH}px` : `${RAIL_WIDTH}px`,
        height: `calc(100vh - ${HEADER_HEIGHT}px)`,
        backgroundColor: 'rgba(30, 41, 59, 0.95)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        color: 'white',
        transition: 'width 0.2s ease',
        zIndex: 998,
        display: 'flex',
        flexDirection: 'column',
        padding: expanded ? '10px 6px' : '10px 4px',
        borderRight: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: expanded ? '4px 0 16px rgba(0, 0, 0, 0.2)' : 'none',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {MENU_ITEMS.map(renderItem)}
      </nav>

      {/* ── 바닥: 로그아웃 ─────────────────────────────────────── */}
      <button
        onClick={handleLogout}
        style={getLogoutStyle(expanded)}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(239, 68, 68, 0.18)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
        }}
        title="로그아웃"
        aria-label="로그아웃"
      >
        <span style={iconStyle}>🚪</span>
        {expanded && <span style={labelStyle}>로그아웃</span>}
      </button>
    </div>
  )
}

// ── 스타일 헬퍼 ────────────────────────────────────────────────────

const iconStyle: React.CSSProperties = {
  fontSize: '16px',
  width: '28px',
  textAlign: 'center',
  flexShrink: 0,
}

const labelStyle: React.CSSProperties = {
  fontSize: '13px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
}

function getLinkStyle(expanded: boolean, isActive: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: expanded ? '8px 10px' : '8px 0',
    justifyContent: expanded ? 'flex-start' : 'center',
    color: theme.colors.sidebarText,
    textDecoration: 'none',
    borderRadius: theme.radius.sm,
    transition: 'background 0.2s',
    userSelect: 'none',
    backgroundColor: isActive ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
    fontWeight: isActive ? 600 : 400,
  }
}

function getLogoutStyle(expanded: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: expanded ? '8px 10px' : '8px 0',
    marginTop: '8px',
    justifyContent: expanded ? 'flex-start' : 'center',
    color: theme.colors.sidebarText,
    background: 'transparent',
    border: 'none',
    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
    width: '100%',
    borderRadius: theme.radius.sm,
    cursor: 'pointer',
    transition: 'background 0.2s',
    userSelect: 'none',
    flexShrink: 0,
  }
}

function getSubLinkStyle(isActive: boolean): React.CSSProperties {
  return {
    padding: '6px 10px 6px 44px',
    color: isActive ? theme.colors.sidebarText : theme.colors.sidebarSubText,
    textDecoration: 'none',
    borderRadius: theme.radius.sm,
    transition: 'background 0.2s, color 0.2s',
    fontSize: '12px',
    whiteSpace: 'nowrap',
    backgroundColor: isActive ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
    fontWeight: isActive ? 600 : 400,
  }
}

export default Sidebar
