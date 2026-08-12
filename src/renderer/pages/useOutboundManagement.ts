/* ================================================================
   반출관리 커스텀 훅 — 로직 전담
   - si_rg_item_data 중 offer_condition 이 'NEW' 가 아닌(반품 등급) 재고를
     보여준다. 표시 대상은 판매가능 재고(orderable_qty)가 1 이상인 행.
   - 상품명 + 옵션명이 같은 행은 하나의 묶음으로 보고, 묶음 합계를 기준으로
     정렬한다 (같은 상품·옵션의 등급별 행이 흩어지지 않도록).
   - 정렬 기준 2가지: 보관비(기본, 내림차순) / 재고량
   ================================================================ */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { fetchNonNewRgItemData } from '../services/purchaseService'
import { downloadStyledWorkbook } from '../services/inboundExcelService'
import type { RgItemData } from '../types/purchase'

// ── 상수 ──────────────────────────────────────────────────────
const DEFAULT_PAGE_SIZE = 100
export const PAGE_SIZE_OPTIONS = [100, 500] as const

// ── 반출 xlsx ─────────────────────────────────────────────────
//   1행 = 헤더('option ID'), 2행부터 Option ID 를 20개씩 콤마로 묶어
//   한 셀에 담는다 (쿠팡 반출 신청 화면에 그대로 붙여넣는 용도).
const OUTBOUND_EXCEL_CHUNK = 20
const OUTBOUND_EXCEL_SHEET = '반출'
const OUTBOUND_EXCEL_FILE = '반출.xlsx'

// ── 컬럼 정의 ─────────────────────────────────────────────────
export interface OutboundColumn {
  key: keyof RgItemData
  label: string
  width: string
  /** 좌측 정렬 텍스트 열 (상품명 / 옵션명) */
  isText?: boolean
}

export const OUTBOUND_COLUMNS: OutboundColumn[] = [
  { key: 'item_id',             label: 'Inventory ID', width: '110px' },
  { key: 'option_id',           label: 'Option ID',    width: '110px' },
  { key: 'sku_id',              label: 'SKU ID',       width: '90px' },
  { key: 'item_name',           label: '상품명',        width: '320px', isText: true },
  { key: 'option_name',         label: '옵션명',        width: '160px', isText: true },
  { key: 'offer_condition',     label: '등급',          width: '80px' },
  { key: 'orderable_qty',       label: '재고',          width: '60px' },
  { key: 'pending_inbounds',    label: '입고예정',      width: '70px' },
  { key: 'monthly_storage_fee', label: '보관비',        width: '70px' },
]

// ── 행 식별 키 (체크박스 선택용) ───────────────────────────────
//   si_rg_item_data 는 재업로드 시 행이 새로 생성되므로 DB id 를 우선 쓰되,
//   없으면 옵션ID+SKU ID 조합으로 식별한다.
export const rowKeyOf = (row: RgItemData): string =>
  row.id ?? `${row.option_id ?? ''}-${row.sku_id ?? ''}`

// ── 등급(offer_condition) 표시 순서 · 이모지 ───────────────────
//   상황판 카드 순서를 고정한다. 목록에 없는 등급은 뒤에 이름순으로 붙고
//   기본 이모지(⚪)를 쓴다.
const GRADE_ORDER = ['반품-미개봉', '반품-최상', '반품-상', '반품-중', '반품-하']

const GRADE_EMOJI: Record<string, string> = {
  '반품-미개봉': '📦',
  '반품-최상':   '🟢',
  '반품-상':     '🔵',
  '반품-중':     '🟡',
  '반품-하':     '🟠',
}

export const gradeEmoji = (grade: string): string => GRADE_EMOJI[grade] ?? '⚪'

/** 상황판 한 칸 — 등급별 재고/건수/보관비 */
export interface GradeSummary {
  grade: string
  rows: number   // 행(SKU) 수
  qty: number    // 재고 합
  fee: number    // 보관비 합
}

