import React, { useState, useEffect } from 'react'
import './PurchaseManagement.css'
import {
  fetchAllRgProducts,
  fetchDetailsAndMap,
  fetchRgItems,
  saveRgItems,
} from '../services/purchaseService'
import type { RgItem } from '../types/purchase'

/* ================================================================
   사입관리 (PurchaseManagement)
   - 상단: 타이틀(가운데) + 업데이트 버튼(오른쪽)
   - 검색폼: 타원형 검색바 (보드 없음)
   - 테이블: 화면 가득 채움, 컬럼 타이트
   - 데이터: 쿠팡 로켓그로스 API → Supabase si_rg_items
   ================================================================ */

// ── 상수 ──────────────────────────────────────────────────────
const PAGE_SIZE = 100

// ── 컬럼 정의 ─────────────────────────────────────────────────
interface Column {
  key: string
  label: string
  width: string       // CSS width (colgroup)
  isProduct?: boolean // 상품정보 컬럼 여부 (좌측 정렬)
}

const COLUMNS: Column[] = [
  { key: 'product',  label: '상품정보', width: '220px', isProduct: true },
  { key: 'input',    label: '입력',     width: '52px' },
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

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  /* ── 현재 페이지에 표시할 아이템 ─────────────────────────────── */
  const startIdx = (currentPage - 1) * PAGE_SIZE
  const pageItems = items.slice(startIdx, startIdx + PAGE_SIZE)

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

      // STEP 2: 병렬 배치 상세 조회 (동시 3건) → DB 행 변환
      setUpdateProgress(`상세 조회 중... (0/${products.length})`)
      const allRgItems = await fetchDetailsAndMap(products, userId, (done, total) => {
        setUpdateProgress(`상세 조회 중... (${done}/${total})`)
      })

      // STEP 3: Supabase에 저장 (500건 배치)
      setUpdateProgress(`저장 중... (${allRgItems.length}건)`)
      const { success, errors } = await saveRgItems(allRgItems, userId)

      // STEP 4: 테이블 새로고침
      setUpdateProgress('새로고침...')
      const refreshed = await fetchRgItems(userId)
      setItems(refreshed)
      setTotalCount(refreshed.length)
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

  // ════════════════════════════════════════════════════════════
  // 렌더링
  // ════════════════════════════════════════════════════════════
  return (
    <div className="purchase-container">

      {/* ── 상단 헤더: 타이틀(가운데) + 버튼(오른쪽) ──────────── */}
      <div className="purchase-header">
        <h1 className="purchase-title">사입관리</h1>
        <div className="purchase-header-actions">
          <label className="purchase-btn" style={{ cursor: 'pointer' }}>
            엑셀 업로드
            <input
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={() => { /* TODO: 엑셀 업로드 핸들러 */ }}
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
                  <col style={{ width: '34px' }} /> {/* 체크박스 */}
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
                      <th key={c.key} className={c.isProduct ? 'col-product' : ''}>
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
                        <tr key={item.seller_product_item_id || rowId}>
                          <td>
                            <input
                              type="checkbox"
                              className="purchase-checkbox"
                              checked={selectedIds.has(rowId)}
                              onChange={(e) => handleSelectRow(rowId, e.target.checked)}
                            />
                          </td>
                          {COLUMNS.map((c) => (
                            <td key={c.key} className={c.isProduct ? 'col-product' : ''}>
                              {/* ── 상품정보 열: 상품명, 옵션명 (한줄) ──────── */}
                              {c.key === 'product' ? (
                                <span>
                                  {item.seller_product_name || '-'}
                                  {item.item_name ? `, ${item.item_name}` : ''}
                                </span>
                              ) : c.key === 'price' ? (
                                item.sale_price ? item.sale_price.toLocaleString() : '-'
                              ) : (
                                '-'
                              )}
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
    </div>
  )
}

export default PurchaseManagement
