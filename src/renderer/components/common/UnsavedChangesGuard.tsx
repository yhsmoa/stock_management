/* ================================================================
   UnsavedChangesGuard — 저장되지 않은 변경이 있을 때 이탈을 막는다
   - 앱 내 이동(사이드바 링크 / 뒤로가기 등): useBlocker 로 가로채 모달 표시
       · [저장 후 이동] : onSave() 가 성공했을 때만 이동
       · [저장 안 함]   : 변경을 버리고 이동
       · [취소]         : 현재 페이지에 머무름
   - 창 닫기 / 새로고침: beforeunload 등록.
     이 경우 브라우저가 자체 경고창만 띄우며(문구·버튼 커스터마이즈 불가),
     '저장 후 닫기' 같은 동작은 브라우저 정책상 불가능하다.
   - useBlocker 는 데이터 라우터(createBrowserRouter)에서만 동작한다 → App.tsx 참고
   ================================================================ */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useBlocker } from 'react-router-dom'
import Button from './Button'
import { theme } from '../../styles/theme'

interface UnsavedChangesGuardProps {
  /** 저장되지 않은 변경이 있는지 */
  when: boolean
  /** 저장 실행 — 성공하면 true (false 면 이동하지 않고 모달 유지) */
  onSave: () => Promise<boolean>
  /** 모달 본문 (미지정 시 기본 문구) */
  message?: string
  /** 변경 건수 — 모달 제목에 표시 */
  count?: number
}

const DEFAULT_MESSAGE =
  '저장하지 않은 변경이 있습니다.\n저장하지 않고 이동하면 입력한 내용이 사라집니다.'

const UnsavedChangesGuard: React.FC<UnsavedChangesGuardProps> = ({
  when,
  onSave,
  message = DEFAULT_MESSAGE,
  count,
}) => {
  const [saving, setSaving] = useState(false)

  // ── 앱 내 이동 차단 ─────────────────────────────────────────────
  //   저장 중에는 이동을 시도해도 계속 막는다.
  const blocker = useBlocker(when)

  // ── 창 닫기 / 새로고침 경고 ─────────────────────────────────────
  //   브라우저 기본 경고창만 가능 (returnValue 문구는 대부분 무시된다)
  useEffect(() => {
    if (!when) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [when])

  // ── 이동 재개 (중복 호출 방지) ──────────────────────────────────
  //   저장 완료 → when=false 로 바뀌며 아래 effect 와 버튼 핸들러가 동시에
  //   proceed 를 부를 수 있어 한 번만 나가도록 막는다.
  const proceedingRef = useRef(false)
  const proceed = useCallback(() => {
    if (proceedingRef.current) return
    proceedingRef.current = true
    blocker.proceed?.()
  }, [blocker])

  useEffect(() => {
    if (blocker.state === 'unblocked') proceedingRef.current = false
  }, [blocker.state])

  // ── 변경이 모두 사라지면(저장 완료 등) 대기 중인 차단은 해제 ────
  useEffect(() => {
    if (!when && blocker.state === 'blocked') proceed()
  }, [when, blocker.state, proceed])

  if (blocker.state !== 'blocked') return null

  // ── 저장 후 이동 ────────────────────────────────────────────────
  const handleSaveAndLeave = async () => {
    setSaving(true)
    try {
      const ok = await onSave()
      // 실패하면 이동하지 않고 모달을 유지해 재시도할 수 있게 한다
      if (ok) proceed()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 600, color: theme.colors.textPrimary, marginBottom: 12 }}>
          저장하지 않은 변경{count ? ` (${count.toLocaleString()}건)` : ''}
        </div>

        <div
          style={{
            fontSize: 13,
            lineHeight: 1.6,
            color: theme.colors.textSecondary,
            whiteSpace: 'pre-line',
          }}
        >
          {message}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
          <Button
            variant="default"
            onClick={() => blocker.reset?.()}
            disabled={saving}
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            취소
          </Button>
          <Button
            variant="default"
            onClick={proceed}
            disabled={saving}
            style={{ padding: '8px 16px', fontSize: 13, color: theme.colors.danger }}
          >
            저장 안 함
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSaveAndLeave()}
            disabled={saving}
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            {saving ? '저장 중...' : '저장'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default UnsavedChangesGuard
