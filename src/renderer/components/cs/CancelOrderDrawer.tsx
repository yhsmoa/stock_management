/* ================================================================
   주문 취소 드로어 (CancelOrderDrawer) — 재사용 컴포넌트
   - props 로 orderId 만 받으면 주문 상세를 조회해 취소 UI 표시
   - 취소 대상 상품 체크 + 수량 → 귀책(판매자/고객) + 사유 →
     상단 우측 '취소하기' 로 전송 (orderCancelService.cancelOrder)
   - 운송장 없음(상품준비중) 건은 즉시 취소, 있으면 출고중지로 접수됨
   - CANCEL_ORDER_PROCESSING API: bigCancelCode='CANERR' 고정.
     판매자사유 middle=CCTTER/CCPNER/CCPRER(확인됨),
     고객사유 middle=VOC reasonCode(CHANGEMIND 등, 실테스트 검증 중).
   ================================================================ */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { theme } from '../../styles/theme'
import { fetchOrderDetail, type OrderDetail } from '../../services/csService'
import {
  cancelOrder,
  CANCEL_REASONS,
  FAULT_LABELS,
  type FaultType,
} from '../../services/orderCancelService'

// ── Props ──────────────────────────────────────────────────────────
interface Props {
  open: boolean
  orderId: string | null
  onClose: () => void
  onCancelled?: () => void // 취소 성공 후 콜백 (목록 갱신 등)
}

// ── 행 선택 상태 ───────────────────────────────────────────────────
interface RowSel {
  checked: boolean
  count: number
}

// ── WING ID 기본값 (답변과 동일 저장소 공유) ───────────────────────
function defaultWingId(): string {
  try {
    const saved = localStorage.getItem('cs_reply_by')
    if (saved) return saved
    const raw = localStorage.getItem('user')
    return raw ? (JSON.parse(raw)?.username ?? '') : ''
  } catch {
    return ''
  }
}

// ══════════════════════════════════════════════════════════════════
// 컴포넌트
// ══════════════════════════════════════════════════════════════════

