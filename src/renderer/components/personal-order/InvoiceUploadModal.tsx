/* ================================================================
   InvoiceUploadModal — 송장 통합 업로드 모달
   - 왼쪽: 송장 엑셀(.xlsx) 업로드 박스 / 오른쪽: 송장 PDF(.pdf) 업로드 박스
   - 두 파일이 모두 선택되면 자동으로 분석(onAnalyze) → 요약 표시
       · 엑셀 등록 건수 / PDF 일치 건수 / 합배송·출고중지 제외 / 실패건+사유
   - [업로드] 클릭 시 onSubmit(xlsx, pdf) 로 실제 등록 (엑셀 운송장 저장 + PDF storage 업로드)
   - 부모(usePersonalOrder)가 주문 데이터를 알고 있으므로 분석/업로드 로직은 부모가 담당,
     이 컴포넌트는 파일 선택 UI + 요약 표시에 집중한다.
   ================================================================ */

import React, { useEffect, useRef, useState } from 'react'
import Button from '../common/Button'
import { theme } from '../../styles/theme'
import type { InvoiceUploadSummary } from '../../services/invoiceService'

// ── Props ─────────────────────────────────────────────────────────
interface InvoiceUploadModalProps {
  isOpen: boolean
  uploading?: boolean
  onClose: () => void
  onAnalyze: (xlsx: File, pdf: File) => Promise<InvoiceUploadSummary>
  onSubmit: (xlsx: File, pdf: File) => Promise<void>
}

// ══════════════════════════════════════════════════════════════════
// 파일 업로드 박스 (엑셀 / PDF 공용)
// ══════════════════════════════════════════════════════════════════

interface UploadBoxProps {
  title: string
  hint: string
  accept: string
  icon: string
  file: File | null
  disabled?: boolean
  onSelect: (file: File | null) => void
}

const UploadBox: React.FC<UploadBoxProps> = ({ title, hint, accept, icon, file, disabled, onSelect }) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const extOk = (name: string) =>
    accept.split(',').some((ext) => name.toLowerCase().endsWith(ext.trim().toLowerCase()))

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (disabled) return
    const dropped = e.dataTransfer.files?.[0]
    if (dropped && extOk(dropped.name)) onSelect(dropped)
  }

  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      style={{
        flex: 1,
        minWidth: 0,
        border: `2px dashed ${dragOver ? theme.colors.primary : file ? theme.colors.success : theme.colors.border}`,
        borderRadius: theme.radius.lg,
        background: dragOver ? theme.colors.primaryLight : file ? '#F0FDF4' : theme.colors.bgHover,
        padding: '24px 16px',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        disabled={disabled}
        onChange={(e) => {
          onSelect(e.target.files?.[0] ?? null)
          e.target.value = ''
        }}
      />
      <div style={{ fontSize: 28, marginBottom: 8 }}>{file ? '✅' : icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: theme.colors.textPrimary, marginBottom: 4 }}>
        {title}
      </div>
      {file ? (
        <>
          <div
            style={{ fontSize: 12, color: theme.colors.textPrimary, wordBreak: 'break-all', marginBottom: 6 }}
            title={file.name}
          >
            {file.name}
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (!disabled) onSelect(null) }}
            disabled={disabled}
            style={{
              fontSize: 11,
              color: theme.colors.danger,
              background: 'none',
              border: 'none',
              cursor: disabled ? 'not-allowed' : 'pointer',
              textDecoration: 'underline',
            }}
          >
            제거
          </button>
        </>
      ) : (
        <div style={{ fontSize: 12, color: theme.colors.textSecondary }}>{hint}</div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// 요약 행 (라벨 + 값)
// ══════════════════════════════════════════════════════════════════

const SummaryRow: React.FC<{ label: string; value: React.ReactNode; color?: string }> = ({ label, value, color }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '4px 0' }}>
    <span style={{ color: theme.colors.textSecondary }}>{label}</span>
    <span style={{ fontWeight: 600, color: color ?? theme.colors.textPrimary }}>{value}</span>
  </div>
)

// ══════════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ══════════════════════════════════════════════════════════════════

