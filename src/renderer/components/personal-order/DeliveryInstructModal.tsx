/* ================================================================
   DeliveryInstructModal — [배송준비] 송장 엑셀 → 쿠팡 배송지시 등록
   - ① 파일 선택: 택배사·운송장번호를 채운 쿠팡 DeliveryList 엑셀 1개 → 사전 검사 요약 + 등록 불가 목록
   - ② 확인: [배송지시 등록 (N건)] — 버튼 문구와 요약이 확인 절차다 (중복 클릭은 훅이 막는다).
        분리배송(부분출고) 묶음이 있으면 줄별로 '지금 출고 / 나중 출고(출고예정일)' 를 보여 주고,
        되돌릴 수 없으므로 확인 체크를 받아야 등록 버튼이 켜진다.
   - ③ 진행: 완료/전체 묶음 + [중단] (보내는 중인 요청은 끝까지 기다린다)
   - ④ 결과: 성공 · 실패 · 확인 필요 + 사유. 사전 검사에서 빠진 행도 같이 보여 준다.
        분리배송이 등록됐으면 묶음배송번호가 바뀌므로 [닫고 주문 업데이트] 로 이어 준다.
   - 상태·흐름은 useDeliveryInstruct, 검사·전송 규칙은 services/deliveryInstructService.ts
   - 모양은 InvoiceUploadModal 과 맞춘다 (theme 토큰 + Button)
   ================================================================ */

import React, { useState } from 'react'
import Button from '../common/Button'
import { theme } from '../../styles/theme'
import type { DeliveryInstruct } from './useDeliveryInstruct'
import {
  INVOICE_RESULT_CODE_LABELS,
  isSplitBox,
  type DeliveryMode,
  type PlanFailure,
  type ReadyBox,
  type ReadyLine,
} from '../../services/deliveryInstructService'
import { SUPPORTED_CARRIER_NAMES } from '../../services/coupangCarriers'
import { Stat, ListSection, ProgressBar, listTh as th, listTd as td, WARNING_BG, WARNING_BORDER } from './modalParts'

// ── 화면 상수 ─────────────────────────────────────────────────────
const MODAL_WIDTH = 820
const ACCEPT_EXT = '.xlsx,.xls'

/** 결과 성공 배경 (InvoiceUploadModal 의 선택 완료 배경과 같은 값) */
const SUCCESS_BG = '#F0FDF4'

const MODE_LABELS: Record<DeliveryMode, string> = {
  normal: '일반',
  splitFirst: '분리 시작',
  splitFollowUp: '분리 이어 보내기',
}

const DATE_SOURCE_LABELS: Record<NonNullable<ReadyLine['dateSource']>, string> = {
  order: '주문에 등록된 출고예정일',
  excel: '엑셀 분리배송 출고예정일',
}

// ══════════════════════════════════════════════════════════════════
// 작은 부품 (요약 칸 · 스크롤 표 · 진행 막대는 modalParts — [출고중지] 모달과 공용)
// ══════════════════════════════════════════════════════════════════

/** 줄 하나의 처리 내용 — '지금 출고: 택배사 송장' / '나중 출고: 출고예정일' */
const LineAction: React.FC<{ line: ReadyLine }> = ({ line }) => {
  if (line.invoiceNumber) {
    return <span>지금 출고 · {line.carrier.name} {line.invoiceNumber}</span>
  }
  return (
    <span>
      나중 출고 · 출고예정일 <strong>{line.estimatedShippingDate}</strong>
      {line.dateSource && (
        <span style={{ color: theme.colors.textSecondary }}> ({DATE_SOURCE_LABELS[line.dateSource]})</span>
      )}
      {line.datePast && (
        <span style={{ color: theme.colors.danger, fontWeight: 600 }}> · 지난 날짜 — 쿠팡이 거절할 수 있습니다</span>
      )}
    </span>
  )
}

/** 묶음의 송장 요약 — 일반은 한 줄, 분리배송은 옵션별 */
const BoxLines: React.FC<{ box: ReadyBox }> = ({ box }) => {
  if (!isSplitBox(box)) {
    const first = box.lines[0]
    return <>{first.carrier.name} {first.invoiceNumber}</>
  }
  return (
    <>
      <div style={{ color: theme.colors.textSecondary }}>{MODE_LABELS[box.mode]}</div>
      {box.lines.map((line) => (
        <div key={line.vendorItemId}>옵션 {line.vendorItemId} — <LineAction line={line} /></div>
      ))}
    </>
  )
}

