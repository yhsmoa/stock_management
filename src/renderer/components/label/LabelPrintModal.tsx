/* ================================================================
   라벨출력 모달 — label-service /print-embed 를 iframe 으로 띄운다
   - 열리면 iframe 을 로드하고, 'label-print:ready' 가 오면 요청을 postMessage
   - 인쇄 자체(템플릿 선택 · QZ Tray 전송)는 iframe 안에서 일어난다
   - 결과('label-print:result')는 하단 상태줄에 표시
   - iframe 은 모달이 닫혀도 유지해 두 번째부터는 즉시 뜨게 한다
   ================================================================ */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { theme } from '../../styles/theme'
import {
  LABEL_MSG_READY,
  LABEL_MSG_RESULT,
  getLabelServiceOrigin,
  labelEmbedUrl,
  type LabelPrintRequest,
  type LabelPrintResult,
} from '../../services/labelService'

interface Props {
  open: boolean
  /** 열릴 때 보낼 요청. null 이면 아무것도 보내지 않는다 */
  request: LabelPrintRequest | null
  onClose: () => void
}

const LabelPrintModal: React.FC<Props> = ({ open, request, onClose }) => {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const readyRef = useRef(false)
  const pendingRef = useRef<LabelPrintRequest | null>(null)
  const [status, setStatus] = useState<string[]>([])
  const [frameSrc, setFrameSrc] = useState<string>('')

  const origin = getLabelServiceOrigin()

  // ── 준비되면 대기 중인 요청 전송 ──
  const flush = useCallback(() => {
    const win = frameRef.current?.contentWindow
    if (!win || !readyRef.current || !pendingRef.current || !origin) return
    win.postMessage(pendingRef.current, origin)
    pendingRef.current = null
  }, [origin])

  // ── 열릴 때: 요청 대기열에 넣고 iframe 로드(최초 1회) ──
  useEffect(() => {
    if (!open || !request) return
    pendingRef.current = request
    setStatus([])
    if (!frameSrc) setFrameSrc(labelEmbedUrl())   // 로드되면 ready 메시지가 온다
    else flush()
  }, [open, request, frameSrc, flush])

  // ── 임베드 → 호스트 메시지 ──
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!origin || e.origin !== origin) return
      const d = e.data as { type?: string } | null
      if (!d) return
      if (d.type === LABEL_MSG_READY) {
        readyRef.current = true
        flush()
      } else if (d.type === LABEL_MSG_RESULT) {
        const r = d as LabelPrintResult
        const type = r.labelType === 'care' ? '케어 라벨' : '라벨 스티커'
        // 실패 사유는 임베드가 이미 alert 로 띄우므로 여기선 요약만
        setStatus((s) => [...s, r.ok ? `✓ ${type} ${r.printed}장 전송됨` : `✕ ${type} 실패`])
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [origin, flush])

  const count = request?.items.length ?? 0

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: open ? 'flex' : 'none',
        alignItems: 'center', justifyContent: 'center',
        background: theme.colors.overlay,
      }}
      onClick={onClose}
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
        {/* 헤더 */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', borderBottom: `1px solid ${theme.colors.border}`,
          }}
        >
          <h3 style={{ margin: 0, fontSize: theme.fontSize.lg, color: theme.colors.textPrimary }}>
            라벨출력
            <span style={{ marginLeft: 8, fontSize: theme.fontSize.sm, color: theme.colors.textSecondary, fontWeight: 400 }}>
              {count}개 상품
            </span>
          </h3>
          <button
            onClick={onClose}
            style={{
              padding: '6px 14px', border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radius.sm, background: theme.colors.bgCard,
              color: theme.colors.textPrimary, cursor: 'pointer', fontSize: theme.fontSize.sm,
            }}
          >
            닫기
          </button>
        </div>

        {/* 임베드 — 템플릿 확인 · 출력 버튼은 iframe 안에 있다 */}
        <iframe
          ref={frameRef}
          src={frameSrc || undefined}
          title="라벨 출력"
          style={{ display: 'block', width: '100%', height: 480, minHeight: 300, flex: '1 1 auto', border: 0, background: '#fff' }}
        />

        {/* 결과 상태줄 */}
        {status.length > 0 && (
          <div
            style={{
              padding: '8px 16px', fontSize: theme.fontSize.sm, color: theme.colors.success,
              borderTop: `1px solid ${theme.colors.border}`,
            }}
          >
            {status.join(' · ')}
          </div>
        )}
      </div>
    </div>
  )
}

export default LabelPrintModal
