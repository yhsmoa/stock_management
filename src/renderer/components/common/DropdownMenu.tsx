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
}

const DropdownMenu: React.FC<DropdownMenuProps> = ({
  label,
  children,
  triggerClassName,
  align = 'left',
  disabled,
}) => (
  <div className="dropdown">
    <button
      type="button"
      className={`dropdown-trigger${triggerClassName ? ` ${triggerClassName}` : ''}`}
      disabled={disabled}
    >
      {label}
    </button>
    <div className={`dropdown-menu dropdown-menu-${align}`}>{children}</div>
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

export default DropdownMenu
