/* ================================================================
   InvoiceUploadModal — 송장 통합 업로드 모달
   - 왼쪽: 송장 엑셀(.xlsx) 1개 / 오른쪽: 송장 PDF(.pdf) 여러 개
       · PDF 는 분할 출력되는 경우가 많아 다중 선택을 지원한다.
   - 엑셀 1개 + PDF 1개 이상이 준비되면 자동 분석(onAnalyze) → 요약 표시
       · 엑셀 등록 건수 / PDF 일치 건수 / 합배송·출고중지 제외 / 실패건+사유
   - [업로드] 클릭 시 onSubmit(xlsx, pdfs) 로 실제 등록 (엑셀 운송장 저장 + PDF storage 업로드)
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
  onAnalyze: (xlsx: File, pdfs: File[]) => Promise<InvoiceUploadSummary>
  onSubmit: (xlsx: File, pdfs: File[]) => Promise<void>
}

// ── 동일 파일 판정 (이름+크기+수정시각) ───────────────────────────
//   같은 파일을 두 번 고르면 중복 파싱·업로드가 되므로 걸러낸다.
const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`

// ══════════════════════════════════════════════════════════════════
// 파일 업로드 박스 (엑셀 / PDF 공용)
//   multiple=false 면 항상 1개만 유지, true 면 선택할 때마다 누적된다.
// ══════════════════════════════════════════════════════════════════

interface UploadBoxProps {
  title: string
  hint: string
  accept: string
  icon: string
  files: File[]
  multiple?: boolean
  disabled?: boolean
  onChange: (files: File[]) => void
}

const UploadBox: React.FC<UploadBoxProps> = ({
  title, hint, accept, icon, files, multiple = false, disabled, onChange,
}) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const extOk = (name: string) =>
    accept.split(',').some((ext) => name.toLowerCase().endsWith(ext.trim().toLowerCase()))

  /** 선택/드롭된 파일 반영 — multiple 이면 기존 목록에 누적(중복 제외) */
  const accept_ = (incoming: File[]) => {
    const valid = incoming.filter((f) => extOk(f.name))
    if (valid.length === 0) return
    if (!multiple) {
      onChange([valid[0]])
      return
    }
    const seen = new Set(files.map(fileKey))
    const added = valid.filter((f) => !seen.has(fileKey(f)))
    if (added.length > 0) onChange([...files, ...added])
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (disabled) return
    accept_(Array.from(e.dataTransfer.files ?? []))
  }

  const hasFiles = files.length > 0

  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      style={{
        flex: 1,
        minWidth: 0,
        border: `2px dashed ${dragOver ? theme.colors.primary : hasFiles ? theme.colors.success : theme.colors.border}`,
        borderRadius: theme.radius.lg,
        background: dragOver ? theme.colors.primaryLight : hasFiles ? '#F0FDF4' : theme.colors.bgHover,
        padding: '20px 14px',
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
        multiple={multiple}
        style={{ display: 'none' }}
        disabled={disabled}
        onChange={(e) => {
          accept_(Array.from(e.target.files ?? []))
          e.target.value = ''   // 같은 파일 재선택 허용
        }}
      />

      <div style={{ fontSize: 26, marginBottom: 6 }}>{hasFiles ? '✅' : icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: theme.colors.textPrimary, marginBottom: 4 }}>
        {title}
        {multiple && hasFiles && (
          <span style={{ color: theme.colors.textSecondary, fontWeight: 500 }}> ({files.length})</span>
        )}
      </div>

      {hasFiles ? (
        <>
          {/* ── 선택된 파일 목록 (개별 제거) ── */}
          <div style={{ maxHeight: 92, overflowY: 'auto', marginBottom: 6, textAlign: 'left' }}>
            {files.map((f) => (
              <div
                key={fileKey(f)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 11.5, color: theme.colors.textPrimary, padding: '2px 0',
                }}
              >
                <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }} title={f.name}>
                  {f.name}
                </span>
                <button
                  type="button"
                  aria-label={`${f.name} 제거`}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!disabled) onChange(files.filter((x) => fileKey(x) !== fileKey(f)))
                  }}
                  disabled={disabled}
                  style={{
                    flexShrink: 0, fontSize: 13, lineHeight: 1, padding: '0 2px',
                    color: theme.colors.textMuted, background: 'none', border: 'none',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (!disabled) onChange([]) }}
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
            {multiple ? '모두 제거' : '제거'}
          </button>
          {multiple && (
            <div style={{ fontSize: 10.5, color: theme.colors.textMuted, marginTop: 4 }}>
              클릭하면 파일을 더 추가합니다
            </div>
          )}
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
  const [xlsxFiles, setXlsxFiles] = useState<File[]>([])
  const [pdfFiles, setPdfFiles] = useState<File[]>([])
  const [summary, setSummary] = useState<InvoiceUploadSummary | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  const xlsxFile = xlsxFiles[0] ?? null

  // ── 열릴 때 초기화 ────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setXlsxFiles([])
      setPdfFiles([])
      setSummary(null)
      setAnalyzing(false)
      setAnalyzeError(null)
    }
  }, [isOpen])

  // ── 엑셀 1개 + PDF 1개 이상이 준비되면 자동 분석 ───────────────
  //   pdfFiles 는 배열이라 참조가 매번 바뀌므로, 내용 기준 키로 의존성을 건다.
  const pdfKey = pdfFiles.map(fileKey).join('\n')

  useEffect(() => {
    if (!isOpen || !xlsxFile || pdfFiles.length === 0) {
      setSummary(null)
      setAnalyzeError(null)
      return
    }
    let cancelled = false
    setAnalyzing(true)
    setAnalyzeError(null)
    onAnalyze(xlsxFile, pdfFiles)
      .then((res) => { if (!cancelled) setSummary(res) })
      .catch((err) => { if (!cancelled) setAnalyzeError(err?.message ?? '분석 실패') })
      .finally(() => { if (!cancelled) setAnalyzing(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, xlsxFile, pdfKey, onAnalyze])

  if (!isOpen) return null

  const bothReady = !!xlsxFile && pdfFiles.length > 0
  const hasWork = !!summary && (summary.excelRegister > 0 || summary.pdfMatch > 0)
  const canSubmit = bothReady && !analyzing && !uploading && hasWork

  const handleSubmit = async () => {
    if (!canSubmit || !xlsxFile) return
    await onSubmit(xlsxFile, pdfFiles)
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
          PDF가 여러 개로 나뉘어 있으면 <strong>한 번에 여러 개</strong>를 선택하세요.
        </div>

        {/* ── 업로드 박스 2개 (엑셀 1개 / PDF 다중) ─────────── */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <UploadBox
            title="송장 엑셀"
            hint=".xlsx 파일을 끌어놓거나 클릭"
            accept=".xlsx,.xls"
            icon="📄"
            files={xlsxFiles}
            disabled={uploading}
            onChange={setXlsxFiles}
          />
          <UploadBox
            title="송장 PDF"
            hint=".pdf 파일을 끌어놓거나 클릭 (여러 개 가능)"
            accept=".pdf"
            icon="📑"
            files={pdfFiles}
            multiple
            disabled={uploading}
            onChange={setPdfFiles}
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
                label={`PDF 송장 일치${pdfFiles.length > 1 ? ` (${pdfFiles.length}개 파일)` : ''}`}
                value={`${summary.pdfMatch} / ${summary.pdfTotal}건`}
                color={theme.colors.success}
              />
              {summary.combinedSkip > 0 && (
                <SummaryRow label="합배송 제외" value={`${summary.combinedSkip}건`} color={theme.colors.warning} />
              )}
              {summary.cancelSkip > 0 && (
                <SummaryRow label="출고중지 제외" value={`${summary.cancelSkip}건`} color={theme.colors.warning} />
              )}
              {summary.duplicateSkip > 0 && (
                <SummaryRow label="주문번호 중복 제외" value={`${summary.duplicateSkip}건`} color={theme.colors.danger} />
              )}
              {summary.arrivedSkip > 0 && (
                <SummaryRow label="입고 완료 제외" value={`${summary.arrivedSkip}건`} color={theme.colors.info} />
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
