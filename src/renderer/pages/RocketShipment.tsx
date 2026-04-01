import React from 'react'
import { theme } from '../styles/theme'

const RocketShipment: React.FC = () => {
  return (
    <div style={{ padding: '20px' }}>
      <h1 style={{ marginBottom: '20px', fontSize: '28px', color: theme.colors.textPrimary }}>로켓출고</h1>
      <div
        style={{
          ...theme.card,
          padding: '20px',
        }}
      >
        <p style={{ fontSize: '16px', color: theme.colors.textSecondary }}>로켓출고 페이지입니다.</p>
      </div>
    </div>
  )
}

export default RocketShipment