const InvoiceUploadModal: React.FC<InvoiceUploadModalProps> = ({
  isOpen,
  uploading = false,
  onClose,
  onAnalyze,
  onSubmit,
}) => {
  const [xlsxFile, setXlsxFile] = useState<File | null>(null)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [summary, setSummary] = useState<InvoiceUploadSummary | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  // ── 열릴 때 초기화 ────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setXlsxFile(null)
      setPdfFile(null)
      setSummary(null)
      setAnalyzing(false)
      setAnalyzeError(null)
    }
  }, [isOpen])

  // ── 두 파일이 모두 준비되면 자동 분석 ─────────────────────────
  useEffect(() => {
    if (!isOpen || !xlsxFile || !pdfFile) {
      setSummary(null)
      setAnalyzeError(null)
      return
    }
    let cancelled = false
    setAnalyzing(true)
    setAnalyzeError(null)
    onAnalyze(xlsxFile, pdfFile)
      .then((res) => { if (!cancelled) setSummary(res) })
      .catch((err) => { if (!cancelled) setAnalyzeError(err?.message ?? '분석 실패') })
      .finally(() => { if (!cancelled) setAnalyzing(false) })
    return () => { cancelled = true }
  }, [isOpen, xlsxFile, pdfFile, onAnalyze])

  if (!isOpen) return null

  const bothReady = !!xlsxFile && !!pdfFile
  const hasWork = !!summary && (summary.excelRegister > 0 || summary.pdfMatch > 0)
  const canSubmit = bothReady && !analyzing && !uploading && hasWork

  const handleSubmit = async () => {
    if (!canSubmit || !xlsxFile || !pdfFile) return
    await onSubmit(xlsxFile, pdfFile)
  }

  return (
    <div style={theme.modal.overlay} onClick={uploading ? undefined : onClose}>
      <div
        style={{ ...theme.modal.content, width: 560, maxWidth: '92vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 헤더 ──────────────────────────────────────────── */}
        <div style={{ fontSize: 16, fontWeight: 600, color: theme.colors.textPrimary, marginBottom: 4 }}>
          송장 업로드
        </div>
        <div style={{ fontSize: 13, color: theme.colors.textSecondary, marginBottom: 18 }}>
          송장 엑셀(운송장번호)과 PDF(송장 라벨)를 함께 올리면 자동으로 매칭·등록됩니다.
        </div>

        {/* ── 업로드 박스 2개 ───────────────────────────────── */}
        <div style={{ display: 'flex', gap: 12 }}>
          <UploadBox
            title="송장 엑셀"
            hint=".xlsx 파일을 끌어놓거나 클릭"
            accept=".xlsx,.xls"
            icon="📄"
            file={xlsxFile}
            disabled={uploading}
            onSelect={setXlsxFile}
          />
          <UploadBox
            title="송장 PDF"
            hint=".pdf 파일을 끌어놓거나 클릭"
            accept=".pdf"
            icon="📑"
            file={pdfFile}
            disabled={uploading}
            onSelect={setPdfFile}
          />
        </div>

        {/* ── 요약 ──────────────────────────────────────────── */}
        <div style={{ marginTop: 18, minHeight: 40 }}>
          {!bothReady ? (
            <div style={{ fontSize: 12, color: theme.colors.textMuted, textAlign: 'center', padding: '12px 0' }}>
              엑셀과 PDF를 모두 선택하면 등록 내역이 요약됩니다.
            </div>
          ) : analyzing ? (
            <div style={{ fontSize: 13, color: theme.colors.textSecondary, textAlign: 'center', padding: '12px 0' }}>
              분석 중...
            </div>
          ) : analyzeError ? (
            <div style={{ fontSize: 13, color: theme.colors.danger, textAlign: 'center', padding: '12px 0' }}>
              분석 실패: {analyzeError}
            </div>
          ) : summary ? (
            <div
              style={{
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.radius.md,
                padding: '12px 16px',
                background: theme.colors.bgHover,
              }}
            >
              <SummaryRow
                label="엑셀 운송장 등록"
                value={`${summary.excelRegister} / ${summary.excelTotal}건`}
                color={theme.colors.info}
              />
              <SummaryRow
                label="PDF 송장 일치"
                value={`${summary.pdfMatch} / ${summary.pdfTotal}건`}
                color={theme.colors.success}
              />
              {summary.combinedSkip > 0 && (
                <SummaryRow label="합배송 제외" value={`${summary.combinedSkip}건`} color={theme.colors.warning} />
              )}
              {summary.cancelSkip > 0 && (
                <SummaryRow label="출고중지 제외" value={`${summary.cancelSkip}건`} color={theme.colors.warning} />
              )}
              {summary.failures.length > 0 && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${theme.colors.border}` }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: theme.colors.danger, marginBottom: 4 }}>
                    실패 {summary.failures.length}건
                  </div>
                  <div style={{ maxHeight: 96, overflowY: 'auto' }}>
                    {summary.failures.map((f, i) => (
                      <div key={`${f.orderId}-${i}`} style={{ fontSize: 11, color: theme.colors.textSecondary, padding: '1px 0' }}>
                        <span style={{ color: theme.colors.textPrimary }}>{f.orderId || '(주문번호 없음)'}</span>
                        {' — '}{f.reason}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!hasWork && summary.failures.length === 0 && (
                <div style={{ fontSize: 12, color: theme.colors.textMuted, textAlign: 'center', paddingTop: 6 }}>
                  등록할 항목이 없습니다.
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* ── 푸터 ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <Button
            variant="default"
            onClick={onClose}
            disabled={uploading}
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            취소
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            {uploading ? '업로드 중...' : '업로드'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default InvoiceUploadModal
