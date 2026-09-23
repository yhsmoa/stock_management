/* ================================================================
   라벨출력 모달 — 상품관리에서 고른 항목을 QZ Tray 로 바로 인쇄
   - 항목마다 성인/키즈를 나누고 종류(라벨 스티커 · 케어 라벨)×대상별 템플릿을 자동 선택
     (useLabelTemplatePlan — 기본 템플릿 우선, 드롭다운으로 바꿀 수 있음)
   - 템플릿마다 "이 PC 의 어떤 프린터" 로 뽑을지 여기서 바로 지정 (PrinterAssignPanel —
     [라벨 설정] 프린터 탭과 같은 저장소)
   - 인쇄는 services/labelPrintService.ts (바인딩 → TSPL/ZPL → QZ Tray → 인쇄 기록)
   - 진단: 페이지 URL 에 ?labelDebug=1 이면 인쇄 대신 명령 바이트를 파일로 내려받는 버튼이 생긴다
   ================================================================ */

import React, { useCallback, useEffect, useState } from 'react'
import { theme } from '../../styles/theme'
import { useTranslation } from '../../utils/label/i18n'
import { labelJobExt } from '../../utils/label/labelJob'
import { LABEL_AUDIENCES, type LabelTemplate, type LabelType } from '../../utils/label/labelTypes'
import {
  buildPrintJobs,
  printLabels,
  type LabelPrintItem,
  type PrintLabelResult,
} from '../../services/labelPrintService'
import { fetchLabelUser, type LabelUser } from '../../services/labelTemplateService'
import { getCurrentLabelAccount } from '../../services/labelService'
import { useLabelTemplatePlan } from './useLabelTemplatePlan'
import { usePrinterAssignments } from './usePrinterAssignments'
import LabelTemplatePicker from './LabelTemplatePicker'
import PrinterAssignPanel from './PrinterAssignPanel'
import './LabelPrintModal.css'

// ── 상수 ──────────────────────────────────────────────────────────
const FLASH_MS = 3000

/** 인쇄 명령 바이트를 파일로 (진단용) */
function downloadBytes(fileName: string, bytes: Uint8Array): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/octet-stream' }))
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 3000)
}

interface Props {
  open: boolean
  /** 인쇄할 항목 (바코드 있는 행만 — services/labelService.ts toLabelPrintItems) */
  items: LabelPrintItem[]
  onClose: () => void
}

