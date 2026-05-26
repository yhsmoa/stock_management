/* ================================================================
   상품정보 페이지 — 커스텀 훅
   - 상태 관리, 데이터 로드, 인라인 편집, 저장 흐름
   - PurchaseManagement 의 editingCell / pendingEdits 패턴 차용
   ================================================================ */

import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  fetchItemInfos,
  upsertItemInfos,
  type ItemInfoRow,
  type ItemInfoUpsert,
} from '../services/itemInfoService'
import type { AuthUser } from '../types/auth'

// ── 상수 ──────────────────────────────────────────────────────────
export const PAGE_SIZE = 100

/** 편집 가능한 컬럼 키 (헤더 4개) */
export type ItemInfoColKey = 'model_name' | 'barcode' | 'composition' | 'recommended_age'

export const COLUMNS: { key: ItemInfoColKey; label: string }[] = [
  { key: 'model_name',      label: '모델명' },
  { key: 'barcode',         label: '바코드' },
  { key: 'composition',     label: '혼용률' },
  { key: 'recommended_age', label: '추천연령' },
]

/** 신규 입력 슬롯 draft 타입 */
type NewRowDraft = Record<ItemInfoColKey, string>
const EMPTY_DRAFT: NewRowDraft = {
  model_name: '',
  barcode: '',
  composition: '',
  recommended_age: '',
}

// ══════════════════════════════════════════════════════════════════
// 커스텀 훅
// ══════════════════════════════════════════════════════════════════