/** 사전 검사 실패 표 (묶음배송번호 · 주문번호 · 시트/행 · 사유) */
const PlanFailureTable: React.FC<{ failures: PlanFailure[]; title: string }> = ({ failures, title }) => (
  <ListSection title={title} color={theme.colors.danger}>
    <thead>
      <tr>
        <th style={th}>묶음배송번호</th>
        <th style={th}>주문번호</th>
        <th style={th}>시트 / 행</th>
        <th style={th}>사유</th>
      </tr>
    </thead>
    <tbody>
      {failures.map((f, i) => (
        <tr key={`${f.sheet}-${f.rowNumber}-${i}`}>
          <td style={td}>{f.shipmentBoxId || '-'}</td>
          <td style={td}>{f.orderId || '-'}</td>
          <td style={{ ...td, whiteSpace: 'nowrap' }}>{f.sheet} / {f.rowNumber}</td>
          <td style={td}>{f.reason}</td>
        </tr>
      ))}
    </tbody>
  </ListSection>
)

/** 분리배송 미리보기 표 — 묶음마다 옵션별 처리 (등록 전 확인용) */
const SplitPreviewTable: React.FC<{ boxes: ReadyBox[] }> = ({ boxes }) => (
  <ListSection title={`분리배송 ${boxes.length}건 — 등록하면 되돌릴 수 없습니다`} color={theme.colors.warning}>
    <thead>
      <tr>
        <th style={th}>묶음배송번호</th>
        <th style={th}>주문번호</th>
        <th style={th}>방식</th>
        <th style={th}>상품</th>
        <th style={th}>처리</th>
      </tr>
    </thead>
    <tbody>
      {boxes.flatMap((box) =>
        box.lines.map((line, i) => (
          <tr key={`${box.shipmentBoxId}-${line.vendorItemId}`}>
            {i === 0 && (
              <>
                <td style={td} rowSpan={box.lines.length}>{box.shipmentBoxId}</td>
                <td style={td} rowSpan={box.lines.length}>{box.orderId}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }} rowSpan={box.lines.length}>{MODE_LABELS[box.mode]}</td>
              </>
            )}
            <td style={td}>{line.itemLabel}</td>
            <td style={td}><LineAction line={line} /></td>
          </tr>
        )),
      )}
    </tbody>
  </ListSection>
)

/** 전송 결과 표 (묶음배송번호 · 주문번호 · 송장 · 코드 · 사유) */
const BoxResultTable: React.FC<{
  title: string
  color: string
  rows: Array<{ box: ReadyBox; code?: string; reason: string; retry?: boolean }>
}> = ({ title, color, rows }) => (
  <ListSection title={title} color={color}>
    <thead>
      <tr>
        <th style={th}>묶음배송번호</th>
        <th style={th}>주문번호</th>
        <th style={th}>송장</th>
        <th style={th}>코드</th>
        <th style={th}>사유</th>
      </tr>
    </thead>
    <tbody>
      {rows.map(({ box, code, reason, retry }) => (
        <tr key={box.shipmentBoxId}>
          <td style={td}>{box.shipmentBoxId}</td>
          <td style={td}>{box.orderId}</td>
          <td style={td}><BoxLines box={box} /></td>
          <td style={{ ...td, whiteSpace: 'nowrap' }}>{code || '-'}</td>
          <td style={td}>
            {reason}
            {retry && <span style={{ color: theme.colors.warning }}> (다시 시도 가능)</span>}
          </td>
        </tr>
      ))}
    </tbody>
  </ListSection>
)

/** 쿠팡 실패 사유 — resultMessage 우선, 없으면 코드별 한국어 설명 */
const describeFailure = (code: string, reason: string) =>
  reason || INVOICE_RESULT_CODE_LABELS[code] || '쿠팡이 등록을 거절했습니다'