const LabelPrintModal: React.FC<Props> = ({ open, items, onClose }) => {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<LabelType | 'all' | null>(null)
  const [flash, setFlash] = useState<Partial<Record<LabelType, string>>>({})
  const [labelUser, setLabelUser] = useState<LabelUser | null>(null)
  const isDebug = new URLSearchParams(window.location.search).get('labelDebug') === '1'

  // ── 로그인 계정 — 템플릿 범위("내 것 + 공용") · 계정 정보 바인딩(acc_*) · 인쇄 기록 ──
  const account = getCurrentLabelAccount()
  const userId = account?.id ?? null
  useEffect(() => {
    if (!open || !userId) return
    let cancelled = false
    fetchLabelUser(userId)
      .then((u) => { if (!cancelled) setLabelUser(u) })
      .catch((err) => {
        console.error('라벨 계정 정보 조회 오류:', err)
        if (!cancelled) setLabelUser(null)
      })
    return () => { cancelled = true }
  }, [open, userId])

  // ── 템플릿 계획 · 이 PC 프린터 (열릴 때마다 새로 읽는다) ──
  const plan = useLabelTemplatePlan({ active: open, userId, items })
  const printers = usePrinterAssignments(open)

  useEffect(() => {
    if (open) setFlash({})
  }, [open])

  useEffect(() => {
    if (Object.keys(flash).length === 0) return
    const timer = setTimeout(() => setFlash({}), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash])

  /** 결과의 i18n 키를 문구로 */
  const errorText = useCallback(
    (labelType: LabelType, r: PrintLabelResult): string => {
      if (!r.errorKey) return t('print.printFailed')
      const p = { ...(r.errorParams ?? {}) }
      if (r.errorKey === 'print.noTemplate') {
        p.audience = String(p.audienceKeys ?? '')
          .split(',')
          .map((k) => t(k === 'kids' ? 'print.templateKids' : 'print.templateAdult'))
          .join(', ')
        p.type = t(labelType === 'care' ? 'print.careLabel' : 'print.labelSticker')
      }
      const base = t(r.errorKey, p)
      return r.errorDetail ? `${base}\n\n(${r.errorDetail})` : base
    },
    [t]
  )

  // ── 종류 하나 인쇄 ──
  const printOne = useCallback(
    async (labelType: LabelType): Promise<boolean> => {
      const result = await printLabels({
        items,
        account: labelUser,
        labelType,
        templates: plan.selectedOf(labelType),
        printedBy: account?.username ?? null,
      })
      if (result.success) {
        const typeLabel = t(labelType === 'care' ? 'print.careLabel' : 'print.labelSticker')
        setFlash((f) => ({ ...f, [labelType]: `${typeLabel} ${t('print.printedCount', { count: result.printed })}` }))
        return true
      }
      alert(errorText(labelType, result))
      return false
    },
    [items, labelUser, plan, account?.username, t, errorText]
  )

  const handlePrint = useCallback(
    async (which: LabelType | 'all') => {
      setBusy(which)
      try {
        if (which === 'all') {
          if (await printOne('barcode')) await printOne('care')
        } else {
          await printOne(which)
        }
      } finally {
        setBusy(null)
      }
    },
    [printOne]
  )

  // ── 진단: 인쇄 대신 프린터로 갈 바이트를 파일로 (?labelDebug=1) ──
  const handleSaveCommands = useCallback(async () => {
    setBusy('all')
    try {
      let saved = 0
      for (const labelType of ['barcode', 'care'] as LabelType[]) {
        const jobs = await buildPrintJobs({ items, account: labelUser, templates: plan.selectedOf(labelType) })
        for (const job of jobs) {
          const safeName = job.template.name.replace(/[\\/:*?"<>|]+/g, '_')
          downloadBytes(`${labelType}_${safeName}_${job.labels}장.${labelJobExt(job.template)}`, job.bytes)
          saved++
        }
      }
      alert(t('print.debugSaved', { count: saved }))
    } catch (err) {
      console.error('인쇄 명령 저장 오류:', err)
      alert(t('print.printFailed'))
    } finally {
      setBusy(null)
    }
  }, [items, labelUser, plan, t])

  // ── 버튼 활성 조건 — 템플릿이 모두 정해지고, 그 템플릿마다 프린터가 있어야 ──
  const usedOf = (labelType: LabelType): LabelTemplate[] =>
    Object.values(plan.selectedOf(labelType)).filter((tpl): tpl is LabelTemplate => !!tpl)
  const usedBarcode = usedOf('barcode')
  const usedCare = usedOf('care')
  const usedTemplates = [...usedBarcode, ...usedCare].filter(
    (tpl, i, arr) => arr.findIndex((x) => x.id === tpl.id) === i
  )
  const noPrinter = (list: LabelTemplate[]) => list.some((tpl) => !printers.map[tpl.id])
  const barcodeMissing = plan.missingOf('barcode').length > 0 || noPrinter(usedBarcode)
  const careMissing = plan.missingOf('care').length > 0 || noPrinter(usedCare)
  const disabled = busy !== null || plan.loading || items.length === 0

  // ============================================================
  // 렌더링
  // ============================================================
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: open ? 'flex' : 'none',
        alignItems: 'center', justifyContent: 'center',
        background: theme.colors.overlay,
      }}
      onClick={busy ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 600, maxWidth: '94vw', maxHeight: '94vh',
          background: theme.colors.bgCard,
          borderRadius: theme.radius.lg,
          boxShadow: theme.shadows.modal,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* ── 헤더 ── */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', borderBottom: `1px solid ${theme.colors.border}`,
          }}
        >
          <h3 style={{ margin: 0, fontSize: theme.fontSize.lg, color: theme.colors.textPrimary }}>
            라벨출력
            <span style={{ marginLeft: 8, fontSize: theme.fontSize.sm, color: theme.colors.textSecondary, fontWeight: 400 }}>
              {t('print.itemsCount', { count: items.length })}
            </span>
          </h3>
          <button
            onClick={onClose}
            disabled={busy !== null}
            style={{
              padding: '6px 14px', border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radius.sm, background: theme.colors.bgCard,
              color: theme.colors.textPrimary, cursor: busy ? 'not-allowed' : 'pointer', fontSize: theme.fontSize.sm,
            }}
          >
            닫기
          </button>
        </div>

        {/* ── 본문 ── */}
        <div className="pe-root">
          <div className="pe-head">
            <span className="pe-aud">
              {LABEL_AUDIENCES.filter((a) => plan.counts[a.key] > 0)
                .map((a) => `${t(a.key === 'kids' ? 'print.templateKids' : 'print.templateAdult')} ${plan.counts[a.key]}`)
                .join(' · ')}
            </span>
          </div>

          <div className="pe-plan">
            <LabelTemplatePicker plan={plan} labelType="barcode" title={t('print.labelSticker')} disabled={busy !== null} />
            <LabelTemplatePicker plan={plan} labelType="care" title={t('print.careLabel')} disabled={busy !== null} />
            <div className="pe-hint">{t('print.templateHint')}</div>
          </div>

          <PrinterAssignPanel templates={usedTemplates} printers={printers} disabled={busy !== null} />

          {(flash.barcode || flash.care) && (
            <div className="pe-flash-row">
              {flash.barcode && <span className="pe-flash">✓ {flash.barcode}</span>}
              {flash.care && <span className="pe-flash">✓ {flash.care}</span>}
            </div>
          )}

          <div className="pe-buttons">
            <button className="pe-btn pe-btn-print" disabled={disabled || barcodeMissing} onClick={() => handlePrint('barcode')}>
              {busy === 'barcode' ? t('print.printing') : t('print.labelSticker')}
            </button>
            <button className="pe-btn pe-btn-print" disabled={disabled || careMissing} onClick={() => handlePrint('care')}>
              {busy === 'care' ? t('print.printing') : t('print.careLabel')}
            </button>
            <button className="pe-btn pe-btn-all" disabled={disabled || barcodeMissing || careMissing} onClick={() => handlePrint('all')}>
              {busy === 'all' ? t('print.printing') : t('print.all')}
            </button>
          </div>

          {isDebug && (
            <div className="pe-debug">
              <button type="button" className="pe-btn pe-btn-debug" disabled={disabled} onClick={handleSaveCommands}>
                {t('print.debugSave')}
              </button>
              <span className="pe-hint">{t('print.debugHint')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default LabelPrintModal