// ── 묶음(상품명 + 옵션명) 집계 ────────────────────────────────
//   반품 등급 행은 Inventory/Option/SKU ID 가 등급마다 새로 발급되어
//   ID 로는 이어지지 않는다. 따라서 상품명 + 옵션명으로 묶는다.
//   (사입관리의 반품 집계 makeReturnKey 와 동일한 규칙)

/** 묶음 키 — 상품명 + 옵션명 */
export const makeOutboundKey = (row: RgItemData): string =>
  `${(row.item_name ?? '').trim()}||${(row.option_name ?? '').trim()}`

export interface OutboundGroupAgg {
  qty: number   // 재고(orderable_qty) 합
  fee: number   // 보관비(monthly_storage_fee) 합
}

// ── 정렬 ──────────────────────────────────────────────────────
export type OutboundSortKey = 'storage' | 'stock'
export interface OutboundSort {
  key: OutboundSortKey
  dir: 'desc' | 'asc'
}

/** 기본 정렬 — 보관비가 높은 순 */
const DEFAULT_SORT: OutboundSort = { key: 'storage', dir: 'desc' }

// ── 사용자 ID 조회 ────────────────────────────────────────────
const getUserId = (): string | null => {
  const userStr = localStorage.getItem('user')
  if (!userStr) return null
  try {
    return JSON.parse(userStr)?.id ?? null
  } catch {
    return null
  }
}

// ══════════════════════════════════════════════════════════════
// 메인 훅
// ══════════════════════════════════════════════════════════════

