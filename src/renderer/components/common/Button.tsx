import React from 'react'

// coupang-return 페이지 버튼 스타일 기반 공통 버튼 컴포넌트
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'info' | 'default'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary:   { backgroundColor: '#4CAF50', color: 'white', border: 'none' },
  secondary: { backgroundColor: '#6c757d', color: 'white', border: 'none' },
  danger:    { backgroundColor: '#dc3545', color: 'white', border: 'none' },
  info:      { backgroundColor: '#007bff', color: 'white', border: 'none' },
  default:   { backgroundColor: 'white',   color: '#333',  border: '1px solid #ddd' },
}

const hoverColors: Record<ButtonVariant, string> = {
  primary:   '#45a049',
  secondary: '#5a6268',
  danger:    '#c82333',
  info:      '#0056b3',
  default:   '#f8f9fa',
}

const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  disabled = false,
  children,
  style,
  onMouseEnter,
  onMouseLeave,
  ...rest
}) => {
  const combinedStyle: React.CSSProperties = {
    padding: '10px 20px',
    borderRadius: '4px',
    fontSize: '14px',
    transition: 'background-color 0.3s',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    position: 'relative',
    ...variantStyles[variant],
    ...style,
  }

  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!disabled) {
      e.currentTarget.style.backgroundColor = hoverColors[variant]
      if (variant === 'default') e.currentTarget.style.borderColor = '#999'
    }
    onMouseEnter?.(e)
  }

  const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!disabled) {
      e.currentTarget.style.backgroundColor = variantStyles[variant].backgroundColor as string
      if (variant === 'default') e.currentTarget.style.borderColor = '#ddd'
    }
    onMouseLeave?.(e)
  }

  return (
    <button
      style={combinedStyle}
      disabled={disabled}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...rest}
    >
      {children}
    </button>
  )
}

export default Button
