/* ================================================================
   사입관리 [라벨] — 체크한 행을 라벨출력 모달로
   - 체크한 행 → services/purchaseLabelService.ts 로 인쇄 항목 준비 → LabelPrintModal(장수 입력)
   - usePurchaseManagement 와 분리 — 그 훅이 주는 filteredItems · selectedIds 만 읽는다
   - selectedIds 는 filteredItems 의 인덱스 문자열이다 (usePurchaseManagement 의 selectedItems 와 같은 규칙).
     화면의 체크 표시도 같은 인덱스를 쓰므로 "보이는 체크 = 인쇄 대상" 이고,
     모달이 인쇄할 상품 목록을 보여줘서 인쇄 전에 확인할 수 있다.
   ================================================================ */

import { useCallback, useRef, useState } from 'react'
import type { RgItem } from '../../types/purchase'
import type { LabelPrintItem } from '../../services/labelPrintService'
import { buildPurchaseLabelItems } from '../../services/purchaseLabelService'
import { getCurrentLabelAccount } from '../../services/labelService'

export interface PurchaseLabel {
  open: boolean
  items: LabelPrintItem[]
  /** 모달 위쪽 안내 (출고코드 없는 항목 수) */
  notice: string | null
  /** 인쇄 항목 준비 중 (상품관리 조회) — 버튼 문구·중복 클릭 방지 */
  preparing: boolean
  openLabelPrint: () => Promise<void>
  closeLabelPrint: () => void
}

export function usePurchaseLabel(filteredItems: RgItem[], selectedIds: Set<string>): PurchaseLabel {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<LabelPrintItem[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const preparingRef = useRef(false) // 재진입 방지 (빠른 연속 클릭)

  const openLabelPrint = useCallback(async () => {
    if (preparingRef.current) return
    const selected = filteredItems.filter((_, idx) => selectedIds.has(String(idx)))
    if (selected.length === 0) {
      alert('선택된 행이 없습니다.')
      return
    }
    const account = getCurrentLabelAccount()
    if (!account) {
      alert('로그인 정보가 없습니다. 다시 로그인해주세요.')
      return
    }

    preparingRef.current = true
    setPreparing(true)
    try {
      const built = await buildPurchaseLabelItems(selected, account.id)
      if (built.items.length === 0) {
        alert('선택한 항목에 바코드가 없어 라벨을 출력할 수 없습니다.')
        return
      }
      if (built.skipped > 0) {
        alert(`바코드가 없는 ${built.skipped}개 항목은 제외하고 ${built.items.length}개만 출력합니다.`)
      }
      setItems(built.items)
      setNotice(
        built.missingCode > 0
          ? `출고코드가 없는 상품 ${built.missingCode}개 — 라벨의 출고코드·QR 이 비어 나옵니다. (상품관리에 없거나 출고코드가 비어 있는 상품)`
          : null
      )
      setOpen(true)
    } catch (err) {
      console.error('사입관리 라벨 준비 오류:', err)
      alert(`라벨 준비 중 오류가 발생했습니다.\n${err instanceof Error ? err.message : ''}`)
    } finally {
      preparingRef.current = false
      setPreparing(false)
    }
  }, [filteredItems, selectedIds])

  const closeLabelPrint = useCallback(() => setOpen(false), [])

  return { open, items, notice, preparing, openLabelPrint, closeLabelPrint }
}
