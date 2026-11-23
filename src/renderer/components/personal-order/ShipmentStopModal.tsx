/* ================================================================
   ShipmentStopModal — [출고중지] 선택한 상품준비중 주문의 출고를 쿠팡에서 멈춘다
   - ① 확인: 판매자 취소 대상(묶음 · 상품 · 수량) · 고객 취소 요청 대상(접수 건 · 고객 사유) + 제외한 줄과 사유.
        고객 요청 줄이 있으면 접수 건을 찾는 동안 '확인 중' 을 보여 주고 실행 버튼을 막는다.
        되돌릴 수 없으므로(판매자 취소는 판매자 사유 '품절'로 기록) 확인 체크를 받아야 실행 버튼이 켜진다.
   - ② 진행: 완료/전체 묶음 + [중단] (처리 중인 묶음은 확인까지 마친다)
   - ③ 결과: 완료 · 확인 필요 · 실패 + 사유 · 쿠팡 접수번호.
        사람이 확인할 건이 있으면 [닫고 주문 업데이트] 로 이어 준다.
   - 상태·흐름은 useShipmentStop, 검사·쿠팡 호출 규칙은 services/shipmentStopService.ts
   - 모양은 DeliveryInstructModal 과 맞춘다 (modalParts + theme 토큰 + Button)
   ================================================================ */

import React from 'react'
import Button from '../common/Button'
import { theme } from '../../styles/theme'
import type { ShipmentStop, WingIdState } from './useShipmentStop'
import type {
  StopBox, StopExclusion, StopLine, StopOutcome, StopRequest, StopResult,
} from '../../services/shipmentStopService'
import { Stat, ListSection, ProgressBar, listTh as th, listTd as td, WARNING_BG, WARNING_BORDER } from './modalParts'

// ── 화면 상수 ─────────────────────────────────────────────────────
const MODAL_WIDTH = 820

/** 결과 표 — 종류별 제목 · 색 (표시 순서대로) */
const RESULT_SECTIONS: ReadonlyArray<{ outcome: StopOutcome; title: string; color: string }> = [
  { outcome: 'needsCheck', title: '확인 필요 — 취소는 접수됐습니다 (화면에 취소로 반영)', color: theme.colors.warning },
  { outcome: 'unknown', title: '처리 여부 확인 필요 — 화면에 반영하지 않았습니다', color: theme.colors.warning },
  { outcome: 'failed', title: '실패 — 바뀐 것 없음', color: theme.colors.danger },
  { outcome: 'notSent', title: '중단으로 보내지 않음', color: theme.colors.textSecondary },
  { outcome: 'completed', title: '출고중지 완료', color: theme.colors.success },
]

// ══════════════════════════════════════════════════════════════════
// 작은 부품
// ══════════════════════════════════════════════════════════════════

/** 줄 목록 — '상품명 / 옵션명 × 수량' */
const LineList: React.FC<{ lines: StopLine[]; struck?: boolean }> = ({ lines, struck }) => (
  <>
    {lines.map((line) => (
      <div key={`${line.shipmentBoxId}-${line.vendorItemId}`} style={struck ? { color: theme.colors.danger } : undefined}>
        {line.itemLabel} × {line.quantity}
        {struck && ' (거절됨)'}
      </div>
    ))}
  </>
)

/** 같은 주문에서 취소하지 않는 상품 안내 */
const BoxScope: React.FC<{ box: StopBox }> = ({ box }) =>
  box.otherLinesInOrder === 0
    ? <span style={{ color: theme.colors.textSecondary }}>주문 전체</span>
    : <span style={{ color: theme.colors.warning, fontWeight: 600 }}>일부만 — 같은 주문의 다른 상품 {box.otherLinesInOrder}개는 취소되지 않음</span>

