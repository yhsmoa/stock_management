import React from 'react'
import { theme } from '../../styles/theme'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'info' | 'default'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary:   { backgroundColor: theme.colors.primary,   color: 'white', border: 'none' },
  secondary: { backgroundColor: theme.colors.secondary, color: 'white', border: 'none' },
  danger:    { backgroundColor: theme.colors.danger,    color: 'white', border: 'none' },
  info:      { backgroundColor: theme.colors.info,      color: 'white', border: 'none' },
  default:   { backgroundColor: 'white', color: theme.colors.textPrimary, border: `1px solid ${theme.colors.border}` },
}

const hoverColors: Record<ButtonVariant, string> = {
  primary:   theme.colors.primaryHover,
  secondary: theme.colors.secondaryHover,
  danger:    theme.colors.dangerHover,
  info:      theme.colors.infoHover,
  default:   theme.colors.bgHover,
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
    padding: '10px 22px',
    borderRadius: theme.radius.md,
    fontSize: '14px',
    fontWeight: '500',
    transition: 'background-color 0.2s, border-color 0.2s',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    position: 'relative',
    ...variantStyles[variant],
    ...style,
  }

  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!disabled) {
      e.currentTarget.style.backgroundColor = hoverColors[variant]
      if (variant === 'default') e.currentTarget.style.borderColor = theme.colors.secondary
    }
    onMouseEnter?.(e)
  }

  const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!disabled) {
      e.currentTarget.style.backgroundColor = variantStyles[variant].backgroundColor as string
      if (variant === 'default') e.currentTarget.style.borderColor = theme.colors.border
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
