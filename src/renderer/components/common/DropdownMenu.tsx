/* ================================================================
   DropdownMenu — hover 로 펼쳐지는 공용 드롭다운 메뉴
   - 사입관리(PurchaseManagement)의 '바코드 연결' 드롭다운 패턴을
     컴포넌트화하여 페이지 간 재사용.
   - 트리거 버튼 위에 마우스를 올리면 하위 항목이 펼쳐진다(CSS hover).
   - 항목은 DropdownItem(액션) 또는 <label class="dropdown-item">(파일 업로드)
     으로 구성한다.
   ================================================================ */

import React from 'react'
import './DropdownMenu.css'

// ── 메뉴 컨테이너 ─────────────────────────────────────────────
interface DropdownMenuProps {
  /** 트리거 버튼에 표시할 내용 */
  label: React.ReactNode
  /** 하위 항목 (DropdownItem / label.dropdown-item) */
  children: React.ReactNode
  /** 트리거 버튼 추가 클래스 (예: 강조 스타일) */
  triggerClassName?: string
  /** 메뉴 정렬: 우측 끝 버튼은 'right' 로 화면 밖 넘침 방지 */
  align?: 'left' | 'right'
  /** 트리거 비활성화 */
  disabled?: boolean
  /**
   * DropdownSubmenu(플라이아웃)를 포함하는 경우 true.
   * 기본 메뉴는 overflow:hidden 이라 옆으로 펼쳐지는 하위 메뉴가 잘리므로 해제한다.
   */
  hasSubmenu?: boolean
}

const DropdownMenu: React.FC<DropdownMenuProps> = ({
  label,
  children,
  triggerClassName,
  align = 'left',
  disabled,
  hasSubmenu = false,
}) => (
  <div className={`dropdown${disabled ? ' dropdown-disabled' : ''}`}>
    <button
      type="button"
      className={`dropdown-trigger${triggerClassName ? ` ${triggerClassName}` : ''}`}
      disabled={disabled}
    >
      {label}
    </button>
    <div
      className={`dropdown-menu dropdown-menu-${align}${hasSubmenu ? ' dropdown-menu-host' : ''}`}
    >
      {children}
    </div>
  </div>
)

// ── 메뉴 항목 (액션 버튼) ─────────────────────────────────────
//   파일 업로드 항목은 <label className="dropdown-item"> 로 직접 구성한다.
export const DropdownItem: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement>
> = ({ className, children, ...rest }) => (
  <button
    type="button"
    className={`dropdown-item${className ? ` ${className}` : ''}`}
    {...rest}
  >
    {children}
  </button>
)

// ── 하위 메뉴 (오른쪽으로 펼쳐지는 플라이아웃) ─────────────────
//   부모 DropdownMenu 에 hasSubmenu 를 넘겨야 잘리지 않는다.
interface DropdownSubmenuProps {
  /** 상위 메뉴에 표시할 항목명 */
  label: React.ReactNode
  /** 하위 항목 (DropdownItem 등) */
  children: React.ReactNode
  /** 항목 추가 클래스 (예: 선택됨 강조 'active') */
  className?: string
}

export const DropdownSubmenu: React.FC<DropdownSubmenuProps> = ({
  label,
  children,
  className,
}) => (
  <div className="dropdown-submenu">
    <button
      type="button"
      className={`dropdown-item dropdown-submenu-trigger${className ? ` ${className}` : ''}`}
    >
      <span>{label}</span>
      <span className="dropdown-submenu-arrow" aria-hidden="true">›</span>
    </button>
    <div className="dropdown-submenu-menu">{children}</div>
  </div>
)

// ── 메뉴 내 구분 라벨 (예: '기간', '정렬') ─────────────────────
export const DropdownSection: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="dropdown-section">{children}</div>
)

export default DropdownMenu
