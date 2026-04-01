import type React from 'react'

// ═══════════════════════════════════════════════════════════════════
// ── 디자인 토큰 중앙 관리 ─────────────────────────────────────────
// 모든 컴포넌트에서 import { theme } from '../styles/theme' 로 참조
// ═══════════════════════════════════════════════════════════════════

export const theme = {
  // ── 색상 ────────────────────────────────────────────────────────
  colors: {
    // Primary (블루 계열)
    primary:        '#4A8CF7',
    primaryHover:   '#3A7CE6',
    primaryLight:   '#EBF2FE',

    // Secondary (그레이)
    secondary:      '#6B7280',
    secondaryHover: '#5B6270',

    // Danger (레드)
    danger:         '#EF4444',
    dangerHover:    '#DC2626',
    dangerLight:    '#FEF2F2',

    // Info (블루)
    info:           '#3B82F6',
    infoHover:      '#2563EB',

    // 상태 색상
    success:        '#22C55E',
    warning:        '#F59E0B',

    // 텍스트
    textPrimary:    '#1F2937',
    textSecondary:  '#6B7280',
    textMuted:      '#9CA3AF',
    textWhite:      '#FFFFFF',

    // 배경
    bgPage:         '#F0F2F5',
    bgCard:         '#FFFFFF',
    bgTableHeader:  '#F8FAFC',
    bgHover:        '#F8FAFC',

    // 사이드바
    sidebarBg:      '#1E293B',
    sidebarHover:   '#334155',
    sidebarText:    '#E2E8F0',
    sidebarSubText: '#94A3B8',

    // 테두리
    border:         '#E5E7EB',
    borderLight:    '#F3F4F6',
    borderFocus:    '#4A8CF7',

    // 오버레이
    overlay:        'rgba(0, 0, 0, 0.4)',
  },

  // ── 둥글기 ──────────────────────────────────────────────────────
  radius: {
    sm:   '6px',
    md:   '8px',
    lg:   '12px',
    xl:   '16px',
    full: '9999px',
  },

  // ── 그림자 ──────────────────────────────────────────────────────
  shadows: {
    sm:    '0 1px 2px rgba(0, 0, 0, 0.05)',
    card:  '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)',
    md:    '0 4px 6px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.04)',
    lg:    '0 10px 25px rgba(0, 0, 0, 0.1)',
    modal: '0 20px 60px rgba(0, 0, 0, 0.15)',
  },

  // ── 폰트 크기 ───────────────────────────────────────────────────
  fontSize: {
    xs:   '12px',
    sm:   '13px',
    base: '14px',
    md:   '15px',
    lg:   '16px',
    xl:   '18px',
    '2xl': '20px',
    '3xl': '24px',
    '4xl': '28px',
  },

  // ═══════════════════════════════════════════════════════════════
  // ── 프리셋 (자주 사용하는 스타일 조합) ────────────────────────
  // ═══════════════════════════════════════════════════════════════

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius:    '12px',
    boxShadow:       '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)',
    border:          '1px solid #F3F4F6',
  } as React.CSSProperties,

  input: {
    padding:         '10px 14px',
    border:          '1px solid #E5E7EB',
    borderRadius:    '8px',
    fontSize:        '14px',
    backgroundColor: '#FFFFFF',
    outline:         'none',
    transition:      'border-color 0.2s, box-shadow 0.2s',
    boxSizing:       'border-box' as const,
  } as React.CSSProperties,

  // ── 테이블 프리셋 ─────────────────────────────────────────────
  table: {
    container: {
      backgroundColor: '#FFFFFF',
      borderRadius:    '12px',
      boxShadow:       '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)',
      overflow:        'hidden',
      border:          '1px solid #F3F4F6',
    } as React.CSSProperties,
    thead: {
      backgroundColor: '#F8FAFC',
      borderBottom:    '1px solid #E5E7EB',
    } as React.CSSProperties,
    th: {
      padding:     '12px 16px',
      textAlign:   'left' as const,
      fontWeight:  '600',
      color:       '#6B7280',
      fontSize:    '13px',
      whiteSpace:  'nowrap' as const,
    } as React.CSSProperties,
    td: {
      padding:  '12px 16px',
      color:    '#1F2937',
      fontSize: '14px',
    } as React.CSSProperties,
    tr: {
      borderBottom: '1px solid #F3F4F6',
      transition:   'background-color 0.15s',
    } as React.CSSProperties,
  },

  // ── 모달 프리셋 ──────────────────────────────────────────────
  modal: {
    overlay: {
      position:        'fixed' as const,
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
      display:         'flex',
      alignItems:      'center',
      justifyContent:  'center',
      zIndex:          9999,
    } as React.CSSProperties,
    content: {
      backgroundColor: '#FFFFFF',
      borderRadius:    '16px',
      padding:         '28px 32px',
      boxShadow:       '0 20px 60px rgba(0, 0, 0, 0.15)',
    } as React.CSSProperties,
  },
} as const
