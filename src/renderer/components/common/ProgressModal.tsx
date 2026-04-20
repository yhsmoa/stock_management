/* ================================================================
   ProgressModal — 진행상황 범용 모달
   - 제목 + 진행률 바 + 상태 메시지 + (선택) 단계별 체크리스트
   - 엑셀 업로드, API 호출, 다단계 작업 진행상황 표시 공용
   ================================================================ */

import React from 'react'
import { theme } from '../../styles/theme'

// ── 단계 상태 타입 ────────────────────────────────────────────────
export type ProgressStepState = 'pending' | 'active' | 'done' | 'error'

export interface ProgressStep {
  label: string
  state: ProgressStepState
  /** 해당 단계의 세부 메시지 (예: "3/10") */
  detail?: string
}

// ── Props ─────────────────────────────────────────────────────────
interface ProgressModalProps {
  isOpen: boolean
  title?: string
  /** 0-100 범위 진행률. undefined 이면 진행률 바 숨김 */
  progress?: number
  /** 메인 상태 메시지 (한 줄) */
  status?: string
  /** 다단계 작업 시 단계별 상태 표시 */
  steps?: ProgressStep[]
}

// ══════════════════════════════════════════════════════════════════
// 단계 아이콘 (state 별)
// ══════════════════════════════════════════════════════════════════

const STEP_ICON_SIZE = 18

const StepIcon: React.FC<{ state: ProgressStepState }> = ({ state }) => {
  const base: React.CSSProperties = {
    width: STEP_ICON_SIZE,
    height: STEP_ICON_SIZE,
    borderRadius: theme.radius.full,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    fontWeight: 700,
    flexShrink: 0,
  }

  switch (state) {
    case 'done':
      return (
        <span style={{ ...base, background: theme.colors.success, color: theme.colors.textWhite }}>
          ✓
        </span>
      )
    case 'active':
      return (
        <span
          style={{
            ...base,
            border: `2px solid ${theme.colors.primary}`,
            borderTopColor: 'transparent',
            animation: 'pm-spin 0.8s linear infinite',
          }}
        />
      )
    case 'error':
      return (
        <span style={{ ...base, background: theme.colors.danger, color: theme.colors.textWhite }}>
          !
        </span>
      )
    case 'pending':
    default:
      return (
        <span
          style={{
            ...base,
            border: `2px solid ${theme.colors.border}`,
            background: theme.colors.bgCard,
          }}
        />
      )
  }
}

// ══════════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ══════════════════════════════════════════════════════════════════

const ProgressModal: React.FC<ProgressModalProps> = ({
  isOpen,
  title = '처리 중',
  progress,
  status,
  steps,
}) => {
  if (!isOpen) return null

  const showProgress = typeof progress === 'number'
  const hasSteps = Array.isArray(steps) && steps.length > 0

  return (
    <>
      {/* 스피너 keyframes (모달 열릴 때만 존재) */}
      <style>
        {`@keyframes pm-spin { to { transform: rotate(360deg); } }`}
      </style>

      <div style={{ ...theme.modal.overlay, zIndex: 1000 }}>
        <div
          style={{
            ...theme.modal.content,
            width: hasSteps ? '440px' : '400px',
          }}
        >
          {/* ── 제목 ─────────────────────────────────────────── */}
          <h2
            style={{
              fontSize: theme.fontSize.xl,
              fontWeight: 700,
              marginBottom: '20px',
              textAlign: 'center',
              color: theme.colors.textPrimary,
              margin: '0 0 20px 0',
            }}
          >
            {title}
          </h2>

          {/* ── 진행률 바 ────────────────────────────────────── */}
          {showProgress && (
            <div
              style={{
                width: '100%',
                height: '26px',
                backgroundColor: theme.colors.borderLight,
                borderRadius: theme.radius.full,
                overflow: 'hidden',
                marginBottom: '14px',
              }}
            >
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, progress!))}%`,
                  height: '100%',
                  backgroundColor: theme.colors.primary,
                  transition: 'width 0.3s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {progress! > 5 && (
                  <span
                    style={{
                      color: theme.colors.textWhite,
                      fontSize: theme.fontSize.sm,
                      fontWeight: 700,
                    }}
                  >
                    {Math.round(progress!)}%
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ── 메인 상태 메시지 ──────────────────────────────── */}
          {status && (
            <p
              style={{
                textAlign: 'center',
                color: theme.colors.textSecondary,
                fontSize: theme.fontSize.base,
                margin: hasSteps ? '0 0 16px 0' : 0,
              }}
            >
              {status}
            </p>
          )}

          {/* ── 단계별 리스트 ─────────────────────────────────── */}
          {hasSteps && (
            <div
              style={{
                marginTop: status ? '4px' : '8px',
                padding: '14px 16px',
                background: theme.colors.bgTableHeader,
                borderRadius: theme.radius.md,
                border: `1px solid ${theme.colors.borderLight}`,
              }}
            >
              {steps!.map((step, idx) => {
                const isActive = step.state === 'active'
                const isDone = step.state === 'done'
                const isError = step.state === 'error'
                const labelColor = isError
                  ? theme.colors.danger
                  : isActive
                    ? theme.colors.textPrimary
                    : isDone
                      ? theme.colors.textSecondary
                      : theme.colors.textMuted

                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '6px 0',
                    }}
                  >
                    <StepIcon state={step.state} />
                    <span
                      style={{
                        flex: 1,
                        fontSize: theme.fontSize.base,
                        color: labelColor,
                        fontWeight: isActive ? 600 : 500,
                      }}
                    >
                      {step.label}
                    </span>
                    {step.detail && (
                      <span
                        style={{
                          fontSize: theme.fontSize.xs,
                          color: theme.colors.textMuted,
                          fontFamily: 'monospace',
                        }}
                      >
                        {step.detail}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default ProgressModal
