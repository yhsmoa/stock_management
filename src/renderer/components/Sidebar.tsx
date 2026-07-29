/* ================================================================
   Sidebar — 다크 네이비 패널 · Rail + Hover 확장
   - 화면 좌측 끝에 붙은 전체 높이 패널 (여백/라운드 없음)
   - 기본: 좁은 rail (RAIL_WIDTH) 에 라인 아이콘만
   - 마우스 호버: SIDEBAR_WIDTH 로 확장 + 로고/검색/라벨/섹션 표시
     (오버레이 확장 — 본문을 밀지 않으므로 테이블 폭을 잃지 않는다)
   - 활성 항목은 파란 좌측 인디케이터 + 밝은 배경으로 강조
   - 하위 그룹은 확장 상태에서 부모 클릭으로 접이식, 현재 라우트 그룹 자동 펼침
   ================================================================ */

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { AuthUser } from '../types/auth'

// ── 레이아웃 상수 ──────────────────────────────────────────────────
export const SIDEBAR_WIDTH = 248            // 확장 폭
export const RAIL_WIDTH = 56                // 기본(rail) 폭
/** 본문(main)이 확보해야 할 좌측 오프셋 — rail 기준(확장은 오버레이) */
export const CONTENT_OFFSET = RAIL_WIDTH

// ── 다크 네이비 팔레트 ─────────────────────────────────────────────
const C = {
  panelBg:      '#151C2C',
  panelBorder:  'rgba(255, 255, 255, 0.06)',
  textStrong:   '#FFFFFF',
  text:         '#C5CBD8',
  muted:        '#828B9E',
  sectionLabel: '#66708A',
  activeBg:     'rgba(255, 255, 255, 0.08)',
  hoverBg:      'rgba(255, 255, 255, 0.05)',
  accent:       '#3B82F6',
  searchBg:     'rgba(255, 255, 255, 0.06)',
  searchBorder: 'rgba(255, 255, 255, 0.09)',
  badgeBg:      'rgba(59, 130, 246, 0.18)',
  badgeText:    '#93B4FA',
}

// ── 라인 아이콘 (Heroicons outline, stroke=currentColor) ───────────
const ICON_PATHS: Record<string, string> = {
  home:  'M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75',
  chat:  'M7.5 8.25h9m-9 3H12m8.25.75c0 3.728-3.694 6.75-8.25 6.75a9.75 9.75 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-3.728 3.694-6.75 8.25-6.75s9 3.022 9 6.75z',
  cart:  'M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z',
  grid:  'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
  cube:  'M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9',
  inbox: 'M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15M9 12l3 3m0 0l3-3m-3 3V2.25',
  truck: 'M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-6m6 0V7.5m0 11.25H3.75V6a1.5 1.5 0 011.5-1.5h9a1.5 1.5 0 011.5 1.5v1.5',
  chart: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
  search: 'm21 21-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z',
  chevron: 'm19.5 8.25-7.5 7.5-7.5-7.5',
  logout: 'M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9',
}

const Icon: React.FC<{ name: string; size?: number }> = ({ name, size = 17 }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0 }}
  >
    <path d={ICON_PATHS[name] ?? ''} />
  </svg>
)

// ── 메뉴 데이터 (섹션 → 항목) ──────────────────────────────────────
//   count 는 선택 필드 — 실제 집계값이 연결될 때만 배지가 렌더된다.
//   (임의의 숫자를 하드코딩하지 않는다)
type Leaf = { path: string; label: string; count?: number }
type MenuItem =
  | { type: 'link'; path: string; icon: string; label: string; count?: number }
  | { type: 'group'; icon: string; label: string; children: Leaf[] }

type Section = { label: string; items: MenuItem[] }

const SECTIONS: Section[] = [
  {
    label: '운영',
    items: [
      { type: 'link', path: '/', icon: 'home', label: '홈' },
      {
        type: 'group', icon: 'chat', label: 'CS관리',
        children: [
          { path: '/cs/customer-inquiry', label: '고객문의' },
          { path: '/cs/coupang-inquiry',  label: '쿠팡문의' },
        ],
      },
    ],
  },
  {
    label: '채널',
    items: [
      {
        type: 'group', icon: 'cart', label: '쿠팡관리',
        children: [
          { path: '/personal-order',      label: '개인주문' },
          { path: '/coupang',             label: '상품관리' },
          { path: '/purchase-management', label: '로켓그로스 사입' },
        ],
      },
    ],
  },
  {
    label: '물류',
    items: [
      {
        type: 'group', icon: 'grid', label: '아이템관리',
        children: [
          { path: '/item-info', label: '상품정보' },
        ],
      },
      { type: 'link', path: '/inventory', icon: 'cube', label: '재고관리' },
      {
        type: 'group', icon: 'inbox', label: '입고관리',
        children: [
          { path: '/in-management',  label: '입고작업' },
          { path: '/coupang-return', label: 'Q반품' },
        ],
      },
      {
        type: 'group', icon: 'truck', label: '출고관리',
        children: [
          { path: '/shipment-list',   label: '출고리스트' },
          { path: '/rocket-shipment', label: '로켓그로스 출고' },
        ],
      },
    ],
  },
  {
    label: '인사이트',
    items: [
      { type: 'link', path: '/analysis-management', icon: 'chart', label: '분석관리' },
    ],
  },
]