const CancelOrderDrawer: React.FC<Props> = ({ open, orderId, onClose, onCancelled }) => {
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  const [sel, setSel] = useState<Map<string, RowSel>>(new Map())
  const [fault, setFault] = useState<FaultType>('CUSTOMER')
  const [middleCode, setMiddleCode] = useState('') // 선택된 취소 소분류 코드
  const [cancelReason, setCancelReason] = useState('') // 고객 안내용 직접 입력 사유
  const [userId, setUserId] = useState(defaultWingId())

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [doneMsg, setDoneMsg] = useState('')

  // ── 주문 상세 로드 ──────────────────────────────────────────────
  useEffect(() => {
    if (!open || !orderId) return
    let cancelled = false
    setLoading(true)
    setLoadError('')
    setDetail(null)
    setSel(new Map())
    setFault('CUSTOMER')
    setMiddleCode('')
    setCancelReason('')
    setError('')
    setDoneMsg('')
    setUserId(defaultWingId())
    ;(async () => {
      const d = await fetchOrderDetail(orderId)
      if (cancelled) return
      if (!d || d.lines.length === 0) {
        setLoadError('주문 상세를 불러오지 못했습니다.')
      } else {
        setDetail(d)
        // 기본: 전체 체크 + 각 상품 수량 그대로
        const m = new Map<string, RowSel>()
        d.lines.forEach((l) => m.set(l.vendorItemId, { checked: true, count: l.shippingCount || 1 }))
        setSel(m)
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [open, orderId])

  // ESC 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // 귀책 변경 시 사유 초기화
  useEffect(() => { setMiddleCode('') }, [fault])

  const reasonOptions = CANCEL_REASONS[fault]
  const selectedReason = reasonOptions.find((o) => o.middle === middleCode) ?? null

  // ── 선택된 취소 항목 ────────────────────────────────────────────
  const selectedItems = useMemo(() => {
    if (!detail) return []
    return detail.lines
      .filter((l) => sel.get(l.vendorItemId)?.checked && (sel.get(l.vendorItemId)?.count ?? 0) > 0)
      .map((l) => ({
        vendorItemId: Number(l.vendorItemId),
        cancelCount: sel.get(l.vendorItemId)?.count ?? 0,
      }))
  }, [detail, sel])

  const noInvoice = useMemo(
    () => !!detail && detail.lines.some((l) => !l.invoiceNumber),
    [detail],
  )

  const canSubmit =
    !submitting && selectedItems.length > 0 && !!selectedReason && userId.trim().length > 0

  // ── 행 토글/수량 ────────────────────────────────────────────────
  const toggle = useCallback((vid: string, checked: boolean) => {
    setSel((prev) => {
      const next = new Map(prev)
      const cur = next.get(vid) ?? { checked: false, count: 1 }
      next.set(vid, { ...cur, checked })
      return next
    })
  }, [])

  const setCount = useCallback((vid: string, count: number, max: number) => {
    const c = Math.max(1, Math.min(max, Math.floor(count) || 1))
    setSel((prev) => {
      const next = new Map(prev)
      const cur = next.get(vid) ?? { checked: true, count: 1 }
      next.set(vid, { ...cur, count: c })
      return next
    })
  }, [])

  // ── 취소 전송 ───────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!orderId) return
    setSubmitting(true)
    setError('')
    setDoneMsg('')
    try {
      if (!selectedReason) throw new Error('취소 사유를 선택하세요.')
      const result = await cancelOrder({
        orderId: Number(orderId),
        items: selectedItems,
        bigCancelCode: selectedReason.big,
        middleCancelCode: selectedReason.middle,
        cancelReason,
        userId,
      })
      try { localStorage.setItem('cs_reply_by', userId.trim()) } catch { /* 무시 */ }
      const typeLabel = result.receiptType === 'STOP_SHIPMENT' ? '출고중지 접수' : '취소 접수'
      const failMsg = result.failedVendorItemIds.length > 0
        ? ` (실패 옵션: ${result.failedVendorItemIds.join(', ')})`
        : ''
      setDoneMsg(`${typeLabel} 완료${failMsg}`)
      onCancelled?.()
    } catch (e: any) {
      setError(e?.message ?? '취소 처리에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1010,
          opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'opacity 0.2s',
        }}
      />
      {/* Drawer */}
      <aside
        style={{
          position: 'fixed', top: 0, right: 0, height: '100%', width: 520, maxWidth: '96vw',
          background: theme.colors.bgCard, boxShadow: theme.shadows.lg, zIndex: 1011,
          transform: open ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.25s ease',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            padding: '18px 22px', borderBottom: `1px solid ${theme.colors.borderLight}`, gap: 12, flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                display: 'inline-block', fontSize: 11, color: '#fff', background: theme.colors.danger,
                padding: '2px 8px', borderRadius: 4, marginBottom: 6,
              }}
            >
              주문 취소
            </span>
            <p style={{ fontSize: 12, color: theme.colors.textMuted, margin: 0, fontFamily: 'monospace' }}>
              주문번호 {orderId || '-'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                padding: '7px 16px', border: 'none', borderRadius: theme.radius.sm,
                background: canSubmit ? theme.colors.danger : theme.colors.border, color: '#fff',
                fontSize: theme.fontSize.sm, fontWeight: 600,
                cursor: canSubmit ? 'pointer' : 'default', whiteSpace: 'nowrap',
              }}
            >
              {submitting ? '처리 중...' : '취소하기'}
            </button>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', fontSize: 18, color: theme.colors.textMuted, cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: theme.colors.textSecondary }}>불러오는 중...</div>
          ) : loadError ? (
            <div style={{ color: theme.colors.danger, fontSize: theme.fontSize.sm }}>{loadError}</div>
          ) : detail ? (
            <>
              {/* ── 취소 대상 상품 ── */}
              <div style={sectionLabel}>취소할 상품 선택</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 18, fontSize: theme.fontSize.xs }}>
                <thead>
                  <tr style={{ background: theme.colors.bgTableHeader, color: theme.colors.textSecondary }}>
                    <th style={cellTh}></th>
                    <th style={{ ...cellTh, textAlign: 'left' }}>상품명(옵션)</th>
                    <th style={cellTh}>배송상태</th>
                    <th style={cellTh}>수량</th>
                    <th style={cellTh}>취소수량</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((l) => {
                    const s = sel.get(l.vendorItemId) ?? { checked: false, count: 1 }
                    return (
                      <tr key={l.vendorItemId} style={{ borderBottom: `1px solid ${theme.colors.borderLight}` }}>
                        <td style={cellTd}>
                          <input type="checkbox" checked={s.checked} onChange={(e) => toggle(l.vendorItemId, e.target.checked)} />
                        </td>
                        <td style={{ ...cellTd, textAlign: 'left' }}>
                          <div style={{ color: theme.colors.textPrimary }}>{l.sellerProductName}</div>
                          {l.optionName && <div style={{ color: theme.colors.textMuted }}>{l.optionName}</div>}
                        </td>
                        <td style={cellTd}>{l.statusLabel || '-'}</td>
                        <td style={cellTd}>{l.shippingCount}</td>
                        <td style={cellTd}>
                          <input
                            type="number"
                            min={1}
                            max={l.shippingCount}
                            value={s.count}
                            disabled={!s.checked}
                            onChange={(e) => setCount(l.vendorItemId, Number(e.target.value), l.shippingCount)}
                            style={{
                              width: 52, padding: '4px 6px', textAlign: 'center',
                              border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius.sm,
                            }}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* ── 귀책 ── */}
              <div style={sectionLabel}>취소 사유 (귀책)</div>
              <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
                {(['VENDOR', 'CUSTOMER'] as FaultType[]).map((f) => (
                  <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: theme.fontSize.sm, cursor: 'pointer' }}>
                    <input type="radio" name="fault" checked={fault === f} onChange={() => setFault(f)} />
                    {FAULT_LABELS[f]}
                  </label>
                ))}
              </div>

              {/* ── 사유 ── */}
              <select
                value={middleCode}
                onChange={(e) => setMiddleCode(e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px', border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.radius.sm, fontSize: theme.fontSize.sm, marginBottom: 6, background: '#fff',
                }}
              >
                <option value="">선택하세요</option>
                {reasonOptions.map((r) => (
                  <option key={r.middle} value={r.middle}>{r.label}</option>
                ))}
              </select>
              <div style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.xs, marginBottom: 10 }}>
                고객사유 코드는 검증 중입니다. 접수가 거부되면 사유 코드를 조정합니다.
              </div>

              {/* ── 취소사유 직접 입력 (고객 안내) ── */}
              <div style={{ ...sectionLabel, marginTop: 10 }}>취소사유 직접 입력 (고객 안내)</div>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="고객에게 안내할 취소 사유를 입력하세요."
                style={{
                  width: '100%', minHeight: 70, padding: '10px 12px',
                  border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius.sm,
                  fontSize: theme.fontSize.sm, resize: 'vertical', boxSizing: 'border-box',
                  outline: 'none', fontFamily: 'inherit', lineHeight: 1.6,
                }}
              />

              {/* ── 안내 ── */}
              <div
                style={{
                  marginTop: 8, marginBottom: 16, padding: '10px 12px',
                  background: theme.colors.bgTableHeader, borderRadius: theme.radius.sm,
                  fontSize: theme.fontSize.xs, color: theme.colors.textSecondary, lineHeight: 1.6,
                }}
              >
                {noInvoice
                  ? '운송장이 없는 상품준비중 건은 취소접수 시 출고중지로 처리됩니다.'
                  : '운송장이 있는 건은 출고중지/반품 흐름으로 접수됩니다.'}
                <br />입력한 사유는 고객에게 안내될 수 있습니다.
              </div>

              {/* ── 응답자(WING) ID ── */}
              <div style={sectionLabel}>응답자 ID (WING)</div>
              <input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="셀러포탈(WING) 로그인 ID"
                style={{
                  width: '100%', padding: '8px 12px', border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.radius.sm, fontSize: theme.fontSize.sm, boxSizing: 'border-box',
                }}
              />

              {error && <div style={{ color: theme.colors.danger, fontSize: theme.fontSize.sm, marginTop: 10 }}>{error}</div>}
              {doneMsg && <div style={{ color: theme.colors.success, fontSize: theme.fontSize.sm, marginTop: 10 }}>{doneMsg}</div>}
            </>
          ) : null}
        </div>
      </aside>
    </>
  )
}

// ── 스타일 ─────────────────────────────────────────────────────────
const sectionLabel: React.CSSProperties = {
  fontSize: theme.fontSize.xs, fontWeight: 600, color: theme.colors.textSecondary, marginBottom: 6,
}
const cellTh: React.CSSProperties = {
  padding: '8px 6px', textAlign: 'center', fontWeight: 600, whiteSpace: 'nowrap',
}
const cellTd: React.CSSProperties = {
  padding: '8px 6px', textAlign: 'center', color: theme.colors.textPrimary, verticalAlign: 'middle',
}

export default CancelOrderDrawer