/** 고객 요청 접수 건에 선택하지 않은 상품이 함께 들어 있는지 안내 */
const RequestScope: React.FC<{ request: StopRequest }> = ({ request }) =>
  request.unselectedLines === 0
    ? <span style={{ color: theme.colors.textSecondary }}>선택한 상품</span>
    : <span style={{ color: theme.colors.warning, fontWeight: 600 }}>같은 요청의 선택하지 않은 상품 {request.unselectedLines}개도 함께 처리</span>

/** 판매자 취소 대상 표 */
const TargetTable: React.FC<{ boxes: StopBox[] }> = ({ boxes }) => (
  <ListSection title={`판매자 취소 ${boxes.length}건`} color={theme.colors.textPrimary}>
    <thead>
      <tr>
        <th style={th}>주문번호</th>
        <th style={th}>수취인</th>
        <th style={th}>상품 × 취소 수량</th>
        <th style={th}>범위</th>
      </tr>
    </thead>
    <tbody>
      {boxes.map((box) => (
        <tr key={box.shipmentBoxId}>
          <td style={td}>{box.orderId}</td>
          <td style={{ ...td, whiteSpace: 'nowrap' }}>{box.receiverName || '-'}</td>
          <td style={td}><LineList lines={box.lines} /></td>
          <td style={td}><BoxScope box={box} /></td>
        </tr>
      ))}
    </tbody>
  </ListSection>
)

/** 고객 취소 요청 대상 표 */
const RequestTable: React.FC<{ requests: StopRequest[] }> = ({ requests }) => (
  <ListSection title={`고객 취소 요청 ${requests.length}건 — 출고중지완료 처리`} color={theme.colors.textPrimary}>
    <thead>
      <tr>
        <th style={th}>주문번호</th>
        <th style={th}>수취인</th>
        <th style={th}>상품 × 요청 수량</th>
        <th style={th}>고객 사유</th>
        <th style={th}>범위</th>
      </tr>
    </thead>
    <tbody>
      {requests.map((request) => (
        <tr key={request.key}>
          <td style={td}>{request.orderId}</td>
          <td style={{ ...td, whiteSpace: 'nowrap' }}>{request.receiverName || '-'}</td>
          <td style={td}><LineList lines={request.lines} /></td>
          <td style={td}>{request.reason || '-'}</td>
          <td style={td}><RequestScope request={request} /></td>
        </tr>
      ))}
    </tbody>
  </ListSection>
)

/** 사전 검사에서 뺀 줄 표 */
const ExclusionTable: React.FC<{ excluded: StopExclusion[]; title: string }> = ({ excluded, title }) => (
  <ListSection title={title} color={theme.colors.danger}>
    <thead>
      <tr>
        <th style={th}>주문번호</th>
        <th style={th}>상품</th>
        <th style={th}>사유</th>
      </tr>
    </thead>
    <tbody>
      {excluded.map((row) => (
        <tr key={`${row.shipmentBoxId}-${row.vendorItemId}`}>
          <td style={td}>{row.orderId || '-'}</td>
          <td style={td}>{row.itemLabel}</td>
          <td style={td}>{row.reason}</td>
        </tr>
      ))}
    </tbody>
  </ListSection>
)

/** 완료 건의 처리 방식 안내 */
function completedNote(result: StopResult): string {
  if (result.target.kind === 'customerRequest') {
    return result.usedSecondStep ? '고객 요청을 출고중지완료 처리' : '이미 출고중지 완료된 요청 — 화면만 맞춤'
  }
  return result.usedSecondStep ? '취소 접수 후 출고중지완료 처리까지 실행' : '취소 접수로 출고중지 완료'
}

