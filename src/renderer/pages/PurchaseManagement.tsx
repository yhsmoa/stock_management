import React, { useState, useEffect, useRef, useMemo } from 'react'
import * as XLSX from 'xlsx'
import './PurchaseManagement.css'
import {
  fetchAllRgProducts,
  mapListItemToRgItems,
  fetchRgItems,
  fetchRgItemData,
  saveRgItems,
  validateItemDataExcel,
  parseItemDataExcel,
  saveRgItemData,
} from '../services/purchaseService'
import { supabase } from '../services/supabase'
import type { RgItem, RgItemData } from '../types/purchase'
import ProductDetailPanel from '../components/purchase/ProductDetailPanel'
import UploadProgressModal from '../components/UploadProgressModal'

/* ================================================================
   사입관리 (PurchaseManagement)
   - 상단: 버튼(우측 상단) + 타이틀(가운데)
   - 필터: 판매량 / 반출비 토글 (item_id 그룹 기준)
   - 검색폼: 타원형 검색바
   - 테이블: 화면 가득 채움, 컬럼 타이트
   - 데이터: 쿠팡 로켓그로스 API → Supabase si_rg_items
   - 입력 열: 인라인 편집 (숫자만, 노란색 배경)
   ================================================================ */

// ── 상수 ──────────────────────────────────────────────────────
const PAGE_SIZE = 100

// ── 컬럼 정의 ─────────────────────────────────────────────────
interface Column {
  key: string
  label: string
  width: string
  isProduct?: boolean
  isInput?: boolean    // 인라인 편집 컬럼 여부
}

