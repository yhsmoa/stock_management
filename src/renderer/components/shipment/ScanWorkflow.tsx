import React, { useRef, useEffect, useCallback } from 'react'
import type { ScanState, ScanStep } from '../../types/shipment'
import { theme } from '../../styles/theme'

interface ScanWorkflowProps {
  scanState: ScanState
  onScanStateChange: (state: ScanState) => void
  onScanComplete: (box: string, location: string, barcode: string) => void
}

// ── 스텝 설정 ───────────────────────────────────────────────────────
const STEPS: { key: ScanStep; label: string; placeholder: string }[] = [
  { key: 'box',      label: '박스위치',    placeholder: '박스 바코드 스캔' },
  { key: 'location', label: '출고위치',    placeholder: '출고 위치 스캔' },
  { key: 'barcode',  label: '상품바코드',  placeholder: '상품 바코드 스캔' },
]

const ScanWorkflow: React.FC<ScanWorkflowProps> = ({
  scanState,
  onScanStateChange,
  onScanComplete,
}) => {
  const hiddenInputRef = useRef<HTMLInputElement>(null)

  // ── 활성 스텝 변경 시 숨김 입력에 포커스 ──────────────────────────
  useEffect(() => {
    setTimeout(() => hiddenInputRef.current?.focus(), 50)
  }, [scanState.activeStep])

  // ── 스텝 버튼 클릭 → 해당 스텝 활성화 + 포커스 ───────────────────
  const handleStepClick = useCallback((step: ScanStep) => {
    onScanStateChange({ ...scanState, activeStep: step, [`${step}Value`]: '' })
    setTimeout(() => hiddenInputRef.current?.focus(), 50)
  }, [scanState, onScanStateChange])

  // ── 숨김 input 값 변경 ───────────────────────────────────────────
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const step = scanState.activeStep
    onScanStateChange({ ...scanState, [`${step}Value`]: e.target.value })
  }, [scanState, onScanStateChange])

  // ── Enter → 다음 스텝 또는 스캔 완료 ─────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return
    e.preventDefault()

    const step = scanState.activeStep
    const value = scanState[`${step}Value`].trim()
    if (!value) return

    if (step === 'box') {
      onScanStateChange({ ...scanState, activeStep: 'location', locationValue: '' })
    } else if (step === 'location') {
      onScanStateChange({ ...scanState, activeStep: 'barcode', barcodeValue: '' })
    } else if (step === 'barcode') {
      onScanComplete(scanState.boxValue.trim(), scanState.locationValue.trim(), value)
      onScanStateChange({ ...scanState, barcodeValue: '', activeStep: 'barcode' })
    }
  }, [scanState, onScanStateChange, onScanComplete])

  const activeStep = scanState.activeStep
  const currentValue = scanState[`${activeStep}Value`]
  const activePlaceholder = STEPS.find(s => s.key === activeStep)!.placeholder

  return (
    <div style={{
      marginBottom: '16px',
      ...theme.card,
      padding: '16px',
      position: 'relative',
    }}>
      {/* ── 숨김 input (키보드 입력 수신) ────────────────────────── */}
      <input
        ref={hiddenInputRef}
        type="text"
        value={currentValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={activePlaceholder}
        style={{
          position: 'fixed',
          left: '-9999px',
          top: '-9999px',
          opacity: 0,
          fontSize: '16px',
        }}
      />

      {/* ── 3개 버튼 ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '12px' }}>
        {STEPS.map(({ key, label }) => {
          const isActive = activeStep === key
          const stepValue = scanState[`${key}Value`]

          return (
            <div
              key={key}
              onClick={() => handleStepClick(key)}
              style={{
                flex: 1,
                minHeight: '80px',
                padding: '12px 16px',
                borderRadius: theme.radius.md,
                border: isActive ? `3px solid ${theme.colors.primary}` : `2px solid ${theme.colors.border}`,
                backgroundColor: isActive ? theme.colors.primaryLight : theme.colors.bgCard,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                transition: 'all 0.2s',
                outline: 'none',
              }}
            >
              <span style={{ fontSize: '13px', fontWeight: '600', color: theme.colors.textSecondary }}>
                {label}
              </span>
              <span style={{
                fontSize: '18px',
                fontWeight: '700',
                color: isActive && !stepValue ? '#adb5bd' : theme.colors.textPrimary,
                minHeight: '24px',
              }}>
                {stepValue || (isActive ? activePlaceholder : '-')}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default ScanWorkflow
