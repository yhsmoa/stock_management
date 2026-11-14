// ═══════════════════════════════════════════════════════════════════
// useInventory — 재고관리(/inventory) 화면 상태 · 동작
//   - 조회: 검색 조건(appliedFilters)으로 si_stocks 전체를 받아 화면에서 100행씩 나눈다
//   - [엑셀 추가] 모달(components/inventory/StockExcelImportModal)은 Inventory.tsx 가 열고,
//     닫을 때 쓴 것이 있으면 reload 로 다시 읽는다
//   - [엑셀 다운] 선택 행(없으면 현재 목록 전체) · [선택 삭제] · [전체 삭제]
//   DB 작업은 services/stockService.ts 가 한다 — 여기서는 supabase 를 직접 부르지 않는다.
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { StockService } from '../services/stockService'
import { exportStocksToExcel } from '../services/stockExcelService'
import type { Stock, StockSearchFilters } from '../types/stock'

// ── 상수 ──────────────────────────────────────────────────────────
export const INVENTORY_PAGE_SIZE = 100

export type StockSearchType = StockSearchFilters['searchType']

export const STOCK_SEARCH_TYPE_LABELS: Record<StockSearchType, string> = {
  productName: '상품명',
  barcode: '바코드',
}

const EMPTY_FILTERS: StockSearchFilters = {
  searchKeyword: '',
  searchType: 'productName',
  location: '',
  season: '',
  note: '',
}


// ── 사용자 ID ─────────────────────────────────────────────────────
const getUserId = (): string | null => {
  const raw = localStorage.getItem('user')
  if (!raw) return null
  try { return JSON.parse(raw)?.id ?? null } catch { return null }
}

const hasAnyFilter = (f: StockSearchFilters) =>
  !!(f.searchKeyword.trim() || f.location.trim() || f.season.trim() || f.note.trim())

// ── 페이지 번호 (1 … 4 5 6 … 20) ──────────────────────────────────
const buildPageNumbers = (current: number, total: number): (number | 'ellipsis')[] => {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | 'ellipsis')[] = [1]
  if (current > 3) pages.push('ellipsis')
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i)
  if (current < total - 2) pages.push('ellipsis')
  pages.push(total)
  return pages
}