export function useOutboundManagement() {
  /* ── 데이터 ──────────────────────────────────────────────── */
  const [rows, setRows] = useState<RgItemData[]>([])
  const [loading, setLoading] = useState(false)

  /* ── 검색 ────────────────────────────────────────────────── */
  const [searchValue, setSearchValue] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  /* ── 체크박스 선택 (행 키 집합) ──────────────────────────── */
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

  /* ── 정렬 / 페이지네이션 ─────────────────────────────────── */
  const [sort, setSortRaw] = useState<OutboundSort>(DEFAULT_SORT)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSizeRaw] = useState<number>(DEFAULT_PAGE_SIZE)

  const setSort = useCallback((key: OutboundSortKey, dir: 'desc' | 'asc') => {
    setSortRaw({ key, dir })
    setCurrentPage(1)
  }, [])

  /** pageSize 변경 시 항상 1페이지로 리셋 (out-of-range 방지) */
  const setPageSize = useCallback((n: number) => {
    setPageSizeRaw(n)
    setCurrentPage(1)
  }, [])

  // ══════════════════════════════════════════════════════════════
  // 데이터 로드
  // ══════════════════════════════════════════════════════════════

  useEffect(() => {
    const load = async () => {
      const userId = getUserId()
      if (!userId) return

      setLoading(true)
      try {
        setRows(await fetchNonNewRgItemData(userId))
      } catch (error) {
        console.error('[반출관리] 데이터 로드 실패:', error)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ══════════════════════════════════════════════════════════════
  // 묶음 집계 (전체 행 기준 — 검색 결과와 무관하게 묶음 총합 사용)
  // ══════════════════════════════════════════════════════════════

  const groupAggMap = useMemo(() => {
    const map = new Map<string, OutboundGroupAgg>()
    for (const r of rows) {
      const key = makeOutboundKey(r)
      const agg = map.get(key) ?? { qty: 0, fee: 0 }
      agg.qty += r.orderable_qty ?? 0
      agg.fee += r.monthly_storage_fee ?? 0
      map.set(key, agg)
    }
    return map
  }, [rows])

  // ══════════════════════════════════════════════════════════════
  // 검색 + 정렬
  // ══════════════════════════════════════════════════════════════

  const filteredRows = useMemo(() => {
    let result = rows

    // ── STEP A: 검색어 (콤마·개행·탭 구분 다중 검색, OR 매칭) ──
    //   숫자 토큰 = Inventory/Option/SKU ID 정확 일치,
    //   그 외 = 상품명/옵션명/등급 부분 일치.
    if (searchQuery) {
      const tokens = searchQuery
        .split(/[\n\r,\t]+/)
        .map((t) => t.trim())
        .filter(Boolean)

      if (tokens.length > 0) {
        const match = (row: RgItemData, token: string): boolean => {
          if (/^\d+$/.test(token)) {
            return (
              String(row.item_id ?? '') === token ||
              String(row.option_id ?? '') === token ||
              String(row.sku_id ?? '') === token
            )
          }
          const q = token.toLowerCase()
          return (
            (!!row.item_name && row.item_name.toLowerCase().includes(q)) ||
            (!!row.option_name && row.option_name.toLowerCase().includes(q)) ||
            (!!row.offer_condition && row.offer_condition.toLowerCase().includes(q))
          )
        }
        result = result.filter((row) => tokens.some((token) => match(row, token)))
      }
    }

    // ── STEP B: 정렬 ──────────────────────────────────────────
    //   1차: 묶음(상품명+옵션명) 합계 — 보관비 또는 재고
    //   2차: 묶음 키 (합계가 같아도 같은 묶음의 행은 붙어 있게)
    //   3차: 등급 → 옵션 ID (묶음 안에서의 순서 고정)
    const metricOf = (key: string): number => {
      const agg = groupAggMap.get(key)
      if (!agg) return 0
      return sort.key === 'storage' ? agg.fee : agg.qty
    }

    return [...result].sort((a, b) => {
      const ka = makeOutboundKey(a)
      const kb = makeOutboundKey(b)
      const ma = metricOf(ka)
      const mb = metricOf(kb)
      if (ma !== mb) return sort.dir === 'desc' ? mb - ma : ma - mb
      if (ka !== kb) return ka.localeCompare(kb, 'ko')
      const c = (a.offer_condition ?? '').localeCompare(b.offer_condition ?? '', 'ko')
      if (c !== 0) return c
      return Number(a.option_id ?? 0) - Number(b.option_id ?? 0)
    })
  }, [rows, searchQuery, sort, groupAggMap])

  /* ── 합계 (상황판·툴바 표시용) ───────────────────────────── */
  const totals = useMemo(() => {
    let qty = 0
    let fee = 0
    for (const r of filteredRows) {
      qty += r.orderable_qty ?? 0
      fee += r.monthly_storage_fee ?? 0
    }
    return { qty, fee, rows: filteredRows.length }
  }, [filteredRows])

  /* ── 등급별 집계 (상황판) ─────────────────────────────────
     검색 결과 기준으로 집계해 표에 보이는 내용과 항상 일치시킨다. */
  const gradeSummary = useMemo((): GradeSummary[] => {
    const map = new Map<string, GradeSummary>()
    for (const r of filteredRows) {
      const grade = (r.offer_condition ?? '').trim() || '미분류'
      const e = map.get(grade) ?? { grade, rows: 0, qty: 0, fee: 0 }
      e.rows += 1
      e.qty += r.orderable_qty ?? 0
      e.fee += r.monthly_storage_fee ?? 0
      map.set(grade, e)
    }
    // GRADE_ORDER 순 → 목록에 없는 등급은 뒤에 이름순
    return [...map.values()].sort((a, b) => {
      const ia = GRADE_ORDER.indexOf(a.grade)
      const ib = GRADE_ORDER.indexOf(b.grade)
      if (ia !== ib) return (ia < 0 ? Number.MAX_SAFE_INTEGER : ia) - (ib < 0 ? Number.MAX_SAFE_INTEGER : ib)
      return a.grade.localeCompare(b.grade, 'ko')
    })
  }, [filteredRows])

  const filteredCount = filteredRows.length
  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize))
  const startIdx = (currentPage - 1) * pageSize
  const pageRows = filteredRows.slice(startIdx, startIdx + pageSize)

  // 헤더 체크박스 핸들러가 최신 페이지 행을 읽되 identity 는 고정되도록 하는 ref
  const pageRowsRef = useRef<RgItemData[]>([])
  pageRowsRef.current = pageRows

  // ══════════════════════════════════════════════════════════════
  // 검색 / 페이지네이션 핸들러
  // ══════════════════════════════════════════════════════════════

  const handleSearch = useCallback(() => {
    setSearchQuery(searchValue.trim())
    setCurrentPage(1)
  }, [searchValue])

  const handleSearchClear = useCallback(() => {
    setSearchValue('')
    setSearchQuery('')
    setCurrentPage(1)
  }, [])

  const handlePageChange = useCallback((page: number) => {
    if (page < 1 || page > totalPages) return
    setCurrentPage(page)
  }, [totalPages])

  // ══════════════════════════════════════════════════════════════
  // 체크박스 선택 (행 키 기준 — 페이지를 넘겨도 선택이 유지된다)
  // ══════════════════════════════════════════════════════════════

  const handleSelectRow = useCallback((rowKey: string, checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (checked) next.add(rowKey)
      else next.delete(rowKey)
      return next
    })
  }, [])

  /** 헤더 체크박스 — 현재 페이지 행만 전체 선택/해제 */
  const handleSelectAll = useCallback((checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      for (const r of pageRowsRef.current) {
        if (checked) next.add(rowKeyOf(r))
        else next.delete(rowKeyOf(r))
      }
      return next
    })
  }, [])

  const isPageAllSelected =
    pageRows.length > 0 && pageRows.every((r) => selectedKeys.has(rowKeyOf(r)))

  // ══════════════════════════════════════════════════════════════
  // [반출 xlsx] — Option ID 를 20개씩 콤마로 묶어 내려받기
  //   대상: 체크된 행이 있으면 그 행만, 없으면 현재 목록(검색·정렬 반영) 전체
  // ══════════════════════════════════════════════════════════════

  const [exporting, setExporting] = useState(false)

  const handleOutboundExcel = useCallback(async () => {
    const targets = selectedKeys.size > 0
      ? filteredRows.filter((r) => selectedKeys.has(rowKeyOf(r)))
      : filteredRows

    const ids = targets
      .map((r) => (r.option_id == null ? '' : String(r.option_id)))
      .filter(Boolean)

    if (ids.length === 0) {
      alert('내보낼 Option ID 가 없습니다.')
      return
    }

    // 1행 헤더 + 20개씩 콤마로 묶은 행
    const aoa: string[][] = [['option ID']]
    for (let i = 0; i < ids.length; i += OUTBOUND_EXCEL_CHUNK) {
      aoa.push([ids.slice(i, i + OUTBOUND_EXCEL_CHUNK).join(',')])
    }

    setExporting(true)
    try {
      await downloadStyledWorkbook(
        [{ name: OUTBOUND_EXCEL_SHEET, aoa, headerFill: true }],
        OUTBOUND_EXCEL_FILE,
      )
    } catch (err: any) {
      console.error('[반출 xlsx] 생성 실패:', err)
      alert(`반출 xlsx 생성 중 오류가 발생했습니다.\n${err?.message ?? ''}`)
    } finally {
      setExporting(false)
    }
  }, [filteredRows, selectedKeys])

  const getPageNumbers = useCallback((): (number | string)[] => {
    const pages: (number | string)[] = []
    const maxVisible = 5

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else if (currentPage <= 3) {
      for (let i = 1; i <= maxVisible; i++) pages.push(i)
      pages.push('...'); pages.push(totalPages)
    } else if (currentPage >= totalPages - 2) {
      pages.push(1); pages.push('...')
      for (let i = totalPages - maxVisible + 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1); pages.push('...')
      for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i)
      pages.push('...'); pages.push(totalPages)
    }
    return pages
  }, [currentPage, totalPages])

  // ── 반환 ────────────────────────────────────────────────────
  return {
    // 데이터
    loading,
    pageRows,
    filteredCount,
    totals,
    gradeSummary,

    // 체크박스
    selectedKeys,
    isPageAllSelected,
    handleSelectRow,
    handleSelectAll,

    // 반출 xlsx
    exporting,
    handleOutboundExcel,

    // 검색
    searchValue,
    setSearchValue,
    handleSearch,
    handleSearchClear,

    // 정렬
    sort,
    setSort,

    // 페이지네이션
    currentPage,
    totalPages,
    pageSize,
    setPageSize,
    handlePageChange,
    getPageNumbers,
  }
}