// ── 현재 path 가 속한 그룹 label 찾기 (자동 펼침용) ────────────────
function findParentGroupLabel(currentPath: string): string | null {
  for (const section of SECTIONS) {
    for (const item of section.items) {
      if (item.type === 'group' && item.children.some((c) => c.path === currentPath)) {
        return item.label
      }
    }
  }
  return null
}

// ── 검색용 평탄화 목록 (그룹명 + 하위명 모두 검색 대상) ────────────
type FlatEntry = { path: string; label: string; parent?: string; icon: string; count?: number }

const FLAT_ENTRIES: FlatEntry[] = SECTIONS.flatMap((section) =>
  section.items.flatMap<FlatEntry>((item) =>
    item.type === 'link'
      ? [{ path: item.path, label: item.label, icon: item.icon, count: item.count }]
      : item.children.map((c) => ({
          path: c.path, label: c.label, parent: item.label, icon: item.icon, count: c.count,
        })),
  ),
)

// ══════════════════════════════════════════════════════════════════
// 컴포넌트
// ══════════════════════════════════════════════════════════════════

const Sidebar: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const currentPath = location.pathname

  const displayName = useMemo(() => {
    try {
      const raw = localStorage.getItem('user')
      if (!raw) return ''
      const u = JSON.parse(raw) as AuthUser
      return u.name || u.username || ''
    } catch {
      return ''
    }
  }, [])

  const handleLogout = () => {
    localStorage.removeItem('user')
    navigate('/login')
  }

  // ── rail ↔ 확장 ───────────────────────────────────────────────
  //   hover 로 확장하되, Ctrl/⌘+K 로 검색을 열면 마우스가 벗어나도 유지
  const [hovered, setHovered] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const expanded = hovered || searchOpen

  // ── 메뉴 검색 ─────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const trimmedQuery = query.trim().toLowerCase()

  const searchResults = useMemo(() => {
    if (!trimmedQuery) return null
    return FLAT_ENTRIES.filter(
      (e) =>
        e.label.toLowerCase().includes(trimmedQuery)
        || (e.parent?.toLowerCase().includes(trimmedQuery) ?? false),
    )
  }, [trimmedQuery])

  const isMac = useMemo(
    () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent),
    [],
  )

  // Ctrl/⌘ + K → 사이드바 확장 + 검색 포커스
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // 검색이 열려 input 이 마운트된 뒤 포커스
  useEffect(() => {
    if (searchOpen) {
      searchRef.current?.focus()
      searchRef.current?.select()
    }
  }, [searchOpen])

  // 접히면 검색어 초기화 (rail 상태에서 필터가 남아있지 않도록)
  useEffect(() => {
    if (!expanded) setQuery('')
  }, [expanded])

  // ── 펼쳐진 그룹 집합 (초기: 현재 path 의 부모 그룹) ────────────
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const s = new Set<string>()
    const parent = findParentGroupLabel(currentPath)
    if (parent) s.add(parent)
    return s
  })

  useEffect(() => {
    const parent = findParentGroupLabel(currentPath)
    if (!parent) return
    setOpenGroups((prev) => (prev.has(parent) ? prev : new Set([...prev, parent])))
  }, [currentPath])

  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  // ── 항목 렌더 ─────────────────────────────────────────────────
  const renderItem = (item: MenuItem) => {
    if (item.type === 'link') {
      const isActive = currentPath === item.path
      return (
        <Link
          key={item.path} to={item.path}
          style={rowStyle(isActive, expanded)}
          className="si-nav-row"
          title={!expanded ? item.label : undefined}
        >
          <ActiveBar show={isActive} />
          <span style={{ ...iconWrap, color: isActive ? C.textStrong : C.muted }}>
            <Icon name={item.icon} />
          </span>
          {expanded && <span style={{ flex: 1, ...labelStyle(isActive) }}>{item.label}</span>}
          {expanded && item.count != null && <Badge value={item.count} active={isActive} />}
        </Link>
      )
    }

    // ── 그룹 (확장 상태에서만 접이식) ──
    const isOpen = openGroups.has(item.label)
    const hasActiveChild = item.children.some((c) => c.path === currentPath)
    return (
      <div key={item.label}>
        <div
          onClick={() => expanded && toggleGroup(item.label)}
          style={{ ...rowStyle(false, expanded), cursor: expanded ? 'pointer' : 'default' }}
          className="si-nav-row"
          title={!expanded ? item.label : undefined}
        >
          {/* rail 상태에선 하위 활성 여부를 그룹 아이콘에 표시 */}
          <ActiveBar show={!expanded && hasActiveChild} />
          <span style={{ ...iconWrap, color: hasActiveChild ? C.textStrong : C.muted }}>
            <Icon name={item.icon} />
          </span>
          {expanded && (
            <span style={{ flex: 1, ...labelStyle(hasActiveChild) }}>{item.label}</span>
          )}
          {expanded && (
            <span
              style={{
                display: 'inline-flex',
                color: C.muted,
                transition: 'transform 0.18s ease',
                transform: isOpen ? 'none' : 'rotate(-90deg)',
              }}
            >
              <Icon name="chevron" size={13} />
            </span>
          )}
        </div>

        {expanded && isOpen && item.children.map((c) => {
          const isActive = currentPath === c.path
          return (
            <Link key={c.path} to={c.path} style={subRowStyle(isActive)} className="si-nav-row">
              <ActiveBar show={isActive} />
              <span style={{ flex: 1, ...labelStyle(isActive), fontSize: 13 }}>{c.label}</span>
              {c.count != null && <Badge value={c.count} active={isActive} />}
            </Link>
          )
        })}
      </div>
    )
  }

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        height: '100vh',
        zIndex: 998,
        width: expanded ? SIDEBAR_WIDTH : RAIL_WIDTH,
        background: C.panelBg,
        borderRight: `1px solid ${C.panelBorder}`,
        display: 'flex',
        flexDirection: 'column',
        padding: expanded ? '16px 12px 12px' : '16px 8px 12px',
        boxSizing: 'border-box',
        overflow: 'hidden',
        transition: 'width 0.2s ease, padding 0.2s ease',
        boxShadow: expanded ? '6px 0 24px rgba(15, 23, 42, 0.18)' : 'none',
      }}
    >
      <style>{`
        .si-nav-row { position: relative; }
        .si-nav-row:hover { background: ${C.hoverBg} !important; }
        .si-search-input::placeholder { color: ${C.sectionLabel}; }
        .si-scroll::-webkit-scrollbar { width: 6px; }
        .si-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.12); border-radius: 3px;
        }
        .si-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>

      {/* ── 로고 ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: expanded ? '2px 6px 14px' : '2px 0 14px',
          justifyContent: expanded ? 'flex-start' : 'center',
        }}
      >
        <span
          style={{
            width: 30, height: 30, borderRadius: 9, background: C.accent,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, color: '#fff', fontSize: 15, fontWeight: 700,
          }}
        >
          S
        </span>
        {expanded && (
          <span style={{ minWidth: 0 }}>
            <span
              style={{
                display: 'block', fontSize: 14, fontWeight: 700, color: C.textStrong,
                whiteSpace: 'nowrap', letterSpacing: '-0.01em',
              }}
            >
              Stock Management
            </span>
            <span style={{ display: 'block', fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>
              재고관리 시스템
            </span>
          </span>
        )}
      </div>

      {/* ── 메뉴 검색 (Ctrl/⌘ + K) ───────────────────────────── */}
      {expanded ? (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: C.searchBg, border: `1px solid ${C.searchBorder}`,
            borderRadius: 10, padding: '8px 10px', marginBottom: 16,
          }}
        >
          <span style={{ color: C.sectionLabel, display: 'inline-flex' }}>
            <Icon name="search" size={15} />
          </span>
          <input
            ref={searchRef}
            className="si-search-input"
            placeholder="메뉴 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => setSearchOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('')
                setSearchOpen(false)
                e.currentTarget.blur()
              }
            }}
            style={{
              flex: 1, border: 'none', background: 'transparent', outline: 'none',
              fontSize: 13, color: C.text, minWidth: 0,
            }}
          />
          <span
            style={{
              flexShrink: 0, fontSize: 10, color: C.sectionLabel, fontWeight: 600,
              border: `1px solid ${C.searchBorder}`, borderRadius: 5, padding: '2px 5px',
              lineHeight: 1.3, whiteSpace: 'nowrap',
            }}
          >
            {isMac ? '⌘K' : 'Ctrl K'}
          </span>
        </div>
      ) : (
        /* rail 상태: 검색 아이콘만 (호버하면 위 입력폼으로 확장) */
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: C.searchBg, border: `1px solid ${C.searchBorder}`,
            borderRadius: 10, padding: '8px 0', marginBottom: 16, color: C.sectionLabel,
          }}
          title={`메뉴 검색 (${isMac ? '⌘' : 'Ctrl'}+K)`}
        >
          <Icon name="search" size={15} />
        </div>
      )}

      {/* ── 네비게이션 ───────────────────────────────────────── */}
      <nav className="si-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {searchResults ? (
          /* ── 검색 결과 (평탄 목록) ── */
          searchResults.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: C.sectionLabel }}>
              검색 결과가 없습니다
            </div>
          ) : (
            searchResults.map((e) => {
              const isActive = currentPath === e.path
              return (
                <Link
                  key={e.path} to={e.path}
                  style={rowStyle(isActive, true)}
                  className="si-nav-row"
                >
                  <ActiveBar show={isActive} />
                  <span style={{ ...iconWrap, color: isActive ? C.textStrong : C.muted }}>
                    <Icon name={e.icon} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', ...labelStyle(isActive) }}>{e.label}</span>
                    {e.parent && (
                      <span style={{ display: 'block', fontSize: 10.5, color: C.sectionLabel }}>
                        {e.parent}
                      </span>
                    )}
                  </span>
                  {e.count != null && <Badge value={e.count} active={isActive} />}
                </Link>
              )
            })
          )
        ) : (
          SECTIONS.map((section) => (
            <div key={section.label} style={{ marginBottom: expanded ? 16 : 10 }}>
              {expanded && (
                <div
                  style={{
                    fontSize: 10.5, fontWeight: 600, color: C.sectionLabel,
                    letterSpacing: '0.04em', padding: '0 10px 7px', whiteSpace: 'nowrap',
                  }}
                >
                  {section.label}
                </div>
              )}
              {section.items.map(renderItem)}
            </div>
          ))
        )}
      </nav>

      {/* ── 하단: 사용자 + 로그아웃 ──────────────────────────── */}
      <div style={{ borderTop: `1px solid ${C.panelBorder}`, paddingTop: 10, marginTop: 6 }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 9,
            padding: expanded ? '4px 6px' : '4px 0',
            justifyContent: expanded ? 'flex-start' : 'center',
          }}
        >
          <span
            title={!expanded ? (displayName || '사용자') : undefined}
            style={{
              width: 30, height: 30, borderRadius: '50%', background: C.accent, color: '#fff',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 600, flexShrink: 0,
            }}
          >
            {(displayName || '?').slice(0, 1)}
          </span>
          {expanded && (
            <span
              style={{
                flex: 1, fontSize: 13, fontWeight: 500, color: C.textStrong,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {displayName || '사용자'}
            </span>
          )}
          {expanded && (
            <button
              onClick={handleLogout}
              title="로그아웃"
              aria-label="로그아웃"
              className="si-nav-row"
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer', color: C.muted,
                borderRadius: 8, padding: '6px', lineHeight: 0, display: 'inline-flex',
                flexShrink: 0,
              }}
            >
              <Icon name="logout" size={16} />
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}

// ── 활성 좌측 인디케이터 (파란 막대) ───────────────────────────────
const ActiveBar: React.FC<{ show: boolean }> = ({ show }) =>
  show ? (
    <span
      style={{
        position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
        width: 3, height: 17, borderRadius: 2, background: C.accent,
      }}
    />
  ) : null

// ── 카운트 배지 ────────────────────────────────────────────────────
const Badge: React.FC<{ value: number; active: boolean }> = ({ value, active }) => (
  <span
    style={{
      flexShrink: 0,
      fontSize: 11,
      fontWeight: 600,
      lineHeight: 1.4,
      padding: '1px 7px',
      borderRadius: 9999,
      background: active ? C.accent : C.badgeBg,
      color: active ? '#fff' : C.badgeText,
    }}
  >
    {value}
  </span>
)

// ── 스타일 헬퍼 ────────────────────────────────────────────────────
const iconWrap: React.CSSProperties = {
  width: 18,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
}

function labelStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    color: active ? C.textStrong : C.text,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }
}

function rowStyle(active: boolean, expanded: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: expanded ? '8px 10px' : '8px 0',
    justifyContent: expanded ? 'flex-start' : 'center',
    borderRadius: 9,
    textDecoration: 'none',
    background: active ? C.activeBg : 'transparent',
    transition: 'background 0.15s',
    userSelect: 'none',
  }
}

function subRowStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '7px 10px 7px 38px',
    borderRadius: 9,
    textDecoration: 'none',
    background: active ? C.activeBg : 'transparent',
    transition: 'background 0.15s',
    userSelect: 'none',
  }
}

export default Sidebar
