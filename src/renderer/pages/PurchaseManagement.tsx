import React, { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import './PurchaseManagement.css'
import {
  fetchAllRgProducts,
  mapListItemToRgItems,
  fetchRgItems,
  saveRgItems,
  validateItemDataExcel,
  parseItemDataExcel,
  saveRgItemData,
} from '../services/purchaseService'
import { supabase } from '../services/supabase'
import type { RgItem } from '../types/purchase'
import ProductDetailPanel from '../components/purchase/ProductDetailPanel'
import UploadProgressModal from '../components/UploadProgressModal'

/* ================================================================
   사입관리 (PurchaseManagement)
   - 상단: 타이틀(가운데) + 업데이트 버튼(오른쪽)
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
  { key: 'product',  label: '상품정보', width: '220px', isProduct: true },
  { key: 'input',    label: '입력',     width: '52px',  isInput: true },
  { key: 'c_in',     label: 'C.in',     width: '52px' },
  { key: 'c_stock',  label: 'C.재고',   width: '56px' },
  { key: 'order',    label: '주문',     width: '52px' },
  { key: 'personal', label: '개인',     width: '52px' },
  { key: 'd7',       label: '7d',       width: '44px' },
  { key: 'd30',      label: '30d',      width: '48px' },
  { key: 'recommend',label: '추천',     width: '52px' },
  { key: 'warehouse',label: '창고',     width: '52px' },
  { key: 'storage',  label: '보관료',   width: '56px' },
  { key: 'v1',       label: 'V1',       width: '44px' },
  { key: 'v2',       label: 'V2',       width: '44px' },
  { key: 'v3',       label: 'V3',       width: '44px' },
  { key: 'v4',       label: 'V4',       width: '44px' },
  { key: 'v5',       label: 'V5',       width: '44px' },
  { key: 'price',    label: 'price',    width: '60px' },
  { key: 'margin',   label: 'margin',   width: '60px' },
  { key: 'note',     label: 'note',     width: '80px' },
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

  /* ── 데이터 & 페이지네이션 상태 ────────────────────────────── */
  const [items, setItems] = useState<RgItem[]>([])
  const [loading, setLoading] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)

  /* ── 업데이트 버튼 로딩 & 진행률 상태 ────────────────────────── */
  const [updating, setUpdating] = useState(false)
  const [updateProgress, setUpdateProgress] = useState('')

  /* ── 체크박스 상태 ─────────────────────────────────────────── */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  /* ── 인라인 편집 상태 (입력 열) ──────────────────────────────── */
  const [editingInputId, setEditingInputId] = useState<string | null>(null)
  const [editingInputValue, setEditingInputValue] = useState('')

  /* ── 상품 상세 패널 상태 ────────────────────────────────────── */
  const [detailPanelOpen, setDetailPanelOpen] = useState(false)
  const [detailItem, setDetailItem] = useState<RgItem | null>(null)

  /* ── 엑셀 업로드 상태 ──────────────────────────────────────── */
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStatus, setUploadStatus] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  /* ── 현재 페이지에 표시할 아이템 ─────────────────────────────── */
  const startIdx = (currentPage - 1) * PAGE_SIZE
  const pageItems = items.slice(startIdx, startIdx + PAGE_SIZE)

  // ══════════════════════════════════════════════════════════════
  // 데이터 로드 & 업데이트
  // ══════════════════════════════════════════════════════════════

  /* ── 페이지 로드 시 si_rg_items 조회 ─────────────────────────── */
  useEffect(() => {
    const loadItems = async () => {
      const userId = getUserId()
      if (!userId) return

      setLoading(true)
      try {
        const data = await fetchRgItems(userId)
        setItems(data)
        setTotalCount(data.length)
      } catch (error) {
        console.error('si_rg_items 로드 실패:', error)
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
      setTotalCount(allRgItems.length)
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
      // STEP 1: 파일 읽기 → XLSX 파싱 (Uint8Array + type:'array'로 ZIP 경고 방지)
      const raw = await file.arrayBuffer()
      const workbook = XLSX.read(new Uint8Array(raw), { type: 'array' })
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
  // 인라인 편집 (입력 열)
  // ══════════════════════════════════════════════════════════════

  /* ── 입력 셀 클릭 → 편집 모드 진입 ──────────────────────────── */
  const handleInputClick = (itemId: string, currentValue: number | null) => {
    setEditingInputId(itemId)
    setEditingInputValue(currentValue != null ? String(currentValue) : '')
  }

  /* ── 입력 셀 blur → 값 저장 ─────────────────────────────────── */
  const handleInputBlur = async (itemId: string, originalValue: number | null) => {
    setEditingInputId(null)

    // 입력값 파싱 (빈 문자열 → null)
    const trimmed = editingInputValue.trim()
    const newValue = trimmed === '' ? null : Number(trimmed)

    // 값 변경 없으면 스킵
    if (newValue === originalValue) return

    // 로컬 상태 즉시 업데이트 (낙관적 UI)
    setItems(prev =>
      prev.map(item =>
        item.id === itemId ? { ...item, input: newValue } : item,
      ),
    )

    // Supabase에 저장
    const { error } = await supabase
      .from('si_rg_items')
      .update({ input: newValue })
      .eq('id', itemId)

    if (error) {
      console.error('입력값 저장 오류:', error)
      // 실패 시 원래 값으로 롤백
      setItems(prev =>
        prev.map(item =>
          item.id === itemId ? { ...item, input: originalValue } : item,
        ),
      )
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

  /* ── 검색 핸들러 (추후 구현) ───────────────────────────────── */
  const handleSearch = () => {
    // TODO: Supabase 쿼리 연결
    console.log('검색:', searchValue)
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

  /** 각 컬럼 키에 따른 셀 콘텐츠 렌더링 */
  const renderCell = (col: Column, item: RgItem) => {
    switch (col.key) {
      /* ── 상품정보 열: 상품명 + 옵션명 ──────────────────────── */
      case 'product':
        return (
          <span>
            {item.seller_product_name || '-'}
            {item.item_name ? `, ${item.item_name}` : ''}
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
              onChange={(e) => {
                // 숫자만 허용 (빈 문자열도 허용)
                if (e.target.value === '' || /^\d+$/.test(e.target.value)) {
                  setEditingInputValue(e.target.value)
                }
              }}
              onBlur={() => handleInputBlur(item.id!, item.input)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  // 현재 행 저장 후 다음 행 입력 셀 활성화
                  handleInputBlur(item.id!, item.input).then(() => {
                    const currentIdx = pageItems.findIndex(pi => pi.id === item.id)
                    const nextItem = pageItems[currentIdx + 1]
                    if (nextItem?.id) {
                      handleInputClick(nextItem.id, nextItem.input)
                    }
                  })
                }
              }}
            />
          )
        }
        return (
          <span>{item.input != null ? item.input : ''}</span>
        )

      /* ── 가격 열: 숫자 포맷 ────────────────────────────────── */
      case 'price':
        return item.sale_price ? item.sale_price.toLocaleString() : '-'

      /* ── 기타 열: 기본값 ───────────────────────────────────── */
      default:
        return '-'
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 렌더링
  // ══════════════════════════════════════════════════════════════
  return (
    <div className="purchase-container">

      {/* ── 상단 헤더: 타이틀(가운데) + 버튼(오른쪽) ──────────── */}
      <div className="purchase-header">
        <h1 className="purchase-title">사입관리</h1>
        <div className="purchase-header-actions">
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
      </div>

      {/* ── 검색 입력폼 (타원형, 가운데 상단) ────────────────── */}
      <div className="purchase-search-bar">
        <input
          className="purchase-search-input"
          type="text"
          placeholder="검색어를 입력하세요"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
        />
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
                  <col style={{ width: '34px' }} />
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

            {/* ── 페이지네이션 ───────────────────────────────── */}
            <div className="purchase-pagination">
              <span className="purchase-pagination-info">
                전체 {totalCount.toLocaleString()}개 중{' '}
                {totalCount > 0 ? ((currentPage - 1) * PAGE_SIZE + 1).toLocaleString() : 0}
                {' - '}
                {Math.min(currentPage * PAGE_SIZE, totalCount).toLocaleString()} 표시
              </span>

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