export function useItemInfo() {
  // ── 상태 ──────────────────────────────────────────────────────
  const [items, setItems] = useState<ItemInfoRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [searchValue, setSearchValue] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  // 인라인 편집
  const [editingCell, setEditingCell] = useState<{ rowId: string; colKey: ItemInfoColKey } | null>(null)
  const [editingCellValue, setEditingCellValue] = useState('')
  const [pendingEdits, setPendingEdits] = useState<Map<string, Partial<ItemInfoRow>>>(new Map())

  // 신규 입력 슬롯 (페이지 1 최상단 행)
  const [newRowDraft, setNewRowDraft] = useState<NewRowDraft>({ ...EMPTY_DRAFT })

  // ── 사용자 정보 ───────────────────────────────────────────────
  const getUserId = useCallback((): string => {
    const raw = localStorage.getItem('user')
    if (!raw) return ''
    try {
      const user: AuthUser = JSON.parse(raw)
      return user.id ?? ''
    } catch {
      return ''
    }
  }, [])

  // ── 데이터 로드 ───────────────────────────────────────────────
  const loadData = useCallback(async () => {
    const userId = getUserId()
    if (!userId) return
    setLoading(true)
    try {
      const data = await fetchItemInfos(userId)
      setItems(data)
    } catch (err) {
      console.error('[useItemInfo] 로드 실패:', err)
    } finally {
      setLoading(false)
    }
  }, [getUserId])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ── 검색 ──────────────────────────────────────────────────────
  const handleSearch = useCallback(() => {
    setSearchQuery(searchValue.trim())
    setCurrentPage(1)
  }, [searchValue])

  // ── 필터링 (검색어 = model_name | barcode) ────────────────────
  const filteredItems = useMemo(() => {
    if (!searchQuery) return items
    const keyword = searchQuery.toLowerCase()
    return items.filter((r) =>
      (r.model_name && r.model_name.toLowerCase().includes(keyword))
      || (r.barcode && r.barcode.toLowerCase().includes(keyword)),
    )
  }, [items, searchQuery])

  // ── 페이지네이션 ──────────────────────────────────────────────
  const filteredCount = filteredItems.length
  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE))
  const pagedItems = useMemo(
    () => filteredItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredItems, currentPage],
  )

  const getPageNumbers = useCallback((): (number | 'ellipsis')[] => {
    const pages: (number | 'ellipsis')[] = []
    if (totalPages <= 5) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (currentPage > 3) pages.push('ellipsis')
      const start = Math.max(2, currentPage - 1)
      const end = Math.min(totalPages - 1, currentPage + 1)
      for (let i = start; i <= end; i++) pages.push(i)
      if (currentPage < totalPages - 2) pages.push('ellipsis')
      pages.push(totalPages)
    }
    return pages
  }, [currentPage, totalPages])

  // ── 인라인 편집 ───────────────────────────────────────────────

  /** pendingEdits 우선, 없으면 원본 값 반환 */
  const getCellValue = useCallback((row: ItemInfoRow, colKey: ItemInfoColKey): string => {
    const pend = pendingEdits.get(row.id)
    if (pend && colKey in pend) {
      return (pend as any)[colKey] ?? ''
    }
    return (row[colKey] ?? '') as string
  }, [pendingEdits])

  const handleCellClick = useCallback((rowId: string, colKey: ItemInfoColKey, currentValue: string) => {
    setEditingCell({ rowId, colKey })
    setEditingCellValue(currentValue)
  }, [])

  const handleCellChange = useCallback((value: string) => {
    setEditingCellValue(value)
  }, [])

  /** blur 또는 Enter → pendingEdits 에 commit */
  const handleCellBlur = useCallback(() => {
    if (!editingCell) return
    const { rowId, colKey } = editingCell
    const original = items.find((r) => r.id === rowId)
    const originalValue = (original?.[colKey] ?? '') as string
    const newValue = editingCellValue

    setPendingEdits((prev) => {
      const next = new Map(prev)
      const existing = next.get(rowId) ?? {}
      // 원본과 같으면 pending 에서 제거 (저장 대상 축소)
      if (originalValue === newValue) {
        const cleaned = { ...existing }
        delete (cleaned as any)[colKey]
        if (Object.keys(cleaned).length === 0) next.delete(rowId)
        else next.set(rowId, cleaned)
      } else {
        next.set(rowId, { ...existing, [colKey]: newValue })
      }
      return next
    })
    setEditingCell(null)
    setEditingCellValue('')
  }, [editingCell, editingCellValue, items])

  // ── 신규 입력 슬롯 ────────────────────────────────────────────
  const handleNewRowChange = useCallback((colKey: ItemInfoColKey, value: string) => {
    setNewRowDraft((prev) => ({ ...prev, [colKey]: value }))
  }, [])

  // ── 저장 ──────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const userId = getUserId()
    if (!userId) {
      alert('로그인 정보를 확인해 주세요.')
      return
    }

    // 1) pendingEdits → upsert payload (id 보존, barcode 필수)
    const upserts: ItemInfoUpsert[] = []
    for (const [rowId, edits] of pendingEdits) {
      const original = items.find((r) => r.id === rowId)
      if (!original) continue
      const merged = { ...original, ...edits }
      if (!merged.barcode || merged.barcode.trim() === '') {
        alert(`바코드 없는 행이 있어 저장할 수 없습니다. (id=${rowId})`)
        return
      }
      upserts.push({
        id: original.id,
        user_id: userId,
        model_name: merged.model_name ?? null,
        barcode: merged.barcode.trim(),
        composition: merged.composition ?? null,
        recommended_age: merged.recommended_age ?? null,
      })
    }

    // 2) 신규 입력 슬롯 → barcode 있는 경우만 포함
    const draftBarcode = newRowDraft.barcode.trim()
    if (draftBarcode) {
      upserts.push({
        user_id: userId,
        model_name: newRowDraft.model_name.trim() || null,
        barcode: draftBarcode,
        composition: newRowDraft.composition.trim() || null,
        recommended_age: newRowDraft.recommended_age.trim() || null,
      })
    }

    if (upserts.length === 0) {
      alert('저장할 변경사항이 없습니다.')
      return
    }

    setSaving(true)
    try {
      const { count } = await upsertItemInfos(upserts)
      // 성공 → 재로드 + 상태 초기화
      await loadData()
      setPendingEdits(new Map())
      setNewRowDraft({ ...EMPTY_DRAFT })
      alert(`${count}건 저장 완료`)
    } catch (err: any) {
      console.error('[useItemInfo] 저장 실패:', err)
      alert(`저장 실패: ${err.message || err}`)
    } finally {
      setSaving(false)
    }
  }, [getUserId, pendingEdits, items, newRowDraft, loadData])

  // ── 반환 ──────────────────────────────────────────────────────
  return {
    // 데이터
    items,
    loading,
    saving,

    // 검색·페이지네이션
    searchValue,
    setSearchValue,
    handleSearch,
    currentPage,
    setCurrentPage,
    filteredCount,
    totalPages,
    pagedItems,
    getPageNumbers,

    // 인라인 편집
    editingCell,
    editingCellValue,
    getCellValue,
    handleCellClick,
    handleCellChange,
    handleCellBlur,
    pendingEdits,

    // 신규 입력 슬롯
    newRowDraft,
    handleNewRowChange,

    // 저장
    handleSave,
  }
}
