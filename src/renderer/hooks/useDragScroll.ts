// ═══════════════════════════════════════════════════════════════════
// useDragScroll — 마우스로 끌어서 스크롤 (손바닥 커서로 화면 옮기기)
//   - 돌려준 ref 를 스크롤 영역(overflow: auto)에 단다
//   - 마우스 왼쪽 버튼으로 DRAG_THRESHOLD_PX 이상 움직여야 끌기로 본다 —
//     그보다 덜 움직이면 보통 클릭 그대로 (표 안의 누를 수 있는 칸이 계속 동작)
//   - 끌기로 끝난 뒤의 click 한 번은 막는다 (끌다 놓은 칸이 눌리지 않게)
//   - 터치 · 펜은 브라우저 기본 스크롤을 그대로 쓴다
//   - 끄는 동안 영역에 DRAGGING_CLASS 를 붙인다 (커서 모양은 CSS 에서)
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react'

// ── 상수 ──────────────────────────────────────────────────────────
/** 이만큼(px) 움직여야 끌기 — 손떨림으로 클릭이 끌기가 되지 않게 */
const DRAG_THRESHOLD_PX = 4
/** 끄는 동안 스크롤 영역에 붙는 클래스 */
export const DRAGGING_CLASS = 'is-dragging'

interface DragStart {
  pointerId: number
  x: number
  y: number
  scrollLeft: number
  scrollTop: number
}

export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let start: DragStart | null = null
    let dragging = false
    let suppressClick = false

    const canScroll = () => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight

    /** 스크롤바 위를 누름 — 브라우저의 스크롤바 끌기와 방향이 반대라 여기서는 손대지 않는다 */
    const onScrollbar = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left - el.clientLeft
      const y = e.clientY - rect.top - el.clientTop
      return x >= el.clientWidth || y >= el.clientHeight
    }

    // ── 누름: 시작점만 기억 (아직 끌기 아님) ──
    const onPointerDown = (e: PointerEvent) => {
      suppressClick = false
      if (e.pointerType !== 'mouse' || e.button !== 0 || !canScroll() || onScrollbar(e)) return
      start = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop }
      dragging = false
      // 글자 선택이 시작되지 않게 — click 은 그대로 온다
      e.preventDefault()
    }

    // ── 움직임: 문턱을 넘으면 끌기 시작, 이후 스크롤 ──
    const onPointerMove = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.pointerId) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (!dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return
        dragging = true
        el.setPointerCapture(e.pointerId)   // 영역 밖으로 나가도 계속 끌리게
        el.classList.add(DRAGGING_CLASS)
      }
      el.scrollLeft = start.scrollLeft - dx
      el.scrollTop = start.scrollTop - dy
    }

    // ── 놓음 · 취소 ──
    const onPointerEnd = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.pointerId) return
      if (dragging) {
        suppressClick = true
        // 놓은 뒤 click 이 안 오는 경우(영역 밖에서 놓음)에도 다음 클릭을 막지 않도록 풀어 둔다
        window.setTimeout(() => { suppressClick = false }, 0)
        el.classList.remove(DRAGGING_CLASS)
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      }
      start = null
      dragging = false
    }

    // ── 끌기 직후의 click 막기 (캡처 단계 — React onClick 까지 가지 않게) ──
    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClick) return
      suppressClick = false
      e.preventDefault()
      e.stopPropagation()
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerEnd)
    el.addEventListener('pointercancel', onPointerEnd)
    el.addEventListener('click', onClickCapture, true)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerEnd)
      el.removeEventListener('pointercancel', onPointerEnd)
      el.removeEventListener('click', onClickCapture, true)
      el.classList.remove(DRAGGING_CLASS)
    }
  }, [])

  return ref
}
