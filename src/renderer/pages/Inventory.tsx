import React, { useState, useEffect, useCallback, useRef } from 'react'
import Button from '../components/common/Button'
import SearchForm from '../components/inventory/SearchForm'
import InventoryTable from '../components/inventory/InventoryTable'
import { StockService } from '../services/stockService'
import { parseStockExcelFile, exportStocksToExcel } from '../services/stockExcelService'
import type { Stock, StockSearchFilters } from '../types/stock'
import type { ExcelStockRow } from '../services/stockExcelService'

const Inventory: React.FC = () => {
  const [stocks, setStocks] = useState<Stock[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // ── 엑셀 업로드 ref (+ 추가용 / - 차감용 분리) ─────────────────────
  const fileInputRef      = useRef<HTMLInputElement>(null)  // ⬆️ 엑셀 + (수량 합산)
  const fileDeductRef     = useRef<HTMLInputElement>(null)  // ⬆️ 엑셀 - (수량 차감)

  // ── 차감 불가 오류 모달 상태 ─────────────────────────────────────
  const [isDeductErrorOpen, setIsDeductErrorOpen] = useState(false)
  const [deductErrors, setDeductErrors] = useState<{
    notFound:    { location: string | null; barcode: string }[]               // 오류사유 1: 미존재
    insufficient: { location: string | null; barcode: string; currentQty: number; requestedQty: number }[]  // 오류사유 2: 수량 부족
  } | null>(null)

  // 재고 데이터 로드
  const loadStocks = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await StockService.getAllStocks()
      setStocks(data)
    } catch (error) {
      console.error('재고 로드 실패:', error)
      setError('재고 데이터를 불러오는데 실패했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // 검색 처리 함수
  const handleSearch = useCallback(async (filters: StockSearchFilters) => {
    setIsLoading(true)
    setError(null)
    try {
      // 모든 필터가 비어있으면 전체 데이터 표시
      const isEmptyFilters = !filters.searchKeyword &&
                            !filters.location &&
                            !filters.season &&
                            !filters.note

      if (isEmptyFilters) {
        const data = await StockService.getAllStocks()
        setStocks(data)
      } else {
        const data = await StockService.getFilteredStocks(filters)
        setStocks(data)
      }
    } catch (error) {
      console.error('검색 실패:', error)
      setError('검색 중 오류가 발생했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // 엑셀 업로드 버튼 클릭
  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  // 엑셀 파일 선택 시 처리
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 파일 확장자 확인
    const fileName = file.name.toLowerCase()
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
      alert('엑셀 파일(.xlsx, .xls)만 업로드 가능합니다.')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // 1. 엑셀 파일 파싱
      const excelRows = await parseStockExcelFile(file)

      if (!excelRows || excelRows.length === 0) {
        alert('엑셀 파일에 데이터가 없습니다.')
        return
      }

      // 2. user ID (UUID) 가져오기
      const userStr = localStorage.getItem('user')
      const user = userStr ? JSON.parse(userStr) : null
      const userId = user?.id

      if (!userId) {
        alert('사용자 ID를 찾을 수 없습니다. 다시 로그인해주세요.')
        return
      }

      // 3. 모든 바코드 추출 (중복 제거)
      const allBarcodes = Array.from(new Set(excelRows.map(row => row.barcode)))

      // 4. 바코드 매칭 데이터 가져오기
      const barcodeMap = await StockService.getCoupangItemsByBarcodes(allBarcodes)

      // 5. 각 행 처리
      let createdCount = 0
      let updatedCount = 0
      const errors: string[] = []

      for (const row of excelRows) {
        try {
          // 기존 재고 확인
          const existingStock = await StockService.getStockByLocationAndBarcode(
            row.location,
            row.barcode,
            userId
          )

          if (existingStock) {
            // 기존 재고 있음 -> 수량만 업데이트
            await StockService.updateStockQty(existingStock.id, row.qty || 0)
            updatedCount++
          } else {
            // 신규 재고 생성
            const matchedItem = barcodeMap.get(row.barcode)

            const newStock: Omit<Stock, 'id'> = {
              location: row.location,
              barcode: row.barcode,
              item_name: matchedItem?.item_name || row.item_name,
              option_name: matchedItem?.option_name || row.option_name,
              qty: row.qty,
              season: null,
              note: null,
              user_id: userId
            }

            await StockService.createStock(newStock)
            createdCount++
          }
        } catch (err) {
          console.error('행 처리 실패:', row, err)
          errors.push(`바코드 ${row.barcode} 처리 실패`)
        }
      }

      // 6. 결과 메시지
      let message = `업로드 완료!\n신규 생성: ${createdCount}개\n수량 업데이트: ${updatedCount}개`
      if (errors.length > 0) {
        message += `\n실패: ${errors.length}개`
      }
      alert(message)

      // 7. 데이터 새로고침
      await loadStocks()

    } catch (error) {
      console.error('엑셀 업로드 실패:', error)
      alert('엑셀 업로드 중 오류가 발생했습니다.')
    } finally {
      setIsLoading(false)
      // 파일 입력 초기화
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }, [loadStocks])

  // ── 엑셀 차감 업로드 핸들러 ──────────────────────────────────────

  /**
   * ⬆️ 엑셀 - : 엑셀 파일로 si_stocks 수량 차감
   *
   * 엑셀 포맷 (기존 업로드와 동일):
   *   A열: location (로케이션)
   *   B열: barcode  (바코드, 필수)
   *   C열: item_name
   *   D열: option_name
   *   E열: qty (차감할 수량)
   *
   * 처리 원칙 — 에러가 하나라도 있으면 전체 처리 중단:
   *   STEP 1. 전체 행 사전 검증
   *     - 오류사유 1: (location + barcode) 행이 DB에 없는 경우
   *     - 오류사유 2: 현재 qty < 차감 qty 인 경우
   *   STEP 2. 오류 있으면 → 모달 표시 후 종료 (DB 미수정)
   *   STEP 3. 오류 없으면 → 전체 행 차감 처리 (qty = current - deduct)
   */
  const handleDeductFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (fileDeductRef.current) fileDeductRef.current.value = ''  // 재업로드 허용
    if (!file) return

    // 파일 확장자 확인
    const fileName = file.name.toLowerCase()
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
      alert('엑셀 파일(.xlsx, .xls)만 업로드 가능합니다.')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // ── 1. 엑셀 파싱 ───────────────────────────────────────────────
      const excelRows = await parseStockExcelFile(file)
      if (!excelRows || excelRows.length === 0) {
        alert('엑셀 파일에 데이터가 없습니다.')
        return
      }

      // ── 2. 사용자 ID 획득 ──────────────────────────────────────────
      const userStr = localStorage.getItem('user')
      const user    = userStr ? JSON.parse(userStr) : null
      const userId  = user?.id
      if (!userId) {
        alert('사용자 ID를 찾을 수 없습니다. 다시 로그인해주세요.')
        return
      }

      // ── STEP 1: 전체 행 사전 검증 (DB 수정 없음) ───────────────────
      const notFound:     { location: string | null; barcode: string }[] = []
      const insufficient: { location: string | null; barcode: string; currentQty: number; requestedQty: number }[] = []

      // 검증 통과한 행만 별도 보관 (2회 DB 조회 방지)
      type ValidRow = { stockId: string; newQty: number; location: string | null; barcode: string }
      const validRows: ValidRow[] = []

      for (const row of excelRows) {
        const deductQty = row.qty ?? 0

        // 오류사유 1: (location + barcode) DB 미존재
        const existing = await StockService.getStockByLocationAndBarcode(
          row.location, row.barcode, userId
        )
        if (!existing) {
          notFound.push({ location: row.location, barcode: row.barcode })
          continue
        }

        // 오류사유 2: 현재 qty < 차감 qty
        const currentQty = existing.qty ?? 0
        if (currentQty < deductQty) {
          insufficient.push({
            location: row.location, barcode: row.barcode,
            currentQty, requestedQty: deductQty,
          })
          continue
        }

        validRows.push({ stockId: existing.id, newQty: currentQty - deductQty, location: row.location, barcode: row.barcode })
      }

      // ── STEP 2: 오류 있으면 모달 표시 후 중단 ─────────────────────
      if (notFound.length > 0 || insufficient.length > 0) {
        setDeductErrors({ notFound, insufficient })
        setIsDeductErrorOpen(true)
        return
      }

      // ── STEP 3: 전체 오류 없음 → 차감 처리 ───────────────────────
      for (const row of validRows) {
        await StockService.updateStock(row.stockId, { qty: row.newQty })
      }

      alert(`${validRows.length}개 항목 차감 완료`)
      await loadStocks()

    } catch (err) {
      console.error('엑셀 차감 업로드 실패:', err)
      alert('엑셀 차감 중 오류가 발생했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [loadStocks])

  // 엑셀 다운로드
  const handleDownloadExcel = useCallback(async () => {
    try {
      // 선택된 데이터가 있으면 선택된 것만, 없으면 전체 다운로드
      let dataToExport: Stock[] = []

      if (selectedIds.length > 0) {
        dataToExport = stocks.filter(stock => selectedIds.includes(stock.id))
      } else {
        dataToExport = stocks
      }

      if (dataToExport.length === 0) {
        alert('다운로드할 데이터가 없습니다.')
        return
      }

      const fileName = `재고목록_${new Date().toISOString().split('T')[0]}.xlsx`
      const success = await exportStocksToExcel(dataToExport, fileName)

      if (success) {
        alert(`${dataToExport.length}개의 데이터가 다운로드되었습니다.`)
      } else {
        alert('다운로드 중 오류가 발생했습니다.')
      }
    } catch (error) {
      console.error('엑셀 다운로드 실패:', error)
      alert('엑셀 다운로드 중 오류가 발생했습니다.')
    }
  }, [stocks, selectedIds])

  // 선택된 항목 삭제
  const handleDeleteSelected = useCallback(async () => {
    if (!selectedIds.length) {
      alert('삭제할 항목을 선택해주세요.')
      return
    }

    if (!window.confirm(`선택한 ${selectedIds.length}개의 항목을 삭제하시겠습니까?`)) {
      return
    }

    setIsLoading(true)
    try {
      const success = await StockService.deleteMultipleStocks(selectedIds)
      if (success) {
        alert('선택한 항목이 삭제되었습니다.')
        setSelectedIds([]) // 선택 초기화
        await loadStocks() // 데이터 새로고침
      } else {
        alert('삭제 중 오류가 발생했습니다.')
      }
    } catch (error) {
      console.error('삭제 실패:', error)
      alert('삭제 중 오류가 발생했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [selectedIds, loadStocks])

  // 컴포넌트 마운트시 데이터 로드
  useEffect(() => {
    loadStocks()
  }, [loadStocks])

  return (
    <div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <h1 style={{ fontSize: '28px', color: '#333', margin: 0 }}>
          재고관리
        </h1>
        <div style={{ display: 'flex', gap: '10px' }}>
          {/* 숨겨진 파일 입력 — ⬆️ 엑셀 + (수량 합산) */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          {/* 숨겨진 파일 입력 — ⬆️ 엑셀 - (수량 차감) */}
          <input
            ref={fileDeductRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={handleDeductFileChange}
          />

          {/* 엑셀 수량 합산 업로드 버튼 */}
          <Button
            variant="secondary"
            onClick={handleUploadClick}
            disabled={isLoading}
          >
            ⬆️ 엑셀 +
          </Button>

          {/* 엑셀 수량 차감 업로드 버튼 */}
          <Button
            variant="secondary"
            onClick={() => fileDeductRef.current?.click()}
            disabled={isLoading}
          >
            ⬆️ 엑셀 -
          </Button>

          {/* 엑셀 다운로드 버튼 */}
          <Button
            variant="secondary"
            onClick={handleDownloadExcel}
            disabled={isLoading}
          >
            ⬇️ 엑셀
          </Button>

          {/* 삭제 버튼 */}
          <Button
            variant="danger"
            onClick={handleDeleteSelected}
            disabled={isLoading}
          >
            삭제
          </Button>
        </div>
      </div>

      {/* 에러 메시지 */}
      {error && (
        <div style={{
          padding: '10px',
          marginBottom: '20px',
          backgroundColor: '#f8d7da',
          color: '#721c24',
          border: '1px solid #f5c6cb',
          borderRadius: '4px'
        }}>
          {error}
        </div>
      )}

      {/* 검색 폼 */}
      <SearchForm onSearch={handleSearch} />

      {/* 재고 테이블 */}
      <InventoryTable
        data={stocks}
        loading={isLoading}
        onSelectionChange={setSelectedIds}
      />

      {/*
        ── 엑셀 차감 오류 모달 ────────────────────────────────────────
        - 오류사유 1: (location + barcode) DB 미존재
        - 오류사유 2: 현재 재고 < 차감 수량
        - 오류가 하나라도 있으면 전체 처리 중단 후 이 모달 표시
      */}
      {isDeductErrorOpen && deductErrors && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999,
        }}>
          <div style={{
            background: 'white', borderRadius: '10px',
            padding: '28px 32px', minWidth: '480px', maxWidth: '640px',
            maxHeight: '80vh', overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          }}>
            {/* 헤더 */}
            <h3 style={{ margin: '0 0 6px', fontSize: '16px', color: '#111827' }}>
              엑셀 차감 오류
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#6b7280' }}>
              <span style={{ color: '#dc2626', fontWeight: 700 }}>모든 처리를 거부</span>하였습니다. 오류 사유를 확인 후 재요청해주세요.
            </p>

            {/* 오류사유 1: 로케이션-바코드 미존재 */}
            {deductErrors.notFound.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#dc2626', marginBottom: '8px' }}>
                  오류사유 1 &nbsp;·&nbsp; 로케이션 - 바코드가 존재하지 않습니다&nbsp;
                  <span style={{ fontWeight: 400, color: '#6b7280' }}>
                    ({deductErrors.notFound.length}건)
                  </span>
                </div>
                <div style={{
                  background: '#fef2f2', borderRadius: '6px',
                  padding: '10px 14px', maxHeight: '160px', overflowY: 'auto',
                }}>
                  {/* 컬럼 헤더 */}
                  <div style={{
                    display: 'flex', gap: '8px', fontSize: '12px',
                    color: '#9ca3af', paddingBottom: '6px',
                    borderBottom: '1px solid #fecaca', marginBottom: '4px',
                  }}>
                    <span style={{ width: '140px' }}>로케이션</span>
                    <span style={{ flex: 1 }}>바코드</span>
                  </div>
                  {deductErrors.notFound.map((r, i) => (
                    <div key={i} style={{
                      display: 'flex', gap: '8px', fontSize: '13px',
                      color: '#374151', padding: '4px 0',
                      borderBottom: i < deductErrors.notFound.length - 1
                        ? '1px solid #fee2e2' : 'none',
                    }}>
                      <span style={{ width: '140px', color: '#6b7280' }}>{r.location || '(없음)'}</span>
                      <span style={{ flex: 1 }}>{r.barcode}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 오류사유 2: 재고 부족 */}
            {deductErrors.insufficient.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#d97706', marginBottom: '8px' }}>
                  오류사유 2 &nbsp;·&nbsp; 재고 수량이 차감 수량보다 적습니다&nbsp;
                  <span style={{ fontWeight: 400, color: '#6b7280' }}>
                    ({deductErrors.insufficient.length}건)
                  </span>
                </div>
                <div style={{
                  background: '#fffbeb', borderRadius: '6px',
                  padding: '10px 14px', maxHeight: '160px', overflowY: 'auto',
                }}>
                  {/* 컬럼 헤더 */}
                  <div style={{
                    display: 'flex', gap: '8px', fontSize: '12px',
                    color: '#9ca3af', paddingBottom: '6px',
                    borderBottom: '1px solid #fde68a', marginBottom: '4px',
                  }}>
                    <span style={{ width: '120px' }}>로케이션</span>
                    <span style={{ flex: 1 }}>바코드</span>
                    <span style={{ width: '60px', textAlign: 'right' }}>현재</span>
                    <span style={{ width: '60px', textAlign: 'right' }}>차감요청</span>
                  </div>
                  {deductErrors.insufficient.map((r, i) => (
                    <div key={i} style={{
                      display: 'flex', gap: '8px', fontSize: '13px',
                      color: '#374151', padding: '4px 0',
                      borderBottom: i < deductErrors.insufficient.length - 1
                        ? '1px solid #fde68a' : 'none',
                    }}>
                      <span style={{ width: '120px', color: '#6b7280' }}>{r.location || '(없음)'}</span>
                      <span style={{ flex: 1 }}>{r.barcode}</span>
                      <span style={{ width: '60px', textAlign: 'right' }}>{r.currentQty}</span>
                      <span style={{ width: '60px', textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>{r.requestedQty}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 닫기 버튼 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setIsDeductErrorOpen(false); setDeductErrors(null) }}
                style={{
                  padding: '8px 24px', border: 'none', borderRadius: '6px',
                  background: '#6366f1', color: 'white',
                  cursor: 'pointer', fontSize: '14px', fontWeight: 500,
                }}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Inventory