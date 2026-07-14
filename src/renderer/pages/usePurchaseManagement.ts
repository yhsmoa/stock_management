/* ================================================================
   사입관리 커스텀 훅 — 로직 전담
   - 상태 관리, 데이터 로드, 필터/검색/페이지네이션
   - 핸들러: 리셋, 업데이트, 엑셀 업로드, 바코드 연결, 바코드 연동
   - 인라인 편집, 저장, 상품 상세
   ================================================================ */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import * as XLSX from 'xlsx'
import {
  fetchAllRgProducts,
  mapListItemToRgItems,
  fetchRgItems,
  persistOrderQty,
  fetchRgItemData,
  saveRgItems,
  validateItemDataExcel,
  parseItemDataExcel,
  saveRgItemData,
  parseShipmentSizeExcel,
  saveShipmentSize,
  fetchShipmentSizesByOptionIds,
  upsertNewRgItems,
  updateBarcodesFromMap,
  fetchBarcodesFromApi,
  parseViewsCsv,
  saveViewsData,
  fetchViewsData,
  getRecentViewDates,
  updateVendorItemPrice,
  setVendorItemSale,
  persistCartQty,
  saveItemStatus,
} from '../services/purchaseService'
import { supabase, getOrderUserId } from '../services/supabase'
import {
  fetchOrderDelta,
  fetchCartQtyByBarcode,
  type OrderDelta,
  type ShipmentType,
} from '../services/orderFulfillmentService'
import { sendPurchaseOrdersPre } from '../services/orderSendService'
import type { RgItem, RgItemData } from '../types/purchase'

// ── 상수 ──────────────────────────────────────────────────────
const DEFAULT_PAGE_SIZE = 100
export const PAGE_SIZE_OPTIONS = [100, 500] as const

// ── 편집 가능 필드 타입 ──────────────────────────────────────────
export type EditableField = 'input' | 'in_qty' | 'out_qty'

// ── 컬럼 정의 ─────────────────────────────────────────────────
export interface Column {
  key: string
  label: string
  width: string
  isProduct?: boolean
  isInput?: boolean        // 입력 열 전용 (노란 배경)
  editable?: boolean       // 숫자 인라인 편집 (input, in_qty, out_qty)
  editableText?: boolean   // 문자열 인라인 편집 (note)
  borderLeft?: boolean     // 좌측 옅은 border (그룹 구분용)
  colClass?: string        // 추가 CSS 클래스 (배경색 등)
}

export const COLUMNS: Column[] = [
  { key: 'product',  label: '상품정보', width: '250px', isProduct: true },
  { key: 'input',    label: '입력',     width: '46px', isInput: true, editable: true },
  { key: 'cart',     label: '🛒',       width: '40px' },
  { key: 'order',    label: '주문',     width: '44px' },
  { key: 'c_in',     label: 'C.in',     width: '46px' },
  { key: 'c_stock',  label: 'C.재고',   width: '48px' },
  { key: 'warehouse',label: '창고',     width: '44px' },
  { key: 'personal', label: '기간',     width: '44px', borderLeft: true },
  { key: 'd7',       label: '7d',       width: '40px' },
  { key: 'd30',      label: '30d',      width: '42px' },
  { key: 'recommend',label: '추천',     width: '44px', borderLeft: true },
  { key: 'v1',       label: 'V1',       width: '40px' },
  { key: 'v2',       label: 'V2',       width: '40px' },
  { key: 'v3',       label: 'V3',       width: '40px' },
  { key: 'v4',       label: 'V4',       width: '40px' },
  { key: 'v5',       label: 'V5',       width: '40px' },
  { key: 'storage',  label: '보관료',   width: '48px', borderLeft: true },
  { key: 'price',    label: 'price',    width: '52px' },
  { key: 'margin',   label: 'margin',   width: '52px' },
  { key: 'in_qty',   label: '입고',     width: '46px', editable: true, colClass: 'col-in-qty' },
  { key: 'out_qty',  label: '반출',     width: '46px', editable: true, colClass: 'col-out-qty' },
  { key: 'note',     label: 'note',     width: '70px', editableText: true },
]

// ── 일괄 작업 유틸 ────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 일괄 처리 결과 요약 메시지 (성공/실패/제외 + 실패 내역 미리보기) */
function bulkSummary(label: string, ok: number, fails: string[], skipped: number): string {
  let msg =
    `${label} 완료\n성공 ${ok}건` +
    (fails.length ? `, 실패 ${fails.length}건` : '') +
    (skipped ? `, 옵션ID 없음 ${skipped}건 제외` : '')
  if (fails.length) {
    const preview = fails.slice(0, 10).join('\n')
    msg += `\n\n[실패 내역]\n${preview}${fails.length > 10 ? `\n...외 ${fails.length - 10}건` : ''}`
  }
  return msg
}

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