export function useInventory() {
  // ═══════════════════════════════════════════════════════════════
  // 상태
  // ═══════════════════════════════════════════════════════════════
  const [stocks, setStocks] = useState<Stock[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isWorking, setIsWorking] = useState(false)   // 삭제 등 DB 작업 중 (표는 그대로 둔다)
  const [error, setError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [currentPage, setCurrentPage] = useState(1)

  // ── 검색: 입력 중인 값(filters) · 마지막으로 조회한 값(appliedFilters) ──
  //    작업 뒤 다시 읽을 때는 화면에 보이는 목록과 같은 조건(applied)으로 읽는다
  const [filters, setFilters] = useState<StockSearchFilters>(EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState<StockSearchFilters>(EMPTY_FILTERS)

  const isBusy = isLoading || isWorking

  // ═══════════════════════════════════════════════════════════════
  // 조회
  // ═══════════════════════════════════════════════════════════════
  const fetchStocks = useCallback(async (target: StockSearchFilters) => {
    const userId = getUserId()
    if (!userId) {
      setError('사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.')
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const data = hasAnyFilter(target)
        ? await StockService.getFilteredStocks(target, userId)
        : await StockService.getAllStocks(userId)
      setStocks(data)
      setAppliedFilters(target)
      setSelectedIds(new Set())
      setCurrentPage(1)
    } catch (err) {
      console.error('재고 조회 실패:', err)
      setError('재고 데이터를 불러오는데 실패했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  /** 화면 목록과 같은 조건으로 다시 읽기 ([엑셀 추가]·삭제 뒤) */
  const reload = useCallback(() => fetchStocks(appliedFilters), [fetchStocks, appliedFilters])

  const search = useCallback(() => fetchStocks(filters), [fetchStocks, filters])

  const updateFilter = useCallback(<K extends keyof StockSearchFilters>(key: K, value: StockSearchFilters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }, [])

  useEffect(() => {
    fetchStocks(EMPTY_FILTERS)
  }, [fetchStocks])

  // ═══════════════════════════════════════════════════════════════
  // 페이지 · 선택
  // ═══════════════════════════════════════════════════════════════
  const totalPages = Math.max(1, Math.ceil(stocks.length / INVENTORY_PAGE_SIZE))
  const pageRows = useMemo(
    () => stocks.slice((currentPage - 1) * INVENTORY_PAGE_SIZE, currentPage * INVENTORY_PAGE_SIZE),
    [stocks, currentPage],
  )
  const pageNumbers = useMemo(() => buildPageNumbers(currentPage, totalPages), [currentPage, totalPages])
  const totalQty = useMemo(() => stocks.reduce((sum, s) => sum + (s.qty ?? 0), 0), [stocks])

  const goToPage = useCallback((page: number) => {
    setCurrentPage(Math.min(Math.max(1, page), totalPages))
  }, [totalPages])

  const isPageAllSelected = pageRows.length > 0 && pageRows.every(r => selectedIds.has(r.id))

  const toggleRow = useCallback((id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  /** 머리글 체크 — 지금 페이지의 행만 */
  const togglePage = useCallback((checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const row of pageRows) {
        if (checked) next.add(row.id)
        else next.delete(row.id)
      }
      return next
    })
  }, [pageRows])

  // ═══════════════════════════════════════════════════════════════
  // [엑셀 다운] 선택 행, 없으면 현재 목록 전체
  // ═══════════════════════════════════════════════════════════════
  const downloadExcel = useCallback(async () => {
    const rows = selectedIds.size > 0 ? stocks.filter(s => selectedIds.has(s.id)) : stocks
    const fileName = `재고목록_${new Date().toISOString().split('T')[0]}.xlsx`
    try {
      const ok = await exportStocksToExcel(rows, fileName)
      if (!ok) alert('다운로드 중 오류가 발생했습니다.')
      else alert(rows.length === 0 ? '빈 양식이 다운로드되었습니다.' : `${rows.length}개의 데이터가 다운로드되었습니다.`)
    } catch (err) {
      console.error('엑셀 다운로드 실패:', err)
      alert('엑셀 다운로드 중 오류가 발생했습니다.')
    }
  }, [stocks, selectedIds])

  // ═══════════════════════════════════════════════════════════════
  // 삭제
  // ═══════════════════════════════════════════════════════════════
  const deleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) {
      alert('삭제할 항목을 선택해주세요.')
      return
    }
    if (!window.confirm(`선택한 ${selectedIds.size}개의 항목을 삭제하시겠습니까?`)) return

    setIsWorking(true)
    try {
      const ok = await StockService.deleteMultipleStocks(Array.from(selectedIds))
      // 일부 묶음만 지워졌을 수 있으니 결과와 상관없이 다시 읽는다
      await reload()
      alert(ok ? '선택한 항목이 삭제되었습니다.' : '삭제 중 오류가 발생했습니다.')
    } finally {
      setIsWorking(false)
    }
  }, [selectedIds, reload])

  /** 이 계정의 재고 전부 — 검색 조건과 무관하므로 확인 문구의 건수도 전체 건수로 */
  const deleteAll = useCallback(async () => {
    const userId = getUserId()
    if (!userId) {
      alert('사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.')
      return
    }

    setIsWorking(true)
    try {
      let total: number
      try {
        total = await StockService.countStocksByUser(userId)
      } catch (err) {
        console.error('재고 건수 조회 실패:', err)
        alert('재고 건수를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.')
        return
      }
      if (total === 0) {
        alert('삭제할 재고가 없습니다.')
        return
      }
      const scopeNote = hasAnyFilter(appliedFilters) ? '\n(검색 결과만이 아니라 계정의 재고 전체입니다)' : ''
      if (!window.confirm(`재고 전체(${total.toLocaleString()}건)를 삭제하시겠습니까?${scopeNote}\n이 작업은 되돌릴 수 없습니다.`)) return

      const ok = await StockService.deleteAllStocks(userId)
      await reload()
      alert(ok ? '재고가 전체 삭제되었습니다.' : '전체 삭제 중 오류가 발생했습니다.')
    } finally {
      setIsWorking(false)
    }
  }, [appliedFilters, reload])

  return {
    // 목록
    stocks, pageRows, totalQty, isLoading, isBusy, error, reload,
    // 검색
    filters, updateFilter, search,
    // 페이지
    currentPage, totalPages, pageNumbers, goToPage,
    // 선택
    selectedIds, isPageAllSelected, toggleRow, togglePage,
    // 작업
    downloadExcel, deleteSelected, deleteAll,
  }
}