// ══════════════════════════════════════════════════════════════════
// 파일 선택 영역 (label 안의 input — 클릭·키보드·끌어놓기)
// ══════════════════════════════════════════════════════════════════

const FilePicker: React.FC<{
  fileName: string | null
  disabled: boolean
  onFile: (file: File) => void
}> = ({ fileName, disabled, onFile }) => {
  const [dragOver, setDragOver] = useState(false)

  const extOk = (name: string) =>
    ACCEPT_EXT.split(',').some((ext) => name.toLowerCase().endsWith(ext))

  const pick = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (!extOk(file.name)) {
      alert('엑셀 파일(.xlsx, .xls)만 올릴 수 있습니다.')
      return
    }
    onFile(file)
  }

  return (
    <label
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (!disabled) pick(e.dataTransfer.files)
      }}
      style={{
        display: 'block',
        position: 'relative',
        border: `2px dashed ${dragOver ? theme.colors.primary : fileName ? theme.colors.success : theme.colors.border}`,
        borderRadius: theme.radius.lg,
        background: dragOver ? theme.colors.primaryLight : fileName ? SUCCESS_BG : theme.colors.bgHover,
        padding: '16px 14px',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {/* 화면에서는 숨기되 키보드 포커스는 받도록 (display:none 이 아님) */}
      <input
        type="file"
        accept={ACCEPT_EXT}
        disabled={disabled}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
        onChange={(e) => {
          pick(e.target.files)
          e.target.value = '' // 같은 파일 다시 선택 허용
        }}
      />
      <div style={{ fontSize: 14, fontWeight: 600, color: theme.colors.textPrimary, marginBottom: 4 }}>
        {fileName ? fileName : '송장 엑셀 선택'}
      </div>
      <div style={{ fontSize: 12, color: theme.colors.textSecondary }}>
        {fileName
          ? '다른 파일을 고르려면 클릭하거나 끌어놓으세요'
          : '쿠팡 DeliveryList(상품준비중) 엑셀 — .xlsx 파일을 끌어놓거나 클릭'}
      </div>
    </label>
  )
}

// ══════════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ══════════════════════════════════════════════════════════════════