/** 결과 표 (한 종류) */
const ResultTable: React.FC<{ title: string; color: string; results: StopResult[] }> = ({ title, color, results }) => (
  <ListSection title={`${title} · ${results.length}건`} color={color}>
    <thead>
      <tr>
        <th style={th}>구분</th>
        <th style={th}>주문번호</th>
        <th style={th}>수취인</th>
        <th style={th}>상품 × 취소 수량</th>
        <th style={th}>접수번호</th>
        <th style={th}>내용</th>
      </tr>
    </thead>
    <tbody>
      {results.map((result) => {
        // 접수된 줄 · 거절된 줄을 나눠 보여 준다. 접수 전에 끝난 건(실패 등)은 요청한 줄 그대로
        const untouched = result.acceptedLines.length === 0 && result.rejectedLines.length === 0
        return (
          <tr key={`${result.target.kind}-${result.target.key}`}>
            <td style={{ ...td, whiteSpace: 'nowrap' }}>{result.target.kind === 'customerRequest' ? '고객 요청' : '판매자 취소'}</td>
            <td style={td}>{result.target.orderId}</td>
            <td style={{ ...td, whiteSpace: 'nowrap' }}>{result.target.receiverName || '-'}</td>
            <td style={td}>
              {untouched ? <LineList lines={result.target.lines} /> : (
                <>
                  <LineList lines={result.acceptedLines} />
                  <LineList lines={result.rejectedLines} struck />
                </>
              )}
            </td>
            <td style={{ ...td, whiteSpace: 'nowrap' }}>{result.receiptIds.join(', ') || '-'}</td>
            <td style={td}>{result.outcome === 'completed' ? completedNote(result) : result.message}</td>
          </tr>
        )
      })}
    </tbody>
  </ListSection>
)