export function usePurchaseManagement() {
  /* ── 검색 상태 ───────────────────────────────────────────── */
  const [searchValue, setSearchValue] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  // 검색 모드: 'product'(상품검색, 기존) | 'note'(노트검색 — si_rg_items.note)
  const [searchMode, setSearchMode] = useState<'product' | 'note'>('product')

  /* ── 데이터 & 페이지네이션 ───────────────────────────────── */
  const [items, setItems] = useState<RgItem[]>([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSizeRaw] = useState<number>(DEFAULT_PAGE_SIZE)

  /** pageSize 변경 시 항상 1페이지로 리셋 (out-of-range 방지) */
  const setPageSize = useCallback((n: number) => {
    setPageSizeRaw(n)
    setCurrentPage(1)
  }, [])

  /* ── 재고 SKU 데이터 (option_id → RgItemData) ────────── */
  const [itemDataMap, setItemDataMap] = useState<Map<string, RgItemData>>(new Map())

  /* ── 리셋/업데이트 로딩 ──────────────────────────────────── */
  const [resetting, setResetting] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateProgress, setUpdateProgress] = useState('')

  /* ── 체크박스 ────────────────────────────────────────────── */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  /* ── 인라인 편집 (input / in_qty / out_qty 공통) ────────── */
  const [editingCell, setEditingCell] = useState<{ id: string; field: EditableField } | null>(null)
  const [editingCellValue, setEditingCellValue] = useState('')

  /* ── 변경 추적 (일괄 저장용, itemId → { input?, in_qty?, out_qty? }) */
  const [pendingEdits, setPendingEdits] = useState<Map<string, Partial<Record<EditableField, number | null>>>>(new Map())

  /* ── DB 원본값 추적 (되돌리기 감지용) ── */
  const dbOriginalsRef = useRef<Map<string, Partial<Record<EditableField, number | null>>>>(new Map())
  const [saving, setSaving] = useState(false)
  const [resettingInputs, setResettingInputs] = useState(false)

  /* ── 노트(문자열) 인라인 편집 ─────────────────────────────── */
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [pendingNotes, setPendingNotes] = useState<Map<string, string | null>>(new Map())
  const dbOriginalNotesRef = useRef<Map<string, string | null>>(new Map())

  /* ── 상품 상세 패널 ──────────────────────────────────────── */
  const [detailPanelOpen, setDetailPanelOpen] = useState(false)
  const [detailItem, setDetailItem] = useState<RgItem | null>(null)

  /* ── RG 재고 xlsx 업로드 ─────────────────────────────────── */
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStatus, setUploadStatus] = useState('')
  const rgExcelInputRef = useRef<HTMLInputElement>(null)

  /* ── 바코드 연결 xlsx 업로드 ─────────────────────────────── */
  const barcodeExcelInputRef = useRef<HTMLInputElement>(null)

  /* ── 쉽먼트 사이즈 xlsx 업로드 ───────────────────────────── */
  const shipmentSizeExcelInputRef = useRef<HTMLInputElement>(null)

  /* ── 바코드 연동 ─────────────────────────────────────────── */
  const [barcodesyncing, setBarcodesyncing] = useState(false)
  const [barcodeSyncProgress, setBarcodeSyncProgress] = useState('')

  /* ── 조회수 V1~V5 데이터 ─────────────────────────────────── */
  // Map<seller_product_id, Map<date, view>>
  const [viewsDataMap, setViewsDataMap] = useState<Map<string, Map<string, number>>>(new Map())
  // 최근 5개 날짜 (오래된순: [0]=V1, [4]=V5)
  const [recentViewDates, setRecentViewDates] = useState<string[]>([])

  /* ── 창고 재고 (barcode → si_stocks.qty 합산) ──────────── */
  const [warehouseQtyMap, setWarehouseQtyMap] = useState<Map<string, number>>(new Map())

  /* ── 필터 (입력(input) / 주문(order_qty) / 입고 / 반출 / NO 바코드 / 📌 노트) ─ */
  type FilterKey = 'input' | 'order' | 'in_qty' | 'out_qty' | 'no_barcode' | 'note'
  const [activeFilter, setActiveFilter] = useState<FilterKey | null>(null)

  /* ── 상태 필터 (활성/비활성/전체) — 기본 'all'(전체) ─ */
  type StatusFilter = 'active' | 'inactive' | 'all'
  const [statusFilter, setStatusFilterRaw] = useState<StatusFilter>('all')
  const setStatusFilter = useCallback((v: StatusFilter) => {
    setStatusFilterRaw(v)
    setCurrentPage(1)
  }, [])

  /* ── 정렬 (판매량 / 보관료 / 재고량 — 상품 단위 합산, 3단계 토글) ─ */
  type SortKey = 'sales' | 'storage' | 'stock'
  const [sort, setSort] = useState<{ key: SortKey; dir: 'desc' | 'asc' } | null>(null)
  // 판매량 정렬 기준 기간 (7일 / 30일)
  const [salesPeriod, setSalesPeriodRaw] = useState<'7d' | '30d'>('7d')

  /** 정렬 토글: 같은 기준 재클릭 시 내림→오름→해제, 다른 기준 클릭 시 내림차순부터 */
  const handleSortToggle = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'desc' }
      if (prev.dir === 'desc') return { key, dir: 'asc' }
      return null
    })
    setCurrentPage(1)
  }

  /** 정렬 방향 직접 지정 (드롭박스: 오름/내림/전체). dir=null → 해제 */
  const setSortDir = useCallback((key: SortKey, dir: 'desc' | 'asc' | null) => {
    setSort(dir ? { key, dir } : null)
    setCurrentPage(1)
  }, [])

  /** 판매량 기간 변경 (드롭박스: 7일/30일)
   *  - 기간 선택 = 판매량 정렬 활성화. 이미 sales 면 방향 유지, 아니면 내림차순으로 시작 */
  const setSalesPeriod = useCallback((p: '7d' | '30d') => {
    setSalesPeriodRaw(p)
    setSort((prev) => (prev?.key === 'sales' ? prev : { key: 'sales', dir: 'desc' }))
    setCurrentPage(1)
  }, [])

  /* ── 주문 로딩 상태 (주문 🔗 적용 → order_qty 영속화) ──── */
  const [isOrderLoading, setIsOrderLoading] = useState(false)

  // ══════════════════════════════════════════════════════════════
  // 필터 + 검색
  // ══════════════════════════════════════════════════════════════

  const filteredItems = useMemo(() => {
    let result = items

    // ── STEP 0: 상태 필터 (활성/비활성/전체) ──────────────────────
    //   active(기본): 비활성 상품 숨김 / inactive: 비활성만 / all: 전체
    if (statusFilter === 'active') {
      result = result.filter((item) => item.item_status !== 'NOT_AVAILABLE')
    } else if (statusFilter === 'inactive') {
      result = result.filter((item) => item.item_status === 'NOT_AVAILABLE')
    }

    // ── STEP A: 필터 토글 (input/in_qty/out_qty/order/no_barcode) ──────
    if (activeFilter === 'input' || activeFilter === 'in_qty' || activeFilter === 'out_qty') {
      const col = activeFilter
      result = result.filter((item) => {
        const v = item[col]
        return v != null && v > 0
      })
    }
    // 주문 필터: order_qty(주문 열) 가 1 이상인 행
    else if (activeFilter === 'order') {
      result = result.filter((item) => item.order_qty != null && item.order_qty > 0)
    }
    // NO 바코드 필터: barcode 가 비어있는(null/'') 행만
    else if (activeFilter === 'no_barcode') {
      result = result.filter((item) => !item.barcode || item.barcode.trim() === '')
    }
    // 📌 노트 필터: note(메모) 데이터가 있는 행만
    else if (activeFilter === 'note') {
      result = result.filter((item) => !!item.note && item.note.trim() !== '')
    }

    // ── STEP B: 검색어 (다중 검색 지원) ─────────────────────────
    //   콤마/개행/탭으로 구분된 여러 검색어를 OR 매칭한다.
    //   (구글 시트에서 세로로 드래그·복사한 값 붙여넣기 = 개행 구분)
    //   각 토큰의 매칭 규칙은 단일 검색과 동일: 숫자면 ID 정확 일치,
    //   그 외에는 상품명/옵션명/바코드 부분 일치.
    if (searchQuery) {
      const tokens = searchQuery
        .split(/[\n\r,\t]+/)
        .map((t) => t.trim())
        .filter(Boolean)

      if (tokens.length > 0) {
        // ── 노트검색 모드: si_rg_items.note 부분 일치 ──
        const matchNote = (item: RgItem, token: string): boolean =>
          !!item.note && item.note.toLowerCase().includes(token.toLowerCase())

        // ── 상품검색 모드(기존): 숫자=ID 정확 일치, 그 외=상품명/옵션명/바코드 부분 일치 ──
        const matchProduct = (item: RgItem, token: string): boolean => {
          if (/^\d+$/.test(token)) {
            return (
              item.seller_product_id === token ||
              item.seller_product_item_id === token ||
              item.vendor_item_id === token
            )
          }
          const q = token.toLowerCase()
          return (
            (!!item.option_name && item.option_name.toLowerCase().includes(q)) ||
            (!!item.seller_product_name && item.seller_product_name.toLowerCase().includes(q)) ||
            (!!item.barcode && item.barcode.toLowerCase().includes(q))
          )
        }

        const matchToken = searchMode === 'note' ? matchNote : matchProduct
        result = result.filter((item) => tokens.some((token) => matchToken(item, token)))
      }
    }

    // ── STEP C: 정렬 ──────────────────────────────────────────
    // 기본(정렬 미선택): 상품명 → 옵션명 (한글 오름차순)
    // 정렬 선택 시: 상품(seller_product_id) 단위 합산값 기준 내림/오름차순.
    //   같은 상품의 옵션은 합산값이 같아 인접 유지 → 2차 정렬(상품명/옵션명).
    const nameCmp = (a: RgItem, b: RgItem): number => {
      const c = (a.seller_product_name ?? '').localeCompare(b.seller_product_name ?? '', 'ko')
      return c !== 0 ? c : (a.option_name ?? '').localeCompare(b.option_name ?? '', 'ko')
    }

    if (sort) {
      // 상품별 합산 (전체 items 기준 — 필터/검색과 무관하게 상품 총합 사용)
      const metricOf = (item: RgItem): number => {
        const data = item.vendor_item_id ? itemDataMap.get(item.vendor_item_id) : undefined
        if (!data) return 0
        if (sort.key === 'sales') {
          return (salesPeriod === '30d' ? data.recent_sales_qty_30d : data.recent_sales_qty_7d) ?? 0
        }
        if (sort.key === 'storage') return data.monthly_storage_fee ?? 0
        return data.orderable_qty ?? 0 // stock = C.재고
      }
      const prodSum = new Map<string, number>()
      for (const it of items) {
        prodSum.set(it.seller_product_id, (prodSum.get(it.seller_product_id) ?? 0) + metricOf(it))
      }
      // 0(또는 음수) 합산 상품은 정렬 대상에서 제외 — 0보다 큰 값만 노출
      result = result.filter((it) => (prodSum.get(it.seller_product_id) ?? 0) > 0)
      result = [...result].sort((a, b) => {
        const sa = prodSum.get(a.seller_product_id) ?? 0
        const sb = prodSum.get(b.seller_product_id) ?? 0
        if (sa !== sb) return sort.dir === 'desc' ? sb - sa : sa - sb
        return nameCmp(a, b)
      })
    } else {
      result = [...result].sort(nameCmp)
    }

    return result
  }, [activeFilter, statusFilter, items, itemDataMap, searchQuery, searchMode, sort, salesPeriod])

  const handleFilterToggle = (filter: FilterKey) => {
    setActiveFilter((prev) => (prev === filter ? null : filter))
    setCurrentPage(1)
  }

  const filteredCount = filteredItems.length
  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize))
  const startIdx = (currentPage - 1) * pageSize
  const pageItems = filteredItems.slice(startIdx, startIdx + pageSize)

  // ══════════════════════════════════════════════════════════════
  // 데이터 로드
  // ══════════════════════════════════════════════════════════════

  useEffect(() => {
    // ── 창고 재고 조회 (barcode → qty 합산, 페이지네이션 루프) ──
    const fetchWarehouseQty = async (userId: string): Promise<Map<string, number>> => {
      const wMap = new Map<string, number>()
      let from = 0
      const batchSize = 1000
      while (true) {
        const { data, error } = await supabase
          .from('si_stocks')
          .select('barcode, qty')
          .eq('user_id', userId)
          .range(from, from + batchSize - 1)
        if (error) { console.error('[창고 재고] 조회 오류:', error); break }
        if (!data || data.length === 0) break
        for (const row of data) {
          if (row.barcode) {
            wMap.set(row.barcode, (wMap.get(row.barcode) || 0) + (row.qty || 0))
          }
        }
        if (data.length < batchSize) break
        from += batchSize
      }
      return wMap
    }

    const loadItems = async () => {
      const userId = getUserId()
      if (!userId) return

      setLoading(true)
      try {
        const [rgItems, rgItemData, viewsData, warehouseMap] = await Promise.all([
          fetchRgItems(userId),
          fetchRgItemData(userId),
          fetchViewsData(userId),
          fetchWarehouseQty(userId),
        ])

        setItems(rgItems)

        // ── itemDataMap (option_id → RgItemData) ──
        const dataMap = new Map<string, RgItemData>()
        for (const d of rgItemData) {
          if (d.option_id != null) dataMap.set(String(d.option_id), d)
        }
        setItemDataMap(dataMap)

        // ── viewsDataMap (seller_product_id → Map<date, view>) ──
        const vMap = new Map<string, Map<string, number>>()
        for (const v of viewsData) {
          if (!vMap.has(v.item_id)) vMap.set(v.item_id, new Map())
          vMap.get(v.item_id)!.set(v.date, v.view)
        }
        setViewsDataMap(vMap)
        setRecentViewDates(getRecentViewDates(viewsData))

        // ── warehouseQtyMap (barcode → si_stocks.qty 합산) ──
        setWarehouseQtyMap(warehouseMap)
      } catch (error) {
        console.error('데이터 로드 실패:', error)
      } finally {
        setLoading(false)
      }
    }
    loadItems()
  }, [])

  // ══════════════════════════════════════════════════════════════
  // [리셋] — 기존 업데이트: 전체 삭제 → API 목록 → 전체 insert
  // ══════════════════════════════════════════════════════════════

  const handleReset = async () => {
    const userId = getUserId()
    if (!userId) {
      alert('사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.')
      return
    }

    // 진입 전 비밀번호 재확인 모달에서 이미 인증 완료 — 추가 confirm 생략

    setResetting(true)
    setUpdateProgress('목록 수집 중...')
    try {
      const products = await fetchAllRgProducts((count) => {
        setUpdateProgress(`목록 수집 중... (${count}개)`)
      })

      const allRgItems = products.flatMap((p) => mapListItemToRgItems(p, userId))

      setUpdateProgress(`저장 중... (${allRgItems.length}건)`)
      const { success, errors } = await saveRgItems(allRgItems, userId)

      setItems(allRgItems as RgItem[])
      setCurrentPage(1)

      alert(`리셋 완료! (저장: ${success}건, 실패: ${errors}건)`)
    } catch (error) {
      console.error('[리셋] 실패:', error)
      alert('리셋 중 오류가 발생했습니다.')
    } finally {
      setResetting(false)
      setUpdateProgress('')
    }
  }

  // ══════════════════════════════════════════════════════════════
  // [업데이트] — 신규 아이템만 추가 (기존 데이터 유지)
  // ══════════════════════════════════════════════════════════════

  const handleUpdate = async () => {
    const userId = getUserId()
    if (!userId) {
      alert('사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.')
      return
    }

    setUpdating(true)
    setUpdateProgress('목록 수집 중...')
    try {
      const products = await fetchAllRgProducts((count) => {
        setUpdateProgress(`목록 수집 중... (${count}개)`)
      })

      const allRgItems = products.flatMap((p) => mapListItemToRgItems(p, userId))

      setUpdateProgress(`신규 확인 중...`)
      const { inserted, skipped } = await upsertNewRgItems(allRgItems, userId)

      // 로컬 상태 갱신: 기존 + 신규 합산
      if (inserted > 0) {
        const refreshed = await fetchRgItems(userId)
        setItems(refreshed)
      }

      alert(`업데이트 완료!\n신규 추가: ${inserted}건, 기존 유지: ${skipped}건`)
    } catch (error) {
      console.error('[업데이트] 실패:', error)
      alert('업데이트 중 오류가 발생했습니다.')
    } finally {
      setUpdating(false)
      setUpdateProgress('')
    }
  }

  // ══════════════════════════════════════════════════════════════
  // [RG 재고 xlsx] — 기존 엑셀 업로드 (이름만 변경)
  // ══════════════════════════════════════════════════════════════

  const handleRgExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const userId = getUserId()
    if (!userId) {
      alert('사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.')
      return
    }

    setIsUploading(true)
    setUploadProgress(0)
    setUploadStatus('파일을 읽는 중...')

    try {
      const binaryStr = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => resolve(e.target?.result as string)
        reader.onerror = () => reject(new Error('파일 읽기 실패'))
        reader.readAsBinaryString(file)
      })
      const workbook = XLSX.read(binaryStr, { type: 'binary' })
      const worksheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][]

      setUploadProgress(10)
      setUploadStatus('헤더 검증 중...')

      if (!rows[0] || !validateItemDataExcel(rows[0])) {
        alert('올바른 재고 SKU 엑셀 파일이 아닙니다.\n(Inventory ID, Option ID, SKU ID, Product name, Option name 헤더가 필요합니다)')
        return
      }

      setUploadProgress(20)
      setUploadStatus('데이터 파싱 중...')

      const parsedItems = parseItemDataExcel(rows, userId)

      if (parsedItems.length === 0) {
        alert('파싱된 데이터가 없습니다. 엑셀 파일을 확인해주세요.')
        return
      }

      setUploadProgress(40)
      setUploadStatus(`${parsedItems.length}건 저장 중...`)

      const { success, errors } = await saveRgItemData(parsedItems, userId)

      const freshData = await fetchRgItemData(userId)
      const dataMap = new Map<string, RgItemData>()
      for (const d of freshData) {
        if (d.option_id != null) dataMap.set(String(d.option_id), d)
      }
      setItemDataMap(dataMap)

      setUploadProgress(100)
      setUploadStatus('완료!')

      alert(`엑셀 업로드 완료!\n성공: ${success.toLocaleString()}건, 실패: ${errors.toLocaleString()}건`)
    } catch (err: any) {
      console.error('[RG 재고 xlsx] 실패:', err)
      alert(`엑셀 업로드 중 오류가 발생했습니다.\n${err.message || ''}`)
    } finally {
      if (rgExcelInputRef.current) rgExcelInputRef.current.value = ''
      setTimeout(() => {
        setIsUploading(false)
        setUploadProgress(0)
        setUploadStatus('')
      }, 1500)
    }
  }

  // ══════════════════════════════════════════════════════════════
  // [쉽먼트 사이즈 xlsx] — si_coupang_shipment_size upsert
  // - 시트명 '상품별 사이즈 리포트' 강제 검증
  // - option_id 누락 행은 리스트로 알림
  // ══════════════════════════════════════════════════════════════

  const handleShipmentSizeExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const userId = getUserId()
    if (!userId) {
      alert('사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.')
      return
    }

    setIsUploading(true)
    setUploadProgress(0)
    setUploadStatus('파일을 읽는 중...')

    try {
      // STEP 1: 파일 읽기
      const binaryStr = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => resolve(e.target?.result as string)
        reader.onerror = () => reject(new Error('파일 읽기 실패'))
        reader.readAsBinaryString(file)
      })
      const workbook = XLSX.read(binaryStr, { type: 'binary' })

      setUploadProgress(20)
      setUploadStatus('시트 검증 및 파싱 중...')

      // STEP 2: 파싱 (시트명 불일치 시 throw)
      const { items: parsedItems, skippedRows } = parseShipmentSizeExcel(workbook, userId)

      if (parsedItems.length === 0 && skippedRows.length === 0) {
        alert('업로드할 데이터가 없습니다. 엑셀 파일을 확인해주세요.')
        return
      }

      setUploadProgress(40)
      setUploadStatus(`${parsedItems.length}건 저장 중...`)

      // STEP 3: 배치 upsert
      const { success, errors } = await saveShipmentSize(parsedItems, userId)

      setUploadProgress(100)
      setUploadStatus('완료!')

      // STEP 4: 완료 알림 (스킵된 행 리스트 포함, 50건 초과 시 축약)
      let message = `쉽먼트 사이즈 업로드 완료!\n성공: ${success.toLocaleString()}건, 실패: ${errors.toLocaleString()}건`
      if (skippedRows.length > 0) {
        const SKIP_PREVIEW = 50
        const previewRows = skippedRows.slice(0, SKIP_PREVIEW).join(', ')
        const suffix =
          skippedRows.length > SKIP_PREVIEW
            ? ` ...외 ${skippedRows.length - SKIP_PREVIEW}건`
            : ''
        message += `\n\noption_id 누락으로 스킵된 행:\n${previewRows}행${suffix}`
      }
      alert(message)
    } catch (err: any) {
      console.error('[쉽먼트 사이즈 xlsx] 실패:', err)
      alert(`쉽먼트 사이즈 업로드 중 오류가 발생했습니다.\n${err.message || ''}`)
    } finally {
      if (shipmentSizeExcelInputRef.current) shipmentSizeExcelInputRef.current.value = ''
      setTimeout(() => {
        setIsUploading(false)
        setUploadProgress(0)
        setUploadStatus('')
      }, 1500)
    }
  }

  // ══════════════════════════════════════════════════════════════
  // [바코드 연결 xlsx] — 엑셀 C열(vendor_item_id) ↔ E열(barcode)
  // ══════════════════════════════════════════════════════════════

  const handleBarcodeExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const userId = getUserId()
    if (!userId) {
      alert('사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.')
      return
    }

    try {
      // STEP 1: 파일 읽기
      const binaryStr = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => resolve(e.target?.result as string)
        reader.onerror = () => reject(new Error('파일 읽기 실패'))
        reader.readAsBinaryString(file)
      })
      const workbook = XLSX.read(binaryStr, { type: 'binary' })

      // STEP 2: 'data' 시트 선택
      const sheetName = workbook.SheetNames.find((n) => n.toLowerCase() === 'data')
        ?? workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][]

      // STEP 3: 4행(index 3)부터 C열(vendor_item_id), E열(barcode)
      // 디버깅: 첫 행의 컬럼값 출력
      if (rows[3]) {
        console.log('[바코드 xlsx] 첫 데이터행(index 3) 전체:', rows[3])
        console.log('[바코드 xlsx] C열(index 2) raw:', rows[3][2], typeof rows[3][2])
        console.log('[바코드 xlsx] E열(index 4) raw:', rows[3][4], typeof rows[3][4])
      }
      // 헤더행도 출력 (컬럼 위치 확인용)
      if (rows[0]) console.log('[바코드 xlsx] 헤더행(0):', rows[0])
      if (rows[1]) console.log('[바코드 xlsx] 헤더행(1):', rows[1])
      if (rows[2]) console.log('[바코드 xlsx] 헤더행(2):', rows[2])

      const barcodeMap = new Map<string, string>()
      for (let i = 3; i < rows.length; i++) {
        const row = rows[i]
        if (!row) continue

        const vendorItemId = row[2] != null ? String(row[2]).trim() : ''
        const barcode = row[4] != null ? String(row[4]).trim() : ''

        if (vendorItemId && barcode) {
          barcodeMap.set(vendorItemId, barcode)
        }
      }

      console.log(`[바코드 xlsx] 엑셀에서 파싱된 barcodeMap: ${barcodeMap.size}건`)
      // 첫 5건 샘플 출력
      let sample = 0
      for (const [vid, bc] of barcodeMap) {
        if (sample >= 5) break
        console.log(`  엑셀 vendor_item_id="${vid}" → barcode="${bc}"`)
        sample++
      }

      if (barcodeMap.size === 0) {
        alert('매칭 가능한 바코드 데이터가 없습니다.\n(C열: vendor_item_id, E열: barcode)')
        return
      }

      // STEP 4: DB 업데이트
      const { updated, notFound } = await updateBarcodesFromMap(barcodeMap, userId)

      // STEP 5: 로컬 상태 갱신
      setItems((prev) =>
        prev.map((item) => {
          if (item.vendor_item_id && barcodeMap.has(item.vendor_item_id)) {
            return { ...item, barcode: barcodeMap.get(item.vendor_item_id)! }
          }
          return item
        }),
      )

      alert(`바코드 연결 완료!\n업데이트: ${updated}건, 미매칭: ${notFound}건`)
    } catch (err: any) {
      console.error('[바코드 연결 xlsx] 실패:', err)
      alert(`바코드 연결 중 오류가 발생했습니다.\n${err.message || ''}`)
    } finally {
      if (barcodeExcelInputRef.current) barcodeExcelInputRef.current.value = ''
    }
  }

  // ══════════════════════════════════════════════════════════════
  // [바코드 연동] — 쿠팡 상세 API → barcode 추출
  // ══════════════════════════════════════════════════════════════

  const handleBarcodeSync = async () => {
    const userId = getUserId()
    if (!userId) {
      alert('사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.')
      return
    }

    // barcode 없는 아이템 필터
    const targets = items.filter((item) => !item.barcode && item.seller_product_id)

    if (targets.length === 0) {
      alert('바코드가 없는 아이템이 없습니다.')
      return
    }

    // 중복 제거된 seller_product_id 기준 예상 시간
    const uniqueSpIds = new Set(targets.map((t) => t.seller_product_id))
    const estimateSec = Math.ceil(uniqueSpIds.size / 5)

    if (!confirm(
      `바코드 없는 아이템: ${targets.length}건\n` +
      `상세 조회 대상: ${uniqueSpIds.size}건 (seller_product_id 기준)\n` +
      `예상 소요: 약 ${estimateSec}초\n\n진행하시겠습니까?`
    )) return

    setBarcodesyncing(true)
    setBarcodeSyncProgress('바코드 조회 중...')

    try {
      const { found, notFound } = await fetchBarcodesFromApi(
        targets,
        (done, total) => {
          setBarcodeSyncProgress(`조회 중... (${done}/${total})`)
        },
      )

      // 로컬 상태 갱신 (fetchBarcodesFromApi가 target의 barcode를 직접 변경)
      setItems((prev) => [...prev])

      alert(`바코드 연동 완료!\n매칭: ${found}건, 미발견: ${notFound}건`)
    } catch (err: any) {
      console.error('[바코드 연동] 실패:', err)
      alert(`바코드 연동 중 오류가 발생했습니다.\n${err.message || ''}`)
    } finally {
      setBarcodesyncing(false)
      setBarcodeSyncProgress('')
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 조회수: 콘솔 스크립트 생성 + CSV 업로드
  // ══════════════════════════════════════════════════════════════

  /* ── CSV 파일 입력 ref + 날짜 모달 상태 ────────────────────── */
  const viewsCsvInputRef = useRef<HTMLInputElement>(null)
  const [viewsDateModalOpen, setViewsDateModalOpen] = useState(false)
  const [viewsDateValue, setViewsDateValue] = useState('')

  /* ── [콘솔] 쿠팡 Wing 콘솔용 JS 스크립트 생성 → 클립보드 복사 ── */
  const handleViewsConsole = useCallback(() => {
    // ── 대상 결정: 선택된 항목 or 전체 (seller_product_id 중복 제거) ──
    // selectedIds는 filteredItems 인덱스 문자열 ("0","1",...) 저장
    const source = selectedIds.size > 0
      ? filteredItems.filter((_, idx) => selectedIds.has(String(idx)))
      : filteredItems
    const uniqueIds = [...new Set(
      source.map((r) => r.seller_product_id).filter(Boolean),
    )]

    if (uniqueIds.length === 0) {
      alert('조회할 상품이 없습니다.')
      return
    }

    // ── 콘솔 스크립트 생성 (쿠팡 Wing Vue.js 호환) ──
    const script = `(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const IDS=${JSON.stringify(uniqueIds)};
const B=100,results=[];
console.log('[조회수] 시작: '+IDS.length+'개 상품, '+Math.ceil(IDS.length/B)+'배치');
for(let i=0;i<IDS.length;i+=B){
  const batch=IDS.slice(i,i+B);
  /* ── textarea 값 설정 (Vue v-model + Wing UI 호환) ── */
  const ta=document.querySelector('.product-number-input textarea');
  if(!ta){console.error('textarea를 찾을 수 없습니다.');return;}
  ta.focus();
  const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
  setter.call(ta,batch.join(','));
  ta.dispatchEvent(new Event('input',{bubbles:true}));
  ta.dispatchEvent(new Event('change',{bubbles:true}));
  await wait(500);
  /* ── 검색 버튼 클릭 ── */
  const btn=document.querySelector('button[type="submit"]');
  if(!btn){console.error('검색 버튼을 찾을 수 없습니다.');return;}
  btn.click();
  await wait(3000);
  /* ── 페이지 순회하며 테이블 데이터 추출 ── */
  let page=1;
  while(true){
    const rows=document.querySelectorAll('table tbody tr.table-row');
    if(rows.length===0){console.warn('배치 '+(Math.floor(i/B)+1)+': 검색 결과 없음');break;}
    rows.forEach(row=>{
      const c=row.querySelectorAll('td');
      if(c.length>=5){
        /* ── 등록상품ID (2번째 td) ── */
        const id=c[1]?.textContent?.trim()||'';
        if(id&&!results.find(r=>r.id===id)){
          /* ── 등록상품명: .product-name-block 에서 추출 (tooltip 중복 방지) ── */
          const name=row.querySelector('.product-name-block')?.textContent?.trim()||'';
          /* ── 상품조회수 (5번째 td, 콤마 제거) ── */
          const views=(c[4]?.textContent?.trim()||'0').replace(/,/g,'');
          results.push({name,id,views});
        }
      }
    });
    /* ── 다음 페이지 ── */
    const nextBtn=document.querySelector('[data-wuic-partial="next"] a');
    if(!nextBtn||nextBtn.offsetParent===null){break;}
    nextBtn.click();page++;await wait(2000);
  }
  console.log('[조회수] 배치 '+(Math.floor(i/B)+1)+'/'+Math.ceil(IDS.length/B)+' 완료 (누적 '+results.length+'건, '+page+'페이지)');
}
/* ── CSV 다운로드 ── */
if(results.length===0){console.warn('[조회수] 추출된 데이터가 없습니다.');return;}
const csv='\\uFEFF등록상품명,등록상품ID,상품조회수\\n'+results.map(r=>'"'+r.name.replace(/"/g,'""')+'","=""'+r.id+'""",'+r.views).join('\\n');
const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='coupang_views.csv';a.click();
console.log('[조회수] 완료! 총 '+results.length+'건 CSV 저장됨');
})();`

    // ── 클립보드 복사 (Electron 호환) ──
    const el = document.createElement('textarea')
    el.value = script
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0'
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)

    alert(`콘솔 스크립트가 클립보드에 복사되었습니다.\n(${uniqueIds.length}개 상품, ${Math.ceil(uniqueIds.length / 100)}배치)`)
  }, [items, filteredItems, selectedIds])

  /* ── [csv 업로드] STEP 1: 모달 열기 ─────────────────────────── */
  const handleViewsCsvClick = useCallback(() => {
    setViewsDateValue('')
    setViewsDateModalOpen(true)
  }, [])

  /* ── [csv 업로드] STEP 2: 날짜 확인 → 파일 선택 트리거 ────── */
  const handleViewsDateConfirm = useCallback(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(viewsDateValue)) {
      alert('날짜를 YYYY-MM-DD 형식으로 입력해주세요.')
      return
    }
    setViewsDateModalOpen(false)
    viewsCsvInputRef.current?.click()
  }, [viewsDateValue])

  /* ── [csv 업로드] STEP 3: 파일 선택 → CSV 파싱 → DB 저장 ──── */
  const handleViewsCsvUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const userId = getUserId()
    if (!userId) {
      alert('사용자 정보를 찾을 수 없습니다.')
      return
    }

    try {
      const text = await file.text()
      const rows = parseViewsCsv(text)

      if (rows.length === 0) {
        alert('CSV에서 유효한 데이터를 찾을 수 없습니다.')
        return
      }

      const { saved, errors } = await saveViewsData(rows, userId, viewsDateValue)

      // ── V1~V5 데이터 갱신 ──
      const freshViews = await fetchViewsData(userId)
      const vMap = new Map<string, Map<string, number>>()
      for (const v of freshViews) {
        if (!vMap.has(v.item_id)) vMap.set(v.item_id, new Map())
        vMap.get(v.item_id)!.set(v.date, v.view)
      }
      setViewsDataMap(vMap)
      setRecentViewDates(getRecentViewDates(freshViews))

      alert(`조회수 저장 완료!\n날짜: ${viewsDateValue}\n저장: ${saved}건${errors > 0 ? `, 실패: ${errors}건` : ''}`)
    } catch (err: any) {
      console.error('[조회수 CSV 업로드] 오류:', err)
      alert(`CSV 업로드 중 오류가 발생했습니다.\n${err.message || ''}`)
    } finally {
      if (viewsCsvInputRef.current) viewsCsvInputRef.current.value = ''
    }
  }, [viewsDateValue])

  // ══════════════════════════════════════════════════════════════
  // 인라인 편집 (input / in_qty / out_qty 공통)
  // ══════════════════════════════════════════════════════════════

  /** 셀 클릭 → 편집 모드 진입 */
  const handleCellClick = (itemId: string, field: EditableField, currentValue: number | null) => {
    setEditingCell({ id: itemId, field })
    setEditingCellValue(currentValue != null ? String(currentValue) : '')
  }

  // ── 노트(문자열) 편집 ────────────────────────────────────────
  /** 노트 셀 클릭 → 편집 모드 진입 */
  const handleNoteClick = (itemId: string, currentValue: string | null) => {
    setEditingNoteId(itemId)
    setNoteDraft(currentValue ?? '')
  }

  /** 노트 blur → DB 원본과 비교 → 변경/되돌리기 판정 (handleCellBlur 와 동일 패턴) */
  const handleNoteBlur = (itemId: string, currentValue: string | null) => {
    setEditingNoteId(null)
    const newValue = noteDraft === '' ? null : noteDraft

    // DB 원본 기록 (첫 편집 시에만)
    const origMap = dbOriginalNotesRef.current
    if (!origMap.has(itemId)) origMap.set(itemId, currentValue)
    const dbOriginal = origMap.get(itemId) ?? null

    // DB 원본과 동일 → 되돌리기 (pending 제거)
    if (newValue === dbOriginal) {
      setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, note: dbOriginal } : it)))
      setPendingNotes((prev) => {
        const next = new Map(prev)
        next.delete(itemId)
        return next
      })
      origMap.delete(itemId)
      return
    }

    // 변경됨 → 로컬 반영 + pending 기록
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, note: newValue } : it)))
    setPendingNotes((prev) => {
      const next = new Map(prev)
      next.set(itemId, newValue)
      return next
    })
  }

  /** 상세 패널 비고 — 즉시 저장 (테이블 [저장] 거치지 않음) */
  const saveDetailNote = useCallback(async (itemId: string, note: string) => {
    const val = note.trim() === '' ? null : note.trim()
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, note: val } : it)))
    // 인라인 편집 pending 과 충돌 방지
    setPendingNotes((prev) => {
      const next = new Map(prev)
      next.delete(itemId)
      return next
    })
    dbOriginalNotesRef.current.delete(itemId)
    try {
      await supabase.from('si_rg_items').update({ note: val }).eq('id', itemId)
    } catch (e) {
      console.error('[saveDetailNote] 실패:', e)
      alert('비고 저장에 실패했습니다.')
    }
  }, [])

  /** 셀 blur → DB 원본값과 비교 → 변경/되돌리기 판정 */
  const handleCellBlur = (itemId: string, field: EditableField, currentValue: number | null) => {
    setEditingCell(null)
    const trimmed = editingCellValue.trim()
    let newValue = trimmed === '' ? null : Number(trimmed)

    // ── 입고 필드 상한 검증: 창고 수량을 초과할 수 없음 ──
    if (field === 'in_qty' && newValue != null && newValue > 0) {
      const targetItem = items.find((it) => it.id === itemId)
      const maxQty = targetItem?.barcode
        ? (warehouseQtyMap.get(targetItem.barcode) ?? 0)
        : 0

      if (newValue > maxQty) {
        alert(`입고 수량은 창고 수량(${maxQty.toLocaleString()})을 초과할 수 없습니다.`)
        newValue = maxQty > 0 ? maxQty : null
      }
    }

    // ── DB 원본값 기록 (해당 필드의 첫 편집 시에만) ──
    const origMap = dbOriginalsRef.current
    const origRow = origMap.get(itemId)
    if (!origRow || !(field in origRow)) {
      // 아직 이 필드의 DB 원본이 기록되지 않음 → currentValue 가 DB 원본
      origMap.set(itemId, { ...origRow, [field]: currentValue })
    }

    const dbOriginal = origMap.get(itemId)![field] ?? null

    // ── DB 원본과 동일하면 되돌리기 → pendingEdits 에서 제거 ──
    if (newValue === dbOriginal) {
      // 로컬 상태를 DB 원본으로 복원
      setItems((prev) =>
        prev.map((item) =>
          item.id === itemId ? { ...item, [field]: dbOriginal } : item,
        ),
      )
      // pendingEdits 에서 해당 필드 제거
      setPendingEdits((prev) => {
        const next = new Map(prev)
        const existing = next.get(itemId)
        if (existing) {
          const { [field]: _, ...rest } = existing
          if (Object.keys(rest).length === 0) {
            next.delete(itemId)
          } else {
            next.set(itemId, rest)
          }
        }
        return next
      })
      // DB 원본 추적에서도 해당 필드 정리
      const origEntry = origMap.get(itemId)
      if (origEntry) {
        const { [field]: _, ...rest } = origEntry
        if (Object.keys(rest).length === 0) {
          origMap.delete(itemId)
        } else {
          origMap.set(itemId, rest)
        }
      }
      return
    }

    // ── 값이 변경됨 → 로컬 상태 반영 + pendingEdits 기록 ──
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, [field]: newValue } : item,
      ),
    )

    setPendingEdits((prev) => {
      const next = new Map(prev)
      const existing = next.get(itemId) || {}
      next.set(itemId, { ...existing, [field]: newValue })
      return next
    })
  }

  /** 일괄 저장 (input + in_qty + out_qty + note, 행 단위 병합) */
  const handleSaveInputs = async () => {
    if (pendingEdits.size === 0 && pendingNotes.size === 0) return

    setSaving(true)
    try {
      const BATCH = 50

      // ── 숫자 필드 (input/in_qty/out_qty) ──
      const entries = Array.from(pendingEdits.entries())
      for (let i = 0; i < entries.length; i += BATCH) {
        const batch = entries.slice(i, i + BATCH)
        await Promise.all(
          batch.map(([id, changes]) =>
            supabase.from('si_rg_items').update(changes).eq('id', id),
          ),
        )
      }

      // ── 노트 (문자열) ──
      const noteEntries = Array.from(pendingNotes.entries())
      for (let i = 0; i < noteEntries.length; i += BATCH) {
        const batch = noteEntries.slice(i, i + BATCH)
        await Promise.all(
          batch.map(([id, note]) =>
            supabase.from('si_rg_items').update({ note }).eq('id', id),
          ),
        )
      }

      setPendingEdits(new Map())
      dbOriginalsRef.current.clear()
      setPendingNotes(new Map())
      dbOriginalNotesRef.current.clear()
    } catch (err) {
      console.error('[저장] 실패:', err)
      alert('저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  // ── 입력 열 전체 초기화 (input + in_qty + out_qty, user_id 기준) ──
  const handleResetInputs = async () => {
    const userId = getUserId()
    if (!userId) return

    if (!confirm('모든 입력값을 초기화하시겠습니까?')) return

    setResettingInputs(true)
    try {
      const { error } = await supabase
        .from('si_rg_items')
        .update({ input: null, in_qty: null, out_qty: null })
        .eq('user_id', userId)
        .or('input.not.is.null,in_qty.not.is.null,out_qty.not.is.null')
      if (error) throw error

      setPendingEdits(new Map())
      dbOriginalsRef.current.clear()
      setItems((prev) => prev.map((item) => ({
        ...item, input: null, in_qty: null, out_qty: null,
      })))
    } catch (err) {
      console.error('[입력 초기화] 실패:', err)
      alert('입력값 초기화 중 오류가 발생했습니다.')
    } finally {
      setResettingInputs(false)
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 클립보드 복사 (구글 시트 TSV)
  // - 대상: 현재 filteredItems 중 input > 0 인 행
  // - 포맷 (22컬럼, 탭 구분):
  //     A,B: 빈칸
  //     C: seller_product_name
  //     D: option_name
  //     E: input (수량)
  //     F: barcode
  //     G~T: 빈칸 (14컬럼)
  //     U: vendor_item_id (= option_id)
  //     V: shipment_size_before (si_coupang_shipment_size JOIN)
  // ══════════════════════════════════════════════════════════════

  const [copying, setCopying] = useState(false)

  /** TSV 안전용: 탭/개행 제거 */
  const sanitizeCell = (v: string | null | undefined): string =>
    (v ?? '').replace(/[\t\r\n]+/g, ' ').trim()

  const handleCopy = async () => {
    const targets = filteredItems.filter(
      (item) => item.input != null && item.input > 0,
    )

    if (targets.length === 0) {
      alert('복사할 데이터가 없습니다. (입력 수량이 1 이상인 행 없음)')
      return
    }

    setCopying(true)
    try {
      // ── 사이즈 조회: 대상 option_id 배치 .in() 쿼리 ──────────
      const userId = getUserId()
      const optionIds = targets
        .map((r) => r.vendor_item_id)
        .filter((id): id is string => !!id)

      const sizeMap = userId
        ? await fetchShipmentSizesByOptionIds(userId, optionIds)
        : new Map<string, string>()

      // ── TSV 조립 ──────────────────────────────────────────────
      const GAP = new Array(14).fill('') // G~T 빈 열
      const lines = targets.map((r) => {
        const optionId = r.vendor_item_id ?? ''
        const shipmentSizeBefore = optionId ? (sizeMap.get(optionId) ?? '') : ''

        const cols = [
          '', '',                                    // A, B
          sanitizeCell(r.seller_product_name),       // C
          sanitizeCell(r.option_name),               // D
          r.input != null ? String(r.input) : '',    // E
          sanitizeCell(r.barcode),                   // F
          ...GAP,                                    // G~T
          sanitizeCell(r.vendor_item_id),            // U
          sanitizeCell(shipmentSizeBefore),          // V
        ]
        return cols.join('\t')
      })
      const tsv = lines.join('\n')

      // ── execCommand 방식 (Electron + 웹 공용) ──
      const el = document.createElement('textarea')
      el.value = tsv
      el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0'
      document.body.appendChild(el)
      el.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(el)

      if (!ok) throw new Error('execCommand copy 실패')

      // 사이즈 매칭 결과 표시
      const matched = Array.from(sizeMap.keys()).length
      alert(
        `${targets.length.toLocaleString()}건이 클립보드에 복사되었습니다.\n` +
        `(사이즈 매칭: ${matched.toLocaleString()}건 / 대상 ${optionIds.length.toLocaleString()}건)`,
      )
    } catch (err) {
      console.error('[복사] 실패:', err)
      alert('복사 중 오류가 발생했습니다.')
    } finally {
      setCopying(false)
    }
  }

  // ══════════════════════════════════════════════════════════════
  // [주문 전송] — ft_carts + ft_cart_items 일괄 생성
  //   대상: [복사] 와 동일하게 filteredItems 중 input>0 인 행
  //   흐름: 1) 사전 검증 + 미저장 가드 → CartNameInputModal 오픈
  //         2) 모달 [저장] → 실제 전송 (sendPurchaseOrdersPre)
  // ══════════════════════════════════════════════════════════════

  const [orderSending, setOrderSending] = useState(false)
  const [orderSendModalOpen, setOrderSendModalOpen] = useState(false)

  /** [주문 전송] 버튼 onClick — 검증 통과 시 모달만 오픈 */
  const handleOrderSend = useCallback(() => {
    const targets = filteredItems.filter(
      (item) => item.input != null && item.input > 0,
    )
    if (targets.length === 0) {
      alert('입력 값이 있는 행이 없습니다.')
      return
    }
    if (pendingEdits.size > 0) {
      if (!confirm('저장하지 않은 변경이 있습니다. 그대로 전송하시겠어요?')) return
    }
    setOrderSendModalOpen(true)
  }, [filteredItems, pendingEdits])

  /** 모달 [저장] — 실제 전송 + 사용자 알림 */
  const handleConfirmOrderSend = useCallback(async (cartName: string) => {
    const targets = filteredItems.filter(
      (item) => item.input != null && item.input > 0,
    )
    if (targets.length === 0) {
      alert('전송할 행이 없습니다.')
      return
    }
    const orderUserId = await getOrderUserId()
    if (!orderUserId) {
      alert('로그인 사용자의 order_user_id 가 없습니다. 관리자에게 문의하세요.')
      return
    }

    setOrderSending(true)
    try {
      const { count } = await sendPurchaseOrdersPre(targets, orderUserId, cartName)
      setOrderSendModalOpen(false)
      alert(`${count}건 전송 완료 (${cartName})`)
    } catch (err: any) {
      console.error('[주문 전송] 실패:', err)
      alert(`주문 전송 실패: ${err.message}`)
      // 모달 유지 → 사용자가 이름 바꿔 재시도
    } finally {
      setOrderSending(false)
    }
  }, [filteredItems])

  // ══════════════════════════════════════════════════════════════
  // 상품 상세 패널
  // ══════════════════════════════════════════════════════════════

  const handleProductClick = (item: RgItem) => {
    setDetailItem(item)
    setDetailPanelOpen(true)
  }

  // ══════════════════════════════════════════════════════════════
  // 검색 & 선택
  // ══════════════════════════════════════════════════════════════

  const handleSearch = () => {
    setSearchQuery(searchValue.trim())
    setCurrentPage(1)
  }

  const handleSearchClear = () => {
    setSearchValue('')
    setSearchQuery('')
    setCurrentPage(1)
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(pageItems.map((_, i) => String(startIdx + i))))
    } else {
      setSelectedIds(new Set())
    }
  }

  const handleSelectRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      checked ? next.add(id) : next.delete(id)
      return next
    })
  }

  // ══════════════════════════════════════════════════════════════
  // 페이지네이션
  // ══════════════════════════════════════════════════════════════

  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages) return
    setCurrentPage(page)
  }

  const getPageNumbers = () => {
    const pages: (number | string)[] = []
    const maxVisible = 5

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else if (currentPage <= 3) {
      for (let i = 1; i <= maxVisible; i++) pages.push(i)
      if (totalPages > maxVisible) { pages.push('...'); pages.push(totalPages) }
    } else if (currentPage >= totalPages - 2) {
      pages.push(1); pages.push('...')
      for (let i = totalPages - maxVisible + 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1); pages.push('...')
      for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i)
      pages.push('...'); pages.push(totalPages)
    }
    return pages
  }

  // ══════════════════════════════════════════════════════════════
  // 주문 수량 적용 (OrderModal [적용] 콜백)
  //   - 주문/취소/출고 합계(net)를 계산해 si_rg_items.order_qty 에 영속화
  //   - 클릭(적용) 시마다 order_qty 전체 초기화 후 재기록
  //   - 화면 '주문' 열은 item.order_qty 를 직접 표시 (메모리 즉시표시 제거)
  // ══════════════════════════════════════════════════════════════

  const loadOrderDelta = useCallback(
    async (includeTypes: ShipmentType[], excludeShipmentIds: string[], cartIds: string[] = []) => {
      const userId = getUserId()
      if (!userId) {
        alert('사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.')
        return
      }

      setIsOrderLoading(true)
      try {
        // ── order_user_id 조달 (ft_users.id) ──
        // localStorage → si_users 테이블 순으로 조회하는 공용 헬퍼 사용
        // 주의: getUserId() 는 si_users.id 라 ft 조회용으로 사용 불가
        const orderUserId = await getOrderUserId()
        if (!orderUserId) {
          alert('로그인 사용자의 order_user_id 가 없어 주문 데이터를 조회할 수 없습니다.')
          return
        }

        // 현재 로드된 rg_items 의 barcode 추출 (ft_order_items.barcode 매칭용)
        const barcodeList = Array.from(
          new Set(
            items
              .map((it) => it.barcode)
              .filter((b): b is string => !!b),
          ),
        )

        // barcode 가 하나도 없으면 매칭 불가 → 빈 맵 (초기화만 수행)
        const map = barcodeList.length > 0
          ? await fetchOrderDelta(barcodeList, includeTypes, excludeShipmentIds, orderUserId)
          : new Map<string, OrderDelta>()

        // ── 영속화: order_qty 초기화 + net 저장 ──
        const barcodeToNet = new Map<string, number>()
        for (const [bc, delta] of map) barcodeToNet.set(bc, delta.net)
        const matched = await persistOrderQty(userId, barcodeToNet)

        // ── 카트(🛒): 선택 카트의 ft_cart_items.order_qty 합 → cart_qty ──
        //   체크 카트 없으면 빈 맵 → cart_qty 전체 초기화만 수행
        const cartMap = cartIds.length > 0
          ? await fetchCartQtyByBarcode(cartIds, orderUserId)
          : new Map<string, number>()
        const cartMatched = await persistCartQty(userId, cartMap)

        // ── 로컬 상태 갱신 (값 0 또는 미매칭 → null) ──
        setItems((prev) =>
          prev.map((it) => {
            const net = it.barcode ? (map.get(it.barcode)?.net ?? 0) : 0
            const cq = it.barcode ? (cartMap.get(it.barcode) ?? 0) : 0
            return {
              ...it,
              order_qty: net !== 0 ? net : null,
              cart_qty: cq !== 0 ? cq : null,
            }
          }),
        )

        alert(
          barcodeList.length === 0
            ? '연결된 바코드가 없어 주문 수량을 초기화했습니다. (먼저 바코드 연결을 실행하세요)'
            : `주문 수량 갱신 완료 (주문 ${matched.toLocaleString()} · 카트 ${cartMatched.toLocaleString()} 바코드)`,
        )
      } catch (e) {
        console.error('[loadOrderDelta]', e)
        alert('주문 데이터 적용 실패: ' + (e as Error).message)
      } finally {
        setIsOrderLoading(false)
      }
    },
    [items],
  )

  // ══════════════════════════════════════════════════════════════
  // 일괄 작업 (체크된 행) — 가격 변경 / 판매상태 변경
  //   - selectedIds 는 filteredItems 의 인덱스 문자열
  //   - 쿠팡 API rate limit 대응: 순차 호출 + 120ms 간격 + 진행 표시
  // ══════════════════════════════════════════════════════════════

  const selectedItems = useMemo(
    () => filteredItems.filter((_, idx) => selectedIds.has(String(idx))),
    [filteredItems, selectedIds],
  )

  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState('')
  const bulkRunningRef = useRef(false)  // 재진입 방지 (드롭다운 hover 등)

  /** 일괄 동일 가격 적용 (비율 초과 항목은 API 가 거절 → 실패로 집계) */
  const handleBulkPrice = useCallback(async (price: number) => {
    if (bulkRunningRef.current) return
    if (selectedItems.length === 0) { alert('선택된 행이 없습니다.'); return }
    const targets = selectedItems.filter((it) => it.vendor_item_id)
    const skipped = selectedItems.length - targets.length
    if (targets.length === 0) { alert('선택된 행에 옵션ID(vendor_item_id)가 없습니다.'); return }

    bulkRunningRef.current = true
    setBulkRunning(true)
    let ok = 0
    const fails: string[] = []
    const successVids = new Set<string>()
    try {
      for (let i = 0; i < targets.length; i++) {
        const it = targets[i]
        setBulkProgress(`가격 변경 ${i + 1}/${targets.length}`)
        try {
          await updateVendorItemPrice(it.vendor_item_id!, price, false)
          ok++
          successVids.add(it.vendor_item_id!)
        } catch (e: any) {
          fails.push(`${it.option_name ?? it.vendor_item_id}: ${e?.message ?? '실패'}`)
        }
        await sleep(120)
      }
      // 성공 행 로컬 sale_price 갱신
      if (successVids.size > 0) {
        setItems((prev) => prev.map((it) =>
          it.vendor_item_id && successVids.has(it.vendor_item_id) ? { ...it, sale_price: price } : it,
        ))
      }
    } finally {
      bulkRunningRef.current = false
      setBulkRunning(false)
      setBulkProgress('')
    }
    alert(bulkSummary('가격 변경', ok, fails, skipped))
  }, [selectedItems])

  /** 일괄 판매상태 변경 (resume=판매중 / stop=판매중지) */
  const handleBulkSale = useCallback(async (action: 'resume' | 'stop') => {
    if (bulkRunningRef.current) return
    if (selectedItems.length === 0) { alert('선택된 행이 없습니다.'); return }
    const targets = selectedItems.filter((it) => it.vendor_item_id)
    const skipped = selectedItems.length - targets.length
    if (targets.length === 0) { alert('선택된 행에 옵션ID(vendor_item_id)가 없습니다.'); return }

    const label = action === 'resume' ? '판매중' : '판매중지'
    bulkRunningRef.current = true
    setBulkRunning(true)
    let ok = 0
    const fails: string[] = []
    try {
      for (let i = 0; i < targets.length; i++) {
        const it = targets[i]
        setBulkProgress(`${label} ${i + 1}/${targets.length}`)
        try {
          await setVendorItemSale(it.vendor_item_id!, action)
          ok++
        } catch (e: any) {
          fails.push(`${it.option_name ?? it.vendor_item_id}: ${e?.message ?? '실패'}`)
        }
        await sleep(120)
      }
    } finally {
      bulkRunningRef.current = false
      setBulkRunning(false)
      setBulkProgress('')
    }
    alert(bulkSummary(label, ok, fails, skipped))
  }, [selectedItems])

  /** 일괄 비활성화/활성화 — si_rg_items.item_status 변경 (DB, 쿠팡 API 아님) */
  const [statusSaving, setStatusSaving] = useState(false)
  const handleBulkItemStatus = useCallback(async (status: 'NOT_AVAILABLE' | null) => {
    if (selectedItems.length === 0) { alert('선택된 행이 없습니다.'); return }
    const ids = selectedItems.map((it) => it.id).filter((id): id is string => !!id)
    if (ids.length === 0) { alert('선택된 행을 식별할 수 없습니다.'); return }

    setStatusSaving(true)
    try {
      await saveItemStatus(ids, status)
      const idSet = new Set(ids)
      setItems((prev) => prev.map((it) =>
        it.id && idSet.has(it.id) ? { ...it, item_status: status } : it,
      ))
      alert(`${status === 'NOT_AVAILABLE' ? '비활성화' : '활성화'} 완료 (${ids.length}건)`)
    } catch (e: any) {
      console.error('[handleBulkItemStatus] 실패:', e)
      alert('상품 상태 변경 중 오류가 발생했습니다.')
    } finally {
      setStatusSaving(false)
    }
  }, [selectedItems])

  // ══════════════════════════════════════════════════════════════
  // 셀 렌더링 헬퍼
  // ══════════════════════════════════════════════════════════════

  const getItemData = (item: RgItem): RgItemData | undefined =>
    item.vendor_item_id ? itemDataMap.get(item.vendor_item_id) : undefined

  const isNotItemWinner = (item: RgItem): boolean => {
    const data = getItemData(item)
    return data?.item_winner === '아이템위너 아님'
  }

  // ── 반환 ────────────────────────────────────────────────────
  return {
    // 검색
    searchValue,
    setSearchValue,
    searchQuery,
    searchMode,
    setSearchMode,
    handleSearch,
    handleSearchClear,

    // 데이터
    items,
    loading,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    filteredItems,
    filteredCount,
    totalPages,
    startIdx,
    pageItems,
    itemDataMap,
    viewsDataMap,
    recentViewDates,

    // 필터
    activeFilter,
    handleFilterToggle,

    // 정렬 (판매량/보관료/재고량)
    sort,
    handleSortToggle,
    setSortDir,
    salesPeriod,
    setSalesPeriod,

    // 상태 필터 (활성/비활성/전체)
    statusFilter,
    setStatusFilter,

    // 리셋 / 업데이트
    resetting,
    updating,
    updateProgress,
    handleReset,
    handleUpdate,

    // RG 재고 xlsx
    isUploading,
    uploadProgress,
    uploadStatus,
    rgExcelInputRef,
    handleRgExcelUpload,

    // 쉽먼트 사이즈 xlsx
    shipmentSizeExcelInputRef,
    handleShipmentSizeExcelUpload,

    // 바코드 연결 xlsx
    barcodeExcelInputRef,
    handleBarcodeExcel,

    // 바코드 연동
    barcodesyncing,
    barcodeSyncProgress,
    handleBarcodeSync,

    // 조회수
    handleViewsConsole,
    viewsCsvInputRef,
    handleViewsCsvClick,
    handleViewsCsvUpload,
    viewsDateModalOpen,
    setViewsDateModalOpen,
    viewsDateValue,
    setViewsDateValue,
    handleViewsDateConfirm,

    // 체크박스
    selectedIds,
    handleSelectAll,
    handleSelectRow,

    // 인라인 편집 (input / in_qty / out_qty 공통)
    editingCell,
    editingCellValue,
    setEditingCellValue,
    handleCellClick,
    handleCellBlur,

    // 노트(문자열) 인라인 편집
    editingNoteId,
    noteDraft,
    setNoteDraft,
    handleNoteClick,
    handleNoteBlur,
    pendingNotes,
    saveDetailNote,

    // 저장 / 입력 초기화
    pendingEdits,
    saving,
    handleSaveInputs,
    resettingInputs,
    handleResetInputs,

    // 클립보드 복사 (구글 시트 TSV)
    copying,
    handleCopy,

    // 주문 전송
    orderSending,
    orderSendModalOpen,
    setOrderSendModalOpen,
    handleOrderSend,
    handleConfirmOrderSend,

    // 상품 상세
    detailPanelOpen,
    setDetailPanelOpen,
    detailItem,
    handleProductClick,

    // 페이지네이션
    handlePageChange,
    getPageNumbers,

    // 셀 헬퍼
    getItemData,
    isNotItemWinner,

    // 주문 (주문 모달 → order_qty 영속화)
    isOrderLoading,
    loadOrderDelta,

    // 일괄 작업 (가격 / 판매상태 / 비활성화)
    bulkRunning,
    bulkProgress,
    handleBulkPrice,
    handleBulkSale,
    statusSaving,
    handleBulkItemStatus,

    // 창고 재고
    warehouseQtyMap,
  }
}
