/* ================================================================
   SearchBar — 공용 검색 입력 컴포넌트
   - 돋보기 아이콘 + 입력 + Enter 검색
   - 입체감(그림자·인셋 하이라이트)은 SearchBar.css 에서 관리
   - 페이지별 폭/여백은 className / style 로 주입
   ================================================================ */

import React from 'react'
import './SearchBar.css'

// ── Props ─────────────────────────────────────────────────────────
interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  /** Enter 키로 검색 실행 */
  onSubmit?: () => void
  placeholder?: string
  /** 래퍼에 추가할 클래스 (폭·여백 조정 등) */
  className?: string
  style?: React.CSSProperties
  disabled?: boolean
}

// ══════════════════════════════════════════════════════════════════
// 컴포넌트
// ══════════════════════════════════════════════════════════════════

const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder,
  className,
  style,
  disabled = false,
}) => {
  return (
    <div className={`searchbar${className ? ` ${className}` : ''}`} style={style}>
      {/* ── 돋보기 아이콘 ────────────────────────────────────── */}
      <svg
        className="searchbar-icon"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>

      {/* ── 입력 ─────────────────────────────────────────────── */}
      <input
        className="searchbar-input"
        type="text"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit?.()
        }}
      />
    </div>
  )
}

export default SearchBar
