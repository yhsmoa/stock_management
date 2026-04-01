import React from 'react'
import { theme } from '../../styles/theme'

interface LocationBadgeProps {
  location: string
  qty: number
  scannedQty: number
}

const LocationBadge: React.FC<LocationBadgeProps> = React.memo(({
  location,
  qty,
  scannedQty,
}) => {
  const isScanned = scannedQty > 0
  const isComplete = scannedQty >= qty && qty > 0

  const bgColor = isComplete ? theme.colors.success : isScanned ? theme.colors.warning : theme.colors.borderLight
  const textColor = (isComplete || isScanned) ? 'white' : theme.colors.textSecondary

  const badgeStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    borderRadius: theme.radius.sm,
    fontSize: '13px',
    fontWeight: 500,
    marginRight: '6px',
    marginBottom: '4px',
    backgroundColor: bgColor,
    color: textColor,
    transition: 'background-color 0.2s',
  }

  return (
    <span style={badgeStyle}>
      {location} ({qty})
      {isScanned && <span> 📦 {scannedQty}</span>}
    </span>
  )
})

LocationBadge.displayName = 'LocationBadge'

export default LocationBadge