/** 쿠팡 WING 로그인 ID 안내 줄 */
const WingIdLine: React.FC<{ wingId: WingIdState }> = ({ wingId }) => {
  const base: React.CSSProperties = { fontSize: 12.5, marginTop: 10 }
  if (wingId.status === 'loading') {
    return <div style={{ ...base, color: theme.colors.textSecondary }}>쿠팡 로그인 ID 확인 중...</div>
  }
  if (wingId.status === 'ready') {
    return (
      <div style={{ ...base, color: theme.colors.textSecondary }}>
        처리자(쿠팡 WING 로그인 ID): <strong style={{ color: theme.colors.textPrimary }}>{wingId.userId}</strong>
      </div>
    )
  }
  return (
    <div style={{ ...base, color: theme.colors.danger }}>
      {wingId.status === 'missing'
        ? '쿠팡 로그인 ID(si_users.coupang_user_name)가 계정에 등록되어 있지 않아 취소를 보낼 수 없습니다. 관리자에게 등록을 요청하세요.'
        : `쿠팡 로그인 ID 를 읽지 못했습니다: ${wingId.message} — 닫았다가 다시 열어 주세요.`}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ══════════════════════════════════════════════════════════════════

const ShipmentStopModal: React.FC<{ state: ShipmentStop }> = ({ state }) => {
  const {
    open, phase, plan, wingId, acknowledged, canSubmit, startError, progress, results,
    saveFailedBoxIds, needsOrderUpdate, busy,
    closeModal, setAcknowledged, submit, abort, closeAndUpdateOrders,
  } = state

  if (!open || !plan) return null

  const boxCount = plan.boxes.length
  const requestCount = plan.requests.length
  const targetCount = boxCount + requestCount
  const lookingUp = plan.pendingRequestLines > 0
  const countOf = (outcome: StopOutcome) => results?.filter((r) => r.outcome === outcome).length ?? 0
  // 바깥 클릭 닫기: 처리·반영 중에는 막고, 결과 화면(done)도 목록을 잃지 않도록 [닫기] 버튼으로만 닫는다
  const overlayClosable = !busy && phase !== 'done'

  return (
    <div style={theme.modal.overlay} onClick={overlayClosable ? closeModal : undefined}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shipment-stop-title"
        style={{ ...theme.modal.content, width: MODAL_WIDTH, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 헤더 ──────────────────────────────────────────── */}
        <div id="shipment-stop-title" style={{ fontSize: 16, fontWeight: 600, color: theme.colors.textPrimary, marginBottom: 4 }}>
          출고중지 — 상품준비중 주문 취소
        </div>
        <div style={{ fontSize: 12.5, color: theme.colors.textSecondary, marginBottom: 14, lineHeight: 1.6 }}>
          선택한 <strong>상품준비중</strong> 주문의 출고를 쿠팡에서 멈춥니다 (WING 의 주문취소 → 출고중지완료와 같은 일).
          <br />
          · <strong>판매자 취소</strong>: 선택한 상품의 <strong>남은 수량 전체</strong>를 취소 접수하고 출고중지완료까지 확인합니다
          <br />
          · <strong>고객 취소 요청</strong>(⚠️): 고객이 먼저 요청한 건이라 취소는 보내지 않고 <strong>출고중지완료 처리</strong>만 합니다
        </div>

        {/* ── ① 확인 ────────────────────────────────────────── */}
        {phase === 'confirm' && (
          <div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Stat
                label="판매자 취소"
                value={`${boxCount}건`}
                color={boxCount > 0 ? theme.colors.danger : theme.colors.textSecondary}
              />
              <Stat
                label="고객 취소 요청"
                value={lookingUp ? '확인 중...' : `${requestCount}건`}
                color={requestCount > 0 ? theme.colors.textPrimary : theme.colors.textSecondary}
              />
              <Stat
                label="제외"
                value={`${plan.excluded.length}줄`}
                color={plan.excluded.length > 0 ? theme.colors.warning : theme.colors.textSecondary}
              />
            </div>

            {lookingUp && (
              <div style={{ fontSize: 12.5, color: theme.colors.textSecondary, paddingTop: 12 }}>
                고객 취소 요청 {plan.pendingRequestLines}줄의 접수 건을 쿠팡 출고중지요청 목록에서 찾는 중...
              </div>
            )}
            {boxCount > 0 && <TargetTable boxes={plan.boxes} />}
            {requestCount > 0 && <RequestTable requests={plan.requests} />}
            {plan.excluded.length > 0 && (
              <ExclusionTable excluded={plan.excluded} title={`제외 ${plan.excluded.length}줄 — 출고중지하지 않습니다`} />
            )}
            {targetCount === 0 && !lookingUp && (
              <div style={{ fontSize: 12.5, color: theme.colors.textMuted, textAlign: 'center', paddingTop: 12 }}>
                출고중지할 주문이 없습니다.
              </div>
            )}

            {targetCount > 0 && !lookingUp && (
              <>
                {boxCount > 0 && <WingIdLine wingId={wingId} />}
                <label
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, padding: '10px 12px',
                    border: `1px solid ${WARNING_BORDER}`, borderRadius: theme.radius.md, background: WARNING_BG,
                    fontSize: 12.5, color: theme.colors.textPrimary, cursor: 'pointer', lineHeight: 1.6,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    위 {targetCount}건을 확인했습니다. 출고중지하면 <strong>되돌릴 수 없고</strong> 고객에게 환불됩니다.
                    {boxCount > 0 && (
                      <>
                        <br />
                        판매자 취소 {boxCount}건: 쿠팡 API 로 취소하면 <strong>사유를 고를 수 없습니다</strong> — 상품준비중 취소는
                        {' '}<strong>'품절'(판매자 사유)</strong>로 기록되고 <strong>판매자 점수(주문이행)가 내려갑니다</strong>.
                        고객 사유로 처리해야 하는 건은 WING 에서 직접 취소해 주세요.
                      </>
                    )}
                    {requestCount > 0 && (
                      <>
                        <br />
                        고객 취소 요청 {requestCount}건: 고객이 요청한 수량만큼 출고중지완료 처리합니다 (고객 사유 그대로).
                      </>
                    )}
                  </span>
                </label>
              </>
            )}

            {startError && (
              <div style={{ fontSize: 12.5, color: theme.colors.danger, paddingTop: 10 }}>
                출고중지를 시작하지 못했습니다: {startError}
              </div>
            )}
          </div>
        )}

        {/* ── ② 진행 ─────────────────────────────────────────── */}
        {busy && (
          <div style={{ padding: '10px 0' }}>
            <div style={{ fontSize: 13, color: theme.colors.textPrimary, marginBottom: 8 }}>
              {phase === 'running'
                ? `쿠팡에서 출고중지 처리 중... ${progress.done} / ${progress.total} 건`
                : '화면·DB 반영 중...'}
            </div>
            <ProgressBar done={progress.done} total={progress.total} />
            <div style={{ fontSize: 11.5, color: theme.colors.textMuted, marginTop: 6 }}>
              중단하면 지금 처리 중인 건까지만 마치고 나머지는 보내지 않습니다. 이미 취소된 주문은 되돌리지 않습니다.
            </div>
          </div>
        )}

        {/* ── ③ 결과 ─────────────────────────────────────────── */}
        {phase === 'done' && results && (
          <div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Stat label="완료" value={`${countOf('completed')}건`} color={theme.colors.success} />
              <Stat
                label="확인 필요"
                value={`${countOf('needsCheck') + countOf('unknown')}건`}
                color={needsOrderUpdate ? theme.colors.warning : theme.colors.textSecondary}
              />
              <Stat
                label="실패"
                value={`${countOf('failed')}건`}
                color={countOf('failed') > 0 ? theme.colors.danger : theme.colors.textSecondary}
              />
              {countOf('notSent') > 0 && (
                <Stat label="중단 — 보내지 않음" value={`${countOf('notSent')}건`} color={theme.colors.textSecondary} />
              )}
            </div>

            {needsOrderUpdate && (
              <div
                style={{
                  marginTop: 10, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.5, color: theme.colors.textPrimary,
                  border: `1px solid ${WARNING_BORDER}`, borderRadius: theme.radius.md, background: WARNING_BG,
                }}
              >
                확인이 필요한 건이 있습니다. <strong>WING › 출고중지요청</strong>에서 접수번호로 상태를 확인하고, [주문 업데이트] 로
                화면을 쿠팡 기준으로 맞춰 주세요. (아래 [닫고 주문 업데이트] 를 누르면 바로 실행합니다)
              </div>
            )}

            {saveFailedBoxIds.length > 0 && (
              <div style={{ fontSize: 12.5, color: theme.colors.warning, marginTop: 10 }}>
                쿠팡에는 접수됨 · DB 반영 실패 {saveFailedBoxIds.length}건 → [주문 업데이트] 를 눌러 주세요.
                <span style={{ color: theme.colors.textSecondary }}> ({saveFailedBoxIds.join(', ')})</span>
              </div>
            )}

            {RESULT_SECTIONS.map(({ outcome, title, color }) => {
              const rows = results.filter((r) => r.outcome === outcome)
              return rows.length > 0 ? <ResultTable key={outcome} title={title} color={color} results={rows} /> : null
            })}
            {plan.excluded.length > 0 && (
              <ExclusionTable excluded={plan.excluded} title={`사전 검사에서 제외한 줄 ${plan.excluded.length}줄`} />
            )}
          </div>
        )}

        {/* ── 푸터 ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          {phase === 'running' ? (
            <Button variant="default" onClick={abort} style={{ padding: '8px 16px', fontSize: 13 }}>
              중단
            </Button>
          ) : (
            // '취소' 라고 쓰면 주문 취소로 읽힐 수 있어 어느 단계든 '닫기'
            <Button
              variant="default"
              onClick={closeModal}
              disabled={busy}
              style={{ padding: '8px 16px', fontSize: 13 }}
            >
              닫기
            </Button>
          )}
          {phase === 'confirm' && (
            <Button
              variant="danger"
              onClick={() => void submit()}
              disabled={!canSubmit}
              style={{ padding: '8px 16px', fontSize: 13 }}
            >
              {`출고중지 (${targetCount}건)`}
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

export default ShipmentStopModal