const DeliveryInstructModal: React.FC<{ state: DeliveryInstruct }> = ({ state }) => {
  const {
    open, phase, fileName, analyzeError, submitError, plan, splitBoxCount, splitAcknowledged, canSubmit,
    progress, result, saveFailedBoxIds, needsOrderUpdate, busy,
    closeModal, analyze, setSplitAcknowledged, submit, abort, closeAndUpdateOrders,
  } = state

  if (!open) return null

  const boxCount = plan?.boxes.length ?? 0
  const lineCount = plan?.boxes.reduce((n, b) => n + b.lines.length, 0) ?? 0
  const splitBoxes = plan?.boxes.filter(isSplitBox) ?? []
  // 바깥 클릭 닫기: 전송·반영 중에는 막고, 결과 화면(done)도 실패 목록을 잃지 않도록 [닫기] 버튼으로만 닫는다
  const overlayClosable = !busy && phase !== 'done'

  return (
    <div style={theme.modal.overlay} onClick={overlayClosable ? closeModal : undefined}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-instruct-title"
        style={{ ...theme.modal.content, width: MODAL_WIDTH, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 헤더 ──────────────────────────────────────────── */}
        <div id="delivery-instruct-title" style={{ fontSize: 16, fontWeight: 600, color: theme.colors.textPrimary, marginBottom: 4 }}>
          배송준비 — 송장 등록 (상품준비중 → 배송지시)
        </div>
        <div style={{ fontSize: 12.5, color: theme.colors.textSecondary, marginBottom: 14, lineHeight: 1.6 }}>
          택배사·운송장번호를 채운 쿠팡 DeliveryList 엑셀을 올리면 쿠팡에 송장을 등록합니다.
          <br />
          · <strong>상품준비중</strong> 주문만 등록됩니다 · 합포장은 <strong>묶음 전체</strong>가 같은 송장일 때 보냅니다
          <br />
          · <strong>분리배송(부분출고)</strong>: 묶음의 모든 행 '분리배송 Y/N' 을 <strong>Y</strong> 로 — 운송장이 있는 상품은 지금,
          없는 상품은 주문에 등록된 출고예정일로 나중에 보냅니다 (엑셀 '분리배송 출고예정일' 칸에 날짜를 넣으면 그 날짜)
          <br />
          · 지원 택배사: {SUPPORTED_CARRIER_NAMES}
        </div>

        {/* ── ① 파일 선택 + 사전 검사 ──────────────────────────── */}
        {(phase === 'select' || phase === 'analyzing' || phase === 'ready') && (
          <>
            <FilePicker fileName={fileName} disabled={phase === 'analyzing'} onFile={(f) => void analyze(f)} />

            {phase === 'analyzing' && (
              <div style={{ fontSize: 13, color: theme.colors.textSecondary, textAlign: 'center', padding: '14px 0' }}>
                엑셀 확인 중...
              </div>
            )}
            {analyzeError && (
              <div style={{ fontSize: 12.5, color: theme.colors.danger, padding: '12px 0', whiteSpace: 'pre-line' }}>
                엑셀을 읽지 못했습니다: {analyzeError}
              </div>
            )}

            {phase === 'ready' && plan && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Stat label="엑셀 행 수" value={`${plan.totalRows}행`} />
                  <Stat
                    label="등록 대상"
                    value={`${boxCount}건${lineCount !== boxCount ? ` (${lineCount}줄)` : ''}`}
                    color={theme.colors.info}
                  />
                  <Stat
                    label="그중 분리배송"
                    value={`${splitBoxCount}건`}
                    color={splitBoxCount > 0 ? theme.colors.warning : theme.colors.textSecondary}
                  />
                  <Stat label="운송장 없음 제외" value={`${plan.skipped.length}행`} color={theme.colors.textSecondary} />
                  <Stat
                    label="등록 불가"
                    value={`${plan.failures.length}행`}
                    color={plan.failures.length > 0 ? theme.colors.danger : theme.colors.textSecondary}
                  />
                </div>

                {/* ── ② 분리배송 확인 (되돌릴 수 없음) ── */}
                {splitBoxes.length > 0 && (
                  <>
                    <SplitPreviewTable boxes={splitBoxes} />
                    <label
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 8, padding: '10px 12px',
                        border: `1px solid ${WARNING_BORDER}`, borderRadius: theme.radius.md, background: WARNING_BG,
                        fontSize: 12.5, color: theme.colors.textPrimary, cursor: 'pointer', lineHeight: 1.5,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={splitAcknowledged}
                        onChange={(e) => setSplitAcknowledged(e.target.checked)}
                        style={{ marginTop: 2 }}
                      />
                      <span>
                        분리배송 {splitBoxes.length}건의 내용을 확인했습니다. 등록하면 <strong>일반배송으로 되돌릴 수 없고</strong>,
                        나중에 보낼 상품의 <strong>출고예정일은 바꿀 수 없습니다</strong>.
                      </span>
                    </label>
                  </>
                )}

                {plan.failures.length > 0 && (
                  <PlanFailureTable failures={plan.failures} title={`등록 불가 ${plan.failures.length}행`} />
                )}
                {boxCount === 0 && (
                  <div style={{ fontSize: 12.5, color: theme.colors.textMuted, textAlign: 'center', paddingTop: 12 }}>
                    등록할 묶음이 없습니다.
                  </div>
                )}
                {submitError && (
                  <div style={{ fontSize: 12.5, color: theme.colors.danger, paddingTop: 10 }}>
                    등록을 시작하지 못했습니다: {submitError}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── ③ 진행 ─────────────────────────────────────────── */}
        {(phase === 'submitting' || phase === 'saving') && (
          <div style={{ padding: '10px 0' }}>
            <div style={{ fontSize: 13, color: theme.colors.textPrimary, marginBottom: 8 }}>
              {phase === 'submitting'
                ? `쿠팡에 등록 중... ${progress.done} / ${progress.total} 묶음`
                : '화면·DB 반영 중...'}
            </div>
            <ProgressBar done={progress.done} total={progress.total} />
            <div style={{ fontSize: 11.5, color: theme.colors.textMuted, marginTop: 6 }}>
              중단하면 지금 보내는 요청까지만 처리하고 나머지는 보내지 않습니다. 이미 등록된 송장은 되돌리지 않습니다.
            </div>
          </div>
        )}

        {/* ── ④ 결과 ─────────────────────────────────────────── */}
        {phase === 'done' && result && (
          <div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Stat label="성공" value={`${result.succeeded.length}건`} color={theme.colors.success} />
              <Stat
                label="실패"
                value={`${result.failed.length}건`}
                color={result.failed.length > 0 ? theme.colors.danger : theme.colors.textSecondary}
              />
              <Stat
                label="확인 필요"
                value={`${result.unknown.length}건`}
                color={result.unknown.length > 0 ? theme.colors.warning : theme.colors.textSecondary}
              />
              {result.notSent.length > 0 && (
                <Stat label="중단 — 보내지 않음" value={`${result.notSent.length}건`} color={theme.colors.textSecondary} />
              )}
            </div>

            {needsOrderUpdate && (
              <div
                style={{
                  marginTop: 10, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.5, color: theme.colors.textPrimary,
                  border: `1px solid ${WARNING_BORDER}`, borderRadius: theme.radius.md, background: WARNING_BG,
                }}
              >
                분리배송이 등록됐습니다. 먼저 보낸 상품의 <strong>묶음배송번호가 쿠팡에서 바뀌므로</strong> [주문 업데이트] 로
                맞춰 주세요. (아래 [닫고 주문 업데이트] 를 누르면 바로 실행합니다)
              </div>
            )}

            {saveFailedBoxIds.length > 0 && (
              <div style={{ fontSize: 12.5, color: theme.colors.warning, marginTop: 10 }}>
                쿠팡에는 등록됨 · 화면 반영 실패 {saveFailedBoxIds.length}건 → [주문 업데이트] 를 눌러 주세요.
                <span style={{ color: theme.colors.textSecondary }}> ({saveFailedBoxIds.join(', ')})</span>
              </div>
            )}

            {result.failed.length > 0 && (
              <BoxResultTable
                title={`실패 ${result.failed.length}건`}
                color={theme.colors.danger}
                rows={result.failed.map((f) => ({
                  box: f.box, code: f.resultCode, reason: describeFailure(f.resultCode, f.reason), retry: f.retryRequired,
                }))}
              />
            )}
            {result.unknown.length > 0 && (
              <BoxResultTable
                title={`확인 필요 ${result.unknown.length}건 — 반영 여부를 알 수 없어 다시 보내지 않았습니다`}
                color={theme.colors.warning}
                rows={result.unknown.map((u) => ({ box: u.box, reason: u.reason }))}
              />
            )}
            {result.notSent.length > 0 && (
              <BoxResultTable
                title={`중단으로 보내지 않음 ${result.notSent.length}건`}
                color={theme.colors.textSecondary}
                rows={result.notSent.map((box) => ({ box, reason: '보내지 않음 — 다시 올리면 등록됩니다' }))}
              />
            )}
            {plan && plan.failures.length > 0 && (
              <PlanFailureTable failures={plan.failures} title={`사전 검사에서 등록하지 않은 행 ${plan.failures.length}행`} />
            )}
          </div>
        )}

        {/* ── 푸터 ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          {phase === 'submitting' ? (
            <Button variant="danger" onClick={abort} style={{ padding: '8px 16px', fontSize: 13 }}>
              중단
            </Button>
          ) : (
            <Button
              variant="default"
              onClick={closeModal}
              disabled={busy}
              style={{ padding: '8px 16px', fontSize: 13 }}
            >
              {phase === 'done' ? '닫기' : '취소'}
            </Button>
          )}
          {(phase === 'select' || phase === 'analyzing' || phase === 'ready') && (
            <Button
              variant="primary"
              onClick={() => void submit()}
              disabled={!canSubmit}
              style={{ padding: '8px 16px', fontSize: 13 }}
            >
              {`배송지시 등록 (${boxCount}건)`}
            </Button>
          )}
          {phase === 'done' && needsOrderUpdate && (
            <Button variant="primary" onClick={closeAndUpdateOrders} style={{ padding: '8px 16px', fontSize: 13 }}>
              닫고 주문 업데이트
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default DeliveryInstructModal
