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
  fetchRgItemData,
  saveRgItems,
  validateItemDataExcel,
  parseItemDataExcel,
  saveRgItemData,
  upsertNewRgItems,
  updateBarcodesFromMap,
  fetchBarcodesFromApi,
  parseViewsCsv,
  saveViewsData,
  fetchViewsData,
  getRecentViewDates,
} from '../services/purchaseService'
import { supabase, getOrderUserId } from '../services/supabase'
import {
  fetchOrderDelta,
  type OrderDelta,
  type ShipmentType,
} from '../services/orderFulfillmentService'
import type { RgItem, RgItemData } from '../types/purchase'

// ── 상수 ──────────────────────────────────────────────────────
const PAGE_SIZE = 100

// ── 편집 가능 필드 타입 ──────────────────────────────────────────
export type EditableField = 'input' | 'in_qty' | 'out_qty'

// ── 컬럼 정의 ─────────────────────────────────────────────────
export interface Column {
  key: string
  label: string
  width: string
  isProduct?: boolean
  isInput?: boolean        // 입력 열 전용 (노란 배경)
  editable?: boolean       // 인라인 편집 가능 여부 (input, in_qty, out_qty)
  borderLeft?: boolean     // 좌측 옅은 border (그룹 구분용)
  colClass?: string        // 추가 CSS 클래스 (배경색 등)
}

