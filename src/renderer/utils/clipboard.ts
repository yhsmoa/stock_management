/* ================================================================
   클립보드 복사 유틸
   - navigator.clipboard 우선 (https · localhost)
   - 미지원 환경(Electron 렌더러 일부, 비보안 컨텍스트)은 textarea + execCommand 폴백
   ================================================================ */

// ── 폴백: 숨긴 textarea 를 선택해 복사 ─────────────────────────────
function copyWithTextarea(text: string): boolean {
  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', '')
  el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0'
  document.body.appendChild(el)
  el.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(el)
  }
}

/** 텍스트를 클립보드에 복사 — 성공 여부 반환 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 권한 거부 등 → 폴백
    }
  }
  return copyWithTextarea(text)
}
