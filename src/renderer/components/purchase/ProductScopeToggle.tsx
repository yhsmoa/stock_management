/* ================================================================
   [상품기준] 체크박스 — 사입관리 필터·정렬 조건의 적용 단위
   - 체크(기본): 조건에 맞는 옵션이 하나라도 있으면 해당 상품의 옵션 전체 표시
   - 해제     : 조건에 맞는 옵션만 표시
   - hover 시 마우스 오른쪽에 설명 툴팁을 띄운다 (마우스를 따라 이동)
   ================================================================ */

import React, { useState } from 'react'
import { theme } from '../../styles/theme'

// ── 상수: 툴팁 배치 ───────────────────────────────────────────
/** 마우스 포인터와 툴팁 사이 간격 */
const TIP_OFFSET = 14
/** 툴팁 최대 너비 — 오른쪽 공간이 이보다 좁으면 마우스 왼쪽으로 뒤집는다 */
const TIP_MAX_WIDTH = 320

const TIP_TEXT = [
  '상품 기준의 경우 조건에 해당하는 옵션이 하나 있으면 해당 상품의 모든 옵션이 표시됩니다.',
  '체크를 해제하시면 해당하는 옵션만 표시됩니다.',
]

// ══════════════════════════════════════════════════════════════════
// 컴포넌트
// ══════════════════════════════════════════════════════════════════

interface ProductScopeToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
}

const ProductScopeToggle: React.FC<ProductScopeToggleProps> = ({ checked, onChange }) => {
  // ── hover 툴팁 위치 (null = 숨김) ──
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)

  const trackMouse = (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY })

  // 오른쪽 공간이 부족할 때만 왼쪽으로 뒤집는다
  const flipLeft = tip != null && tip.x + TIP_OFFSET + TIP_MAX_WIDTH > window.innerWidth

  return (
    <>
      <label
        onMouseEnter={trackMouse}
        onMouseMove={trackMouse}
        onMouseLeave={() => setTip(null)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: theme.fontSize.xs,
          fontWeight: 500,
          color: theme.colors.textPrimary,
          cursor: 'pointer',
          userSelect: 'none',
          whiteSpace: 'nowrap',
          marginLeft: '4px',
        }}
      >
        <input
          type="checkbox"
          className="purchase-checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        상품기준
      </label>

      {/* ── 설명 툴팁 (마우스 오른쪽, 세로 가운데) ── */}
      {tip && (
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            left: flipLeft ? tip.x - TIP_OFFSET : tip.x + TIP_OFFSET,
            top: tip.y,
            transform: flipLeft ? 'translate(-100%, -50%)' : 'translate(0, -50%)',
            maxWidth: `${TIP_MAX_WIDTH}px`,
            padding: '8px 10px',
            borderRadius: theme.radius.sm,
            background: 'rgba(17, 24, 39, 0.92)',
            color: theme.colors.textWhite,
            fontSize: theme.fontSize.xs,
            fontWeight: 500,
            lineHeight: 1.5,
            whiteSpace: 'normal',
            wordBreak: 'keep-all',
            boxShadow: theme.shadows.md,
            pointerEvents: 'none',
            zIndex: 2100,
          }}
        >
          {TIP_TEXT.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
    </>
  )
}

export default ProductScopeToggle
