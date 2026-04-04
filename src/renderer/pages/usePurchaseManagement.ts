/* ================================================================
   사입관리 커스텀 훅 — 로직 전담
   - 상태 관리, 데이터 로드, 필터/검색/페이지네이션
   - 핸들러: 리셋, 업데이트, 엑셀 업로드, 바코드 연결, 바코드 연동
   - 인라인 편집, 저장, 상품 상세
   ================================================================ */

import { useState, useEffect, useRef, useMemo } from 'react'
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
} from '../services/purchaseService'
import { supabase } from '../services/supabase'
import type { RgItem, RgItemData } from '../types/purchase'

// ── 상수 ──────────────────────────────────────────────────────
const PAGE_SIZE = 100

// ── 컬럼 정의 ─────────────────────────────────────────────────
export interface Column {
  key: string
  label: string
  width: string
  isProduct?: boolean
  isInput?: boolean
}

export const COLUMNS: Column[] = [
  { key: 'product',  label: '상품정보', width: '250px', isProduct: true },
  { key: 'input',    label: '입력',     width: '46px', isInput: true },
  { key: 'c_in',     label: 'C.in',     width: '46px' },
  { key: 'c_stock',  label: 'C.재고',   width: '48px' },
  { key: 'order',    label: '주문',     width: '44px' },
  { key: 'personal', label: '개인',     width: '44px' },
  { key: 'd7',       label: '7d',       width: '40px' },
  { key: 'd30',      label: '30d',      width: '42px' },
  { key: 'recommend',label: '추천',     width: '44px' },
  { key: 'warehouse',label: '창고',     width: '44px' },
  { key: 'storage',  label: '보관료',   width: '48px' },
  { key: 'v1',       label: 'V1',       width: '40px' },
  { key: 'v2',       label: 'V2',       width: '40px' },
  { key: 'v3',       label: 'V3',       width: '40px' },
  { key: 'v4',       label: 'V4',       width: '40px' },
  { key: 'v5',       label: 'V5',       width: '40px' },
  { key: 'price',    label: 'price',    width: '52px' },
  { key: 'margin',   label: 'margin',   width: '52px' },
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

  /* ── 인라인 편집 (입력 열) ──────────────────────────────── */
  const [editingInputId, setEditingInputId] = useState<string | null>(null)
  const [editingInputValue, setEditingInputValue] = useState('')

  /* ── 변경 추적 (일괄 저장용) ────────────────────────────── */
  const [pendingInputs, setPendingInputs] = useState<Map<string, number | null>>(new Map())
  const [saving, setSaving] = useState(false)

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

  /* ── 필터 (판매량 / 반출비 토글) ─────────────────────────── */
  const [activeFilter, setActiveFilter] = useState<'sales' | 'storage' | null>(null)

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
    const loadItems = async () => {
      const userId = getUserId()
      if (!userId) return

      setLoading(true)
      try {
        const [rgItems, rgItemData] = await Promise.all([
          fetchRgItems(userId),
          fetchRgItemData(userId),
        ])

        setItems(rgItems)

        const dataMap = new Map<string, RgItemData>()
        for (const d of rgItemData) {
          if (d.option_id != null) dataMap.set(String(d.option_id), d)
        }
        setItemDataMap(dataMap)
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
  // 인라인 편집 (입력 열)
  // ══════════════════════════════════════════════════════════════

  const handleInputClick = (itemId: string, currentValue: number | null) => {
    setEditingInputId(itemId)
    setEditingInputValue(currentValue != null ? String(currentValue) : '')
  }

  const handleInputBlur = (itemId: string, originalValue: number | null) => {
    setEditingInputId(null)
    const trimmed = editingInputValue.trim()
    const newValue = trimmed === '' ? null : Number(trimmed)

    if (newValue === originalValue) return

    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, input: newValue } : item,
      ),
    )

    setPendingInputs((prev) => {
      const next = new Map(prev)
      next.set(itemId, newValue)
      return next
    })
  }

  const handleSaveInputs = async () => {
    if (pendingInputs.size === 0) return

    setSaving(true)
    try {
      const entries = Array.from(pendingInputs.entries())
      const BATCH = 50
      for (let i = 0; i < entries.length; i += BATCH) {
        const batch = entries.slice(i, i + BATCH)
        await Promise.all(
          batch.map(([id, value]) =>
            supabase.from('si_rg_items').update({ input: value }).eq('id', id),
          ),
        )
      }
      setPendingInputs(new Map())
    } catch (err) {
      console.error('[저장] 실패:', err)
      alert('저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
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

    // 체크박스
    selectedIds,
    handleSelectAll,
    handleSelectRow,

    // 인라인 편집
    editingInputId,
    editingInputValue,
    setEditingInputValue,
    handleInputClick,
    handleInputBlur,

    // 저장
    pendingInputs,
    saving,
    handleSaveInputs,

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
  }
}
