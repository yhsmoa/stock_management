/* ================================================================
   쿠팡문의 (CoupangInquiry) — 쿠팡 고객센터 문의 (callCenterInquiries)
   - 구성은 사용자 피드백 후 진행 예정 (현재는 자리표시자).
   - 참고 가이드: coupang_api_md/coupang_cs.md (2장)
   ================================================================ */

import React from 'react'
import { theme } from '../styles/theme'

const CoupangInquiry: React.FC = () => {
  return (
    <div style={{ padding: '24px 28px' }}>
      <h1 style={{ fontSize: theme.fontSize['3xl'], fontWeight: 700, color: theme.colors.textPrimary, margin: '0 0 16px' }}>
        쿠팡문의
      </h1>
      <div
        style={{
          ...theme.card,
          padding: '40px',
          textAlign: 'center',
          color: theme.colors.textSecondary,
          fontSize: theme.fontSize.base,
        }}
      >
        쿠팡 고객센터 문의 페이지는 준비 중입니다.
      </div>
    </div>
  )
}

export default CoupangInquiry