export const COLUMNS: Column[] = [
  { key: 'product',  label: '상품정보', width: '250px', isProduct: true },
  { key: 'input',    label: '입력',     width: '46px', isInput: true, editable: true },
  { key: 'order',    label: '주문',     width: '44px' },
  { key: 'c_in',     label: 'C.in',     width: '46px' },
  { key: 'c_stock',  label: 'C.재고',   width: '48px' },
  { key: 'warehouse',label: '창고',     width: '44px' },
  { key: 'personal', label: '개인',     width: '44px', borderLeft: true },
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
  { key: 'note',     label: 'note',     width: '70px' },
]

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

  /* ── 데이터 & 페이지네이션 ───────────────────────────────── */
  const [items, setItems] = useState<RgItem[]>([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  /* ── 재고건강 SKU 데이터 (option_id → RgItemData) ────────── */
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

  /* ── 필터 (판매량 / 반출비 토글) ─────────────────────────── */
  const [activeFilter, setActiveFilter] = useState<'sales' | 'storage' | null>(null)

  /* ── 주문 델타 (주문 - 취소 - 출고, barcode 기준) ──────── */
  const [orderDeltaMap, setOrderDeltaMap] = useState<Map<string, OrderDelta>>(new Map())
  const [isOrderLoading, setIsOrderLoading] = useState(false)

  // ══════════════════════════════════════════════════════════════
  // 필터 + 검색
  // ══════════════════════════════════════════════════════════════

  const filteredItems = useMemo(() => {
    let result = items

    // ── STEP A: 필터 토글 ──────────────────────────────────
    if (activeFilter && itemDataMap.size > 0) {
      const matchedItemIds = new Set<number>()
      for (const d of itemDataMap.values()) {
        if (d.item_id == null) continue
        if (activeFilter === 'sales') {
          const hasSalesData =
            (d.recent_sales_qty_7d != null && d.recent_sales_qty_7d > 0) ||
            (d.recent_sales_qty_30d != null && d.recent_sales_qty_30d > 0) ||
            (d.recommended_inbound_qty != null && d.recommended_inbound_qty > 0)
          if (hasSalesData) matchedItemIds.add(d.item_id)
        } else if (activeFilter === 'storage') {
          if (d.monthly_storage_fee != null && d.monthly_storage_fee > 0) {
            matchedItemIds.add(d.item_id)
          }
        }
      }

      if (matchedItemIds.size === 0) return []

      const matchedOptionIds = new Set<string>()
      for (const d of itemDataMap.values()) {
        if (d.item_id != null && matchedItemIds.has(d.item_id) && d.option_id != null) {
          matchedOptionIds.add(String(d.option_id))
        }
      }

      result = result.filter(
        (item) => item.vendor_item_id != null && matchedOptionIds.has(item.vendor_item_id),
      )

      const getItemIdForSort = (item: RgItem): number => {
        const data = item.vendor_item_id ? itemDataMap.get(item.vendor_item_id) : undefined
        return data?.item_id ?? 0
      }
      result.sort((a, b) => getItemIdForSort(a) - getItemIdForSort(b))
    }

    // ── STEP B: 검색어 ──────────────────────────────────────
    if (searchQuery) {
      const isNumeric = /^\d+$/.test(searchQuery)
      if (isNumeric) {
        result = result.filter((item) =>
          item.seller_product_id === searchQuery ||
          item.seller_product_item_id === searchQuery ||
          item.vendor_item_id === searchQuery,
        )
      } else {
        const q = searchQuery.toLowerCase()
        result = result.filter((item) =>
          (item.item_name && item.item_name.toLowerCase().includes(q)) ||
          (item.seller_product_name && item.seller_product_name.toLowerCase().includes(q)) ||
          (item.barcode && item.barcode.toLowerCase().includes(q)),
        )
      }
    }

    return result
  }, [activeFilter, items, itemDataMap, searchQuery])

  const handleFilterToggle = (filter: 'sales' | 'storage') => {
    setActiveFilter((prev) => (prev === filter ? null : filter))
    setCurrentPage(1)
  }

  const filteredCount = filteredItems.length
  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE))
  const startIdx = (currentPage - 1) * PAGE_SIZE
  const pageItems = filteredItems.slice(startIdx, startIdx + PAGE_SIZE)

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

    if (!confirm('기존 데이터를 모두 삭제하고 다시 받아옵니다.\n진행하시겠습니까?')) return

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
        alert('올바른 재고건강 SKU 엑셀 파일이 아닙니다.\n(Inventory ID, Option ID, SKU ID, Product name, Option name 헤더가 필요합니다)')
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

  /** 일괄 저장 (input + in_qty + out_qty, 행 단위 병합) */
  const handleSaveInputs = async () => {
    if (pendingEdits.size === 0) return

    setSaving(true)
    try {
      const entries = Array.from(pendingEdits.entries())
      const BATCH = 50
      for (let i = 0; i < entries.length; i += BATCH) {
        const batch = entries.slice(i, i + BATCH)
        await Promise.all(
          batch.map(([id, changes]) =>
            supabase.from('si_rg_items').update(changes).eq('id', id),
          ),
        )
      }
      setPendingEdits(new Map())
      dbOriginalsRef.current.clear()
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
  // 주문 델타 로드 (OrderModal [적용] 콜백)
  //   - productIds (rg_items.seller_product_id) 로 주문/취소/출고 합계 조회
  // ══════════════════════════════════════════════════════════════

  const loadOrderDelta = useCallback(
    async (shipmentIds: string[], shipmentTypes: ShipmentType[]) => {
      setIsOrderLoading(true)
      try {
        // ── order_user_id 조달 (ft_users.id) ──
        // localStorage → si_users 테이블 순으로 조회하는 공용 헬퍼 사용
        // 주의: 기존 getUserId() 는 si_users.id 라 여기서 사용 불가
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
        if (barcodeList.length === 0) {
          setOrderDeltaMap(new Map())
          return
        }

        const map = await fetchOrderDelta(barcodeList, shipmentIds, shipmentTypes, orderUserId)
        setOrderDeltaMap(map)
      } catch (e) {
        console.error('[loadOrderDelta]', e)
        alert('주문 데이터 조회 실패: ' + (e as Error).message)
      } finally {
        setIsOrderLoading(false)
      }
    },
    [items],
  )

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
    handleSearch,
    handleSearchClear,

    // 데이터
    items,
    loading,
    currentPage,
    setCurrentPage,
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

    // 저장 / 입력 초기화
    pendingEdits,
    saving,
    handleSaveInputs,
    resettingInputs,
    handleResetInputs,

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

    // 주문 델타 (주문 모달)
    orderDeltaMap,
    isOrderLoading,
    loadOrderDelta,

    // 창고 재고
    warehouseQtyMap,
  }
}