const COLUMNS: Column[] = [
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

// ── 사용자 ID 조회 (프로젝트 공통 패턴) ───────────────────────
const getUserId = (): string | null => {
  const userStr = localStorage.getItem('user')
  if (!userStr) return null
  try {
    return JSON.parse(userStr)?.id ?? null
  } catch {
    return null
  }
}

const PurchaseManagement: React.FC = () => {
  /* ── 검색 상태 ─────────────────────────────────────────────── */
  const [searchValue, setSearchValue] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  /* ── 데이터 & 페이지네이션 상태 ────────────────────────────── */
  const [items, setItems] = useState<RgItem[]>([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  /* ── 재고건강 SKU 데이터 (option_id → RgItemData 맵) ────────── */
  const [itemDataMap, setItemDataMap] = useState<Map<string, RgItemData>>(new Map())

  /* ── 업데이트 버튼 로딩 & 진행률 상태 ────────────────────────── */
  const [updating, setUpdating] = useState(false)
  const [updateProgress, setUpdateProgress] = useState('')

  /* ── 체크박스 상태 ─────────────────────────────────────────── */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  /* ── 인라인 편집 상태 (입력 열) ──────────────────────────────── */
  const [editingInputId, setEditingInputId] = useState<string | null>(null)
  const [editingInputValue, setEditingInputValue] = useState('')

  /* ── 변경 추적 (일괄 저장용) ──────────────────────────────── */
  const [pendingInputs, setPendingInputs] = useState<Map<string, number | null>>(new Map())
  const [saving, setSaving] = useState(false)

  /* ── 상품 상세 패널 상태 ────────────────────────────────────── */
  const [detailPanelOpen, setDetailPanelOpen] = useState(false)
  const [detailItem, setDetailItem] = useState<RgItem | null>(null)

  /* ── 엑셀 업로드 상태 ──────────────────────────────────────── */
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStatus, setUploadStatus] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  /* ── 필터 상태 (판매량 / 반출비 토글) ──────────────────────── */
  const [activeFilter, setActiveFilter] = useState<'sales' | 'storage' | null>(null)

  // ══════════════════════════════════════════════════════════════
  // 필터 + 검색 로직
  // - 필터: item_id 기준 그룹 필터링 (판매량/반출비)
  // - 검색: 숫자 → ID 매칭, 문자 → item_name/barcode 부분 일치
  // ══════════════════════════════════════════════════════════════
  const filteredItems = useMemo(() => {
    let result = items

    // ── STEP A: 필터 토글 적용 ──────────────────────────────────
    if (activeFilter && itemDataMap.size > 0) {
      // 조건에 맞는 item_id 수집
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

      // 매칭된 item_id의 모든 option_id 수집
      const matchedOptionIds = new Set<string>()
      for (const d of itemDataMap.values()) {
        if (d.item_id != null && matchedItemIds.has(d.item_id) && d.option_id != null) {
          matchedOptionIds.add(String(d.option_id))
        }
      }

      result = result.filter(
        (item) => item.vendor_item_id != null && matchedOptionIds.has(item.vendor_item_id),
      )

      // item_id 기준 정렬
      const getItemIdForSort = (item: RgItem): number => {
        const data = item.vendor_item_id ? itemDataMap.get(item.vendor_item_id) : undefined
        return data?.item_id ?? 0
      }
      result.sort((a, b) => getItemIdForSort(a) - getItemIdForSort(b))
    }

    // ── STEP B: 검색어 적용 ─────────────────────────────────────
    if (searchQuery) {
      const isNumeric = /^\d+$/.test(searchQuery)

      if (isNumeric) {
        // 숫자 → seller_product_id / seller_product_item_id / vendor_item_id 매칭
        result = result.filter((item) =>
          item.seller_product_id === searchQuery ||
          item.seller_product_item_id === searchQuery ||
          item.vendor_item_id === searchQuery,
        )
      } else {
        // 문자 → item_name / barcode 부분 일치 (대소문자 무시)
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

  /* ── 필터 토글 핸들러 ──────────────────────────────────────── */
  const handleFilterToggle = (filter: 'sales' | 'storage') => {
    setActiveFilter((prev) => (prev === filter ? null : filter))
    setCurrentPage(1)
  }

  const filteredCount = filteredItems.length
  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE))

  /* ── 현재 페이지에 표시할 아이템 ─────────────────────────────── */
  const startIdx = (currentPage - 1) * PAGE_SIZE
  const pageItems = filteredItems.slice(startIdx, startIdx + PAGE_SIZE)

  // ══════════════════════════════════════════════════════════════
  // 데이터 로드 & 업데이트
  // ══════════════════════════════════════════════════════════════

  /* ── 페이지 로드 시 si_rg_items + si_rg_item_data 병렬 조회 ──── */
  useEffect(() => {
    const loadItems = async () => {
      const userId = getUserId()
      if (!userId) return

      setLoading(true)
      try {
        // 두 테이블을 병렬로 조회하여 로딩 시간 최소화
        const [rgItems, rgItemData] = await Promise.all([
          fetchRgItems(userId),
          fetchRgItemData(userId),
        ])

        setItems(rgItems)

        // option_id(string) → RgItemData 맵 생성 (O(1) 룩업)
        const dataMap = new Map<string, RgItemData>()
        for (const d of rgItemData) {
          if (d.option_id != null) {
            dataMap.set(String(d.option_id), d)
          }
        }
        setItemDataMap(dataMap)
        console.log(`[PurchaseManagement] JOIN 맵 생성: ${dataMap.size}건`)
      } catch (error) {
        console.error('데이터 로드 실패:', error)
      } finally {
        setLoading(false)
      }
    }
    loadItems()
  }, [])

  /* ── 업데이트 핸들러: 쿠팡 전체 데이터 → Supabase 동기화 ────── */
  const handleUpdate = async () => {
    const userId = getUserId()
    if (!userId) {
      alert('사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.')
      return
    }

    setUpdating(true)
    setUpdateProgress('목록 수집 중...')
    try {
      // STEP 1: 전체 상품 목록 수집 (nextToken 순회)
      const products = await fetchAllRgProducts((count) => {
        setUpdateProgress(`목록 수집 중... (${count}개)`)
      })

      // STEP 2: 목록 데이터 → DB 행 변환 (상세 API 호출 없이 빠르게 처리)
      // - 바코드·가격 등 상세 데이터는 상품 클릭 시 개별 조회
      const allRgItems = products.flatMap((p) => mapListItemToRgItems(p, userId))

      // STEP 3: Supabase에 저장 (병렬 배치 삽입)
      setUpdateProgress(`저장 중... (${allRgItems.length}건)`)
      const { success, errors } = await saveRgItems(allRgItems, userId)

      // STEP 4: 로컬 데이터로 즉시 테이블 갱신 (재조회 불필요)
      setItems(allRgItems as RgItem[])
      setCurrentPage(1)

      alert(`업데이트 완료! (저장: ${success}건, 실패: ${errors}건)`)
    } catch (error) {
      console.error('[업데이트] 실패:', error)
      alert('업데이트 중 오류가 발생했습니다.')
    } finally {
      setUpdating(false)
      setUpdateProgress('')
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 엑셀 업로드 (재고건강 SKU → si_rg_item_data)
  // ══════════════════════════════════════════════════════════════

  /* ── 엑셀 파일 선택 → 검증 → 파싱 → 저장 ──────────────────── */
  const handleExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
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
      // STEP 1: 파일 읽기 → XLSX 파싱 (binary string으로 ZIP 경고 방지)
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

      // STEP 2: 헤더 검증 (Row 0)
      if (!rows[0] || !validateItemDataExcel(rows[0])) {
        alert('올바른 재고건강 SKU 엑셀 파일이 아닙니다.\n(Inventory ID, Option ID, SKU ID, Product name, Option name 헤더가 필요합니다)')
        return
      }

      setUploadProgress(20)
      setUploadStatus('데이터 파싱 중...')

      // STEP 3: 데이터 파싱 (Row 2~)
      const parsedItems = parseItemDataExcel(rows, userId)

      if (parsedItems.length === 0) {
        alert('파싱된 데이터가 없습니다. 엑셀 파일을 확인해주세요.')
        return
      }

      setUploadProgress(40)
      setUploadStatus(`${parsedItems.length}건 저장 중...`)

      // STEP 4: Supabase 저장 (delete → batch insert)
      const { success, errors } = await saveRgItemData(parsedItems, userId)

      // STEP 5: 저장 완료 후 itemDataMap 즉시 갱신 (새로고침 불필요)
      const freshData = await fetchRgItemData(userId)
      const dataMap = new Map<string, RgItemData>()
      for (const d of freshData) {
        if (d.option_id != null) dataMap.set(String(d.option_id), d)
      }
      setItemDataMap(dataMap)
      console.log(`[엑셀 업로드] itemDataMap 갱신: ${dataMap.size}건`)

      setUploadProgress(100)
      setUploadStatus('완료!')

      alert(`엑셀 업로드 완료!\n성공: ${success.toLocaleString()}건, 실패: ${errors.toLocaleString()}건`)
    } catch (err: any) {
      console.error('[엑셀 업로드] 실패:', err)
      alert(`엑셀 업로드 중 오류가 발생했습니다.\n${err.message || ''}`)
    } finally {
      // 파일 input 초기화 (동일 파일 재업로드 허용)
      if (fileInputRef.current) fileInputRef.current.value = ''

      setTimeout(() => {
        setIsUploading(false)
        setUploadProgress(0)
        setUploadStatus('')
      }, 1500)
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 인라인 편집 (입력 열) — 로컬 전용, [저장] 버튼으로 일괄 저장
  // ══════════════════════════════════════════════════════════════

  /* ── 입력 셀 클릭 → 편집 모드 진입 ──────────────────────────── */
  const handleInputClick = (itemId: string, currentValue: number | null) => {
    setEditingInputId(itemId)
    setEditingInputValue(currentValue != null ? String(currentValue) : '')
  }

  /* ── 입력 셀 blur → 로컬 상태만 업데이트 (DB 호출 없음) ──────── */
  const handleInputBlur = (itemId: string, originalValue: number | null) => {
    setEditingInputId(null)

    const trimmed = editingInputValue.trim()
    const newValue = trimmed === '' ? null : Number(trimmed)

    if (newValue === originalValue) return

    // 로컬 상태 즉시 반영
    setItems(prev =>
      prev.map(item =>
        item.id === itemId ? { ...item, input: newValue } : item,
      ),
    )

    // 변경 추적 (일괄 저장용)
    setPendingInputs(prev => {
      const next = new Map(prev)
      next.set(itemId, newValue)
      return next
    })
  }

  /* ── [저장] 버튼 → pendingInputs 일괄 DB 저장 ─────────────── */
  const handleSaveInputs = async () => {
    if (pendingInputs.size === 0) return

    setSaving(true)
    try {
      const entries = Array.from(pendingInputs.entries())
      // 병렬 업데이트 (최대 50개씩 배치)
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
      console.log(`[저장] ${entries.length}건 저장 완료`)
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

  /* ── 상품정보 셀 클릭 → 상세 패널 열기 ─────────────────────── */
  const handleProductClick = (item: RgItem) => {
    setDetailItem(item)
    setDetailPanelOpen(true)
  }

  // ══════════════════════════════════════════════════════════════
  // 검색 & 선택
  // ══════════════════════════════════════════════════════════════

  /* ── 검색 핸들러 ─────────────────────────────────────────── */
  // 숫자 → seller_product_id / seller_product_item_id / vendor_item_id 매칭
  // 문자 → item_name / barcode 부분 일치 (대소문자 무시)
  const handleSearch = () => {
    setSearchQuery(searchValue.trim())
    setCurrentPage(1)
  }

  const handleSearchClear = () => {
    setSearchValue('')
    setSearchQuery('')
    setCurrentPage(1)
  }

  /* ── 전체 선택 / 해제 ──────────────────────────────────────── */
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(pageItems.map((_, i) => String(startIdx + i))))
    } else {
      setSelectedIds(new Set())
    }
  }

  /* ── 개별 선택 ─────────────────────────────────────────────── */
  const handleSelectRow = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      checked ? next.add(id) : next.delete(id)
      return next
    })
  }

  // ══════════════════════════════════════════════════════════════
  // 페이지네이션
  // ══════════════════════════════════════════════════════════════

  /* ── 페이지 변경 핸들러 ────────────────────────────────────── */
  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages) return
    setCurrentPage(page)
  }

  /* ── 페이지 번호 배열 생성 ─────────────────────────────────── */
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

  /** vendor_item_id로 JOIN된 재고건강 데이터 조회 (O(1)) */
  const getItemData = (item: RgItem): RgItemData | undefined =>
    item.vendor_item_id ? itemDataMap.get(item.vendor_item_id) : undefined

  /** 아이템위너 아님 여부 판별 */
  const isNotItemWinner = (item: RgItem): boolean => {
    const data = getItemData(item)
    return data?.item_winner === '아이템위너 아님'
  }

  /** 각 컬럼 키에 따른 셀 콘텐츠 렌더링 */
  const renderCell = (col: Column, item: RgItem) => {
    // JOIN된 재고건강 데이터 (option_id ↔ vendor_item_id)
    const data = getItemData(item)

    switch (col.key) {
      /* ── 상품정보 열: 빨간점(아이템위너 아님) + 상품명 + 옵션명 */
      case 'product':
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {isNotItemWinner(item) && (
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  backgroundColor: '#EF4444',
                  flexShrink: 0,
                }}
                title="아이템위너 아님"
              />
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {item.seller_product_name || '-'}
              {item.item_name ? `, ${item.item_name}` : ''}
            </span>
          </span>
        )

      /* ── 입력 열: 인라인 편집 (숫자만) ──────────────────────── */
      case 'input':
        if (editingInputId === item.id) {
          return (
            <input
              className="purchase-input-cell"
              type="text"
              inputMode="numeric"
              autoFocus
              value={editingInputValue}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                if (e.target.value === '' || /^\d+$/.test(e.target.value)) {
                  setEditingInputValue(e.target.value)
                }
              }}
              onBlur={() => handleInputBlur(item.id!, item.input)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleInputBlur(item.id!, item.input)
                  const currentIdx = pageItems.findIndex(pi => pi.id === item.id)
                  const nextItem = pageItems[currentIdx + 1]
                  if (nextItem?.id) {
                    handleInputClick(nextItem.id, nextItem.input)
                  }
                }
              }}
            />
          )
        }
        return (
          <span>{item.input != null ? item.input : ''}</span>
        )

      /* ── JOIN 컬럼: si_rg_item_data 필드 매핑 (0/빈값 비표시) ── */
      case 'c_in':
        return data?.pending_inbounds ? data.pending_inbounds.toLocaleString() : ''
      case 'c_stock':
        return data?.orderable_qty ? data.orderable_qty.toLocaleString() : ''
      case 'd7':
        return data?.recent_sales_qty_7d ? data.recent_sales_qty_7d.toLocaleString() : ''
      case 'd30':
        return data?.recent_sales_qty_30d ? data.recent_sales_qty_30d.toLocaleString() : ''
      case 'recommend':
        return data?.recommended_inbound_qty ? data.recommended_inbound_qty.toLocaleString() : ''
      case 'storage': {
        const fee = data?.monthly_storage_fee
        if (!fee) return ''
        return <span style={{ color: '#EF4444' }}>{fee.toLocaleString()}</span>
      }

      /* ── 가격 열: 숫자 포맷 ────────────────────────────────── */
      case 'price':
        return item.sale_price ? item.sale_price.toLocaleString() : ''

      /* ── 기타 열: 빈값 ─────────────────────────────────────── */
      default:
        return ''
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 렌더링
  // ══════════════════════════════════════════════════════════════
  return (
    <div className="purchase-container">

      {/* ── 상단 우측 버튼 영역 ──────────────────────────────── */}
      <div className="purchase-top-actions">
        <label className="purchase-btn" style={{ cursor: 'pointer' }}>
          엑셀 업로드
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={handleExcelUpload}
          />
        </label>
        <button
          className="purchase-btn"
          onClick={handleUpdate}
          disabled={updating}
        >
          {updating ? (updateProgress || '업데이트 중...') : '업데이트'}
        </button>
      </div>

      {/* ── 타이틀 헤더 ──────────────────────────────────────── */}
      <div className="purchase-header">
        <h1 className="purchase-title">사입관리</h1>
      </div>

      {/* ── 검색 입력폼 (타원형, 가운데 상단) ────────────────── */}
      <div className="purchase-search-bar">
        <input
          className="purchase-search-input"
          type="text"
          placeholder="상품명, 바코드 또는 ID로 검색"
          value={searchValue}
          onChange={(e) => {
            setSearchValue(e.target.value)
            if (e.target.value === '') handleSearchClear()
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
        />
      </div>

      {/* ── 필터 툴바 (좌: 필터 버튼, 우: 저장 버튼) ─────────── */}
      <div className="purchase-table-toolbar">
        <div className="purchase-toolbar-left">
          <button
            className={`purchase-filter-btn${activeFilter === 'sales' ? ' active' : ''}`}
            onClick={() => handleFilterToggle('sales')}
          >
            판매량
          </button>
          <button
            className={`purchase-filter-btn${activeFilter === 'storage' ? ' active' : ''}`}
            onClick={() => handleFilterToggle('storage')}
          >
            반출비
          </button>
          {activeFilter && (
            <span className="purchase-filter-count">
              {filteredCount.toLocaleString()}건
            </span>
          )}
        </div>
        <button
          className="purchase-btn purchase-save-btn"
          onClick={handleSaveInputs}
          disabled={saving || pendingInputs.size === 0}
        >
          {saving ? '저장 중...' : `저장${pendingInputs.size > 0 ? ` (${pendingInputs.size})` : ''}`}
        </button>
      </div>

      {/* ── 테이블 섹션 (화면 가득) ──────────────────────────── */}
      <div className="purchase-table-section">
        {loading ? (
          <div className="purchase-loading">데이터를 불러오는 중...</div>
        ) : (
          <>
            <div className="purchase-table-wrapper">
              <table className="purchase-table">
                {/* ── colgroup: 열 너비 정의 ────────────────── */}
                <colgroup>
                  <col style={{ width: '30px' }} />
                  {COLUMNS.map((c) => (
                    <col key={c.key} style={{ width: c.width }} />
                  ))}
                </colgroup>

                {/* ── thead ─────────────────────────────────── */}
                <thead>
                  <tr>
                    <th className="col-checkbox">
                      <input
                        type="checkbox"
                        className="purchase-checkbox"
                        checked={pageItems.length > 0 && selectedIds.size === pageItems.length}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                      />
                    </th>
                    {COLUMNS.map((c) => (
                      <th
                        key={c.key}
                        className={
                          c.isProduct ? 'col-product' :
                          c.isInput ? 'col-input' : ''
                        }
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>

                {/* ── tbody ─────────────────────────────────── */}
                <tbody>
                  {pageItems.length === 0 ? (
                    <tr>
                      <td
                        colSpan={COLUMNS.length + 1}
                        className="purchase-table-empty"
                      >
                        데이터가 없습니다
                      </td>
                    </tr>
                  ) : (
                    pageItems.map((item, idx) => {
                      const rowId = String(startIdx + idx)
                      return (
                        <tr key={item.id ?? `${item.seller_product_id}-${item.seller_product_item_id}-${idx}`}>
                          <td>
                            <input
                              type="checkbox"
                              className="purchase-checkbox"
                              checked={selectedIds.has(rowId)}
                              onChange={(e) => handleSelectRow(rowId, e.target.checked)}
                            />
                          </td>
                          {COLUMNS.map((c) => (
                            <td
                              key={c.key}
                              className={
                                c.isProduct ? 'col-product' :
                                c.isInput ? 'col-input' : ''
                              }
                              onClick={
                                c.isProduct
                                  ? () => handleProductClick(item)
                                  : c.isInput && editingInputId !== item.id
                                    ? () => handleInputClick(item.id!, item.input)
                                    : undefined
                              }
                              style={c.isProduct || c.isInput ? { cursor: 'pointer' } : undefined}
                            >
                              {renderCell(c, item)}
                            </td>
                          ))}
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* ── 페이지네이션 (가운데 정렬) ─────────────────── */}
            <div className="purchase-pagination">
              <div className="purchase-pagination-controls">
                <button
                  className="purchase-pagination-btn"
                  disabled={currentPage === 1}
                  onClick={() => handlePageChange(currentPage - 1)}
                >
                  이전
                </button>

                {getPageNumbers().map((p, i) =>
                  typeof p === 'string' ? (
                    <span key={`e-${i}`} className="purchase-pagination-ellipsis">{p}</span>
                  ) : (
                    <button
                      key={p}
                      className={`purchase-pagination-btn${currentPage === p ? ' active' : ''}`}
                      onClick={() => handlePageChange(p)}
                    >
                      {p}
                    </button>
                  )
                )}

                <button
                  className="purchase-pagination-btn"
                  disabled={currentPage === totalPages}
                  onClick={() => handlePageChange(currentPage + 1)}
                >
                  다음
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      {/* ── 상품 상세 슬라이드 패널 ──────────────────────────── */}
      <ProductDetailPanel
        isOpen={detailPanelOpen}
        onClose={() => setDetailPanelOpen(false)}
        item={detailItem}
        itemWinner={detailItem ? getItemData(detailItem)?.item_winner : undefined}
      />

      {/* ── 엑셀 업로드 프로그레스 모달 ───────────────────────── */}
      <UploadProgressModal
        isOpen={isUploading}
        progress={uploadProgress}
        status={uploadStatus}
        title="재고건강 SKU 엑셀 업로드 중"
      />
    </div>
  )
}

export default PurchaseManagement
