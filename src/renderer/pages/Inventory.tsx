import React, { useState, useEffect, useCallback, useRef } from 'react'
import { theme } from '../styles/theme'
import Button from '../components/common/Button'
import SearchForm from '../components/inventory/SearchForm'
import InventoryTable from '../components/inventory/InventoryTable'
import UploadProgressModal from '../components/UploadProgressModal'
import { supabase } from '../services/supabase'
import { StockService } from '../services/stockService'
import { parseStockExcelFile, exportStocksToExcel } from '../services/stockExcelService'
import type { Stock, StockSearchFilters } from '../types/stock'

const Inventory: React.FC = () => {
  const [stocks, setStocks] = useState<Stock[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // ── 엑셀 업로드 ref (+ 추가용 / - 차감용 분리) ─────────────────────
  const fileInputRef      = useRef<HTMLInputElement>(null)  // ⬆️ 엑셀 + (수량 합산)
  const fileDeductRef     = useRef<HTMLInputElement>(null)  // ⬆️ 엑셀 - (수량 차감)

  // ── 엑셀 업로드 진행 상태 ───────────────────────────────────────
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStatus, setUploadStatus] = useState('')

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

    setIsUploading(true)
    setUploadProgress(0)
    setUploadStatus('엑셀 파일 파싱 중...')
    setError(null)

    try {
      // 1. 엑셀 파일 파싱
      const excelRows = await parseStockExcelFile(file)

      if (!excelRows || excelRows.length === 0) {
        alert('엑셀 파일에 데이터가 없습니다.')
        setIsUploading(false)
        return
      }

      setUploadProgress(10)
      setUploadStatus(`${excelRows.length}건 파싱 완료 · 기존 재고 조회 중...`)

      // 2. user ID (UUID) 가져오기
      const userStr = localStorage.getItem('user')
      const user = userStr ? JSON.parse(userStr) : null
      const userId = user?.id

      if (!userId) {
        alert('사용자 ID를 찾을 수 없습니다. 다시 로그인해주세요.')
        setIsUploading(false)
        return
      }

      // 3. 전체 기존 재고를 한번에 조회 (진행률 10~22%)
      const stockLookup = new Map<string, Stock>()
      {
        let from = 0
        const batchSize = 1000
        let hasMore = true
        let batchNum = 0

        while (hasMore) {
          const { data, error: fetchErr } = await supabase
            .from('si_stocks')
            .select('*')
            .eq('user_id', userId)
            .range(from, from + batchSize - 1)

          if (fetchErr) {
            console.error('사용자별 재고 조회 오류:', fetchErr)
            throw fetchErr
          }

          if (data && data.length > 0) {
            for (const stock of data) {
              const key = `${(stock.location ?? '').trim()}|${stock.barcode.trim()}`
              stockLookup.set(key, stock)
            }
            from += batchSize
            batchNum++
            // 10% ~ 22% 사이에서 진행률 표시
            setUploadProgress(Math.min(10 + batchNum * 2, 22))
            setUploadStatus(`기존 재고 조회 중... ${stockLookup.size}건 로드됨`)
            if (data.length < batchSize) hasMore = false
          } else {
            hasMore = false
          }
        }
      }

      setUploadProgress(23)
      setUploadStatus('바코드 매칭 데이터 조회 중...')

      // 4. 바코드 매칭 데이터 가져오기 (진행률 23~35%)
      //    .in() 배치는 200건씩 — 1000건 이상이면 URL 길이 초과로 요청이 멈춤
      const allBarcodes = Array.from(new Set(excelRows.map(row => row.barcode)))
      const barcodeMap = new Map<string, { item_name: string; option_name: string }>()
      {
        const batchSize = 200
        const totalBatches = Math.ceil(allBarcodes.length / batchSize) || 1

        for (let i = 0; i < allBarcodes.length; i += batchSize) {
          const batch = allBarcodes.slice(i, i + batchSize)
          const batchIdx = Math.floor(i / batchSize)

          const { data, error: fetchErr } = await supabase
            .from('si_coupang_items')
            .select('barcode, item_name, option_name')
            .eq('user_id', userId)
            .in('barcode', batch)

          if (fetchErr) {
            console.error('쿠팡 아이템 조회 오류:', fetchErr)
          } else if (data) {
            for (const item of data) {
              if (item.barcode && item.item_name && item.option_name) {
                barcodeMap.set(item.barcode, {
                  item_name: item.item_name,
                  option_name: item.option_name
                })
              }
            }
          }

          const pct = 23 + Math.round(((batchIdx + 1) / totalBatches) * 12)
          setUploadProgress(Math.min(pct, 35))
          setUploadStatus(`바코드 매칭 중... ${barcodeMap.size}/${allBarcodes.length}건`)
        }
      }

      setUploadProgress(36)
      setUploadStatus('신규/업데이트 분류 중...')

      // 5. 메모리에서 신규/업데이트 분리
      // 신규 항목은 Map으로 관리하여 동일 키 중복 행의 수량을 합산
      const newStocksMap = new Map<string, Omit<Stock, 'id'>>()
      const qtyUpdates: { id: string; qty: number }[] = []

      for (const row of excelRows) {
        const locTrimmed = (row.location ?? '').trim()
        const barTrimmed = row.barcode.trim()
        const key = `${locTrimmed}|${barTrimmed}`
        const existing = stockLookup.get(key)

        if (existing) {
          // 기존 재고 → 수량 합산
          const addQty = row.qty ?? 0
          const newQty = (existing.qty ?? 0) + addQty
          // 동일 키에 대한 중복 행 → 누적 합산
          const prevUpdate = qtyUpdates.find(u => u.id === existing.id)
          if (prevUpdate) {
            prevUpdate.qty = prevUpdate.qty + addQty
          } else {
            qtyUpdates.push({ id: existing.id, qty: newQty })
          }
          existing.qty = newQty
        } else {
          // 신규 항목 — 동일 키가 엑셀에 여러 번 있으면 수량 합산
          const existingNew = newStocksMap.get(key)
          if (existingNew) {
            existingNew.qty = (existingNew.qty ?? 0) + (row.qty ?? 0)
          } else {
            const matchedItem = barcodeMap.get(barTrimmed)
            newStocksMap.set(key, {
              location: locTrimmed || null,
              barcode: barTrimmed,
              item_name: matchedItem?.item_name || row.item_name,
              option_name: matchedItem?.option_name || row.option_name,
              qty: row.qty ?? 0,
              season: null,
              note: null,
              user_id: userId
            })
          }
        }
      }

      const newStocks = Array.from(newStocksMap.values())
      const totalWork = newStocks.length + qtyUpdates.length

      if (totalWork === 0) {
        setUploadProgress(100)
        setUploadStatus('변경할 데이터가 없습니다.')
        setTimeout(() => { setIsUploading(false); setUploadProgress(0); setUploadStatus('') }, 2000)
        return
      }

      setUploadProgress(40)
      setUploadStatus(`신규 ${newStocks.length}건 · 업데이트 ${qtyUpdates.length}건 처리 시작...`)

      // 6. 배치로 일괄 처리 (진행 상황 추적)
      let processed = 0
      let createdCount = 0
      let createdErrors = 0
      let updatedCount = 0
      let updatedErrors = 0

      // 6-1. 신규 삽입 (500건 배치)
      const createBatchSize = 500
      for (let i = 0; i < newStocks.length; i += createBatchSize) {
        const batch = newStocks.slice(i, i + createBatchSize)
        const { error } = await supabase.from('si_stocks').insert(batch)

        if (error) {
          console.error(`재고 일괄 삽입 오류:`, error)
          createdErrors += batch.length
        } else {
          createdCount += batch.length
        }

        processed += batch.length
        const pct = 40 + Math.round((processed / totalWork) * 50)
        setUploadProgress(pct)
        setUploadStatus(`처리 중... ${processed} / ${totalWork} (신규: ${createdCount}, 업데이트: ${updatedCount})`)
      }

      // 6-2. 수량 업데이트 (500건 병렬 배치)
      const updateBatchSize = 500
      for (let i = 0; i < qtyUpdates.length; i += updateBatchSize) {
        const batch = qtyUpdates.slice(i, i + updateBatchSize)
        const results = await Promise.all(
          batch.map(({ id, qty }) =>
            supabase.from('si_stocks').update({ qty }).eq('id', id)
          )
        )

        for (const { error } of results) {
          if (error) {
            updatedErrors++
          } else {
            updatedCount++
          }
        }

        processed += batch.length
        const pct = 40 + Math.round((processed / totalWork) * 50)
        setUploadProgress(pct)
        setUploadStatus(`처리 중... ${processed} / ${totalWork} (신규: ${createdCount}, 업데이트: ${updatedCount})`)
      }

      // 7. 완료
      setUploadProgress(95)
      setUploadStatus('데이터 새로고침 중...')
      await loadStocks()

      const totalErrors = createdErrors + updatedErrors
      setUploadProgress(100)
      let doneMsg = `업로드 완료! 신규: ${createdCount}건, 업데이트: ${updatedCount}건`
      if (totalErrors > 0) doneMsg += `, 실패: ${totalErrors}건`
      setUploadStatus(doneMsg)

      setTimeout(() => {
        setIsUploading(false)
        setUploadProgress(0)
        setUploadStatus('')
      }, 2000)
      return  // finally에서 isUploading을 닫지 않도록

    } catch (error) {
      console.error('엑셀 업로드 실패:', error)
      setUploadStatus('업로드 실패: ' + (error instanceof Error ? error.message : '알 수 없는 오류'))
      setTimeout(() => {
        setIsUploading(false)
        setUploadProgress(0)
        setUploadStatus('')
      }, 3000)
    } finally {
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

      // ── STEP 1: 전체 재고를 한번에 조회 후 메모리에서 검증 ─────────
      const existingStocks = await StockService.getAllStocksByUser(userId)
      const stockLookup = new Map<string, Stock>()
      for (const stock of existingStocks) {
        const key = `${(stock.location ?? '').trim()}|${stock.barcode.trim()}`
        stockLookup.set(key, stock)
      }

      const notFound:     { location: string | null; barcode: string }[] = []
      const insufficient: { location: string | null; barcode: string; currentQty: number; requestedQty: number }[] = []

      // 동일 키 중복 행 → 최종 qty만 업데이트하도록 Map 사용
      const deductMap = new Map<string, { stockId: string; newQty: number }>()

      for (const row of excelRows) {
        const deductQty = row.qty ?? 0
        const key = `${(row.location ?? '').trim()}|${row.barcode.trim()}`
        const existing = stockLookup.get(key)

        if (!existing) {
          notFound.push({ location: row.location, barcode: row.barcode })
          continue
        }

        const currentQty = existing.qty ?? 0
        if (currentQty < deductQty) {
          insufficient.push({
            location: row.location, barcode: row.barcode,
            currentQty, requestedQty: deductQty,
          })
          continue
        }

        const newQty = currentQty - deductQty
        // 동일 키 중복 행 → 누적 차감 (lookup 갱신하여 다음 행에도 반영)
        existing.qty = newQty
        deductMap.set(existing.id, { stockId: existing.id, newQty })
      }

      // ── STEP 2: 오류 있으면 모달 표시 후 중단 ─────────────────────
      if (notFound.length > 0 || insufficient.length > 0) {
        setDeductErrors({ notFound, insufficient })
        setIsDeductErrorOpen(true)
        return
      }

      // ── STEP 3: 전체 오류 없음 → 배치 차감 처리 ──────────────────
      const updates = Array.from(deductMap.values()).map(row => ({ id: row.stockId, qty: row.newQty }))
      await StockService.batchUpdateStockQtys(updates)

      alert(`${deductMap.size}개 항목 차감 완료`)
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

      const fileName = `재고목록_${new Date().toISOString().split('T')[0]}.xlsx`
      const success = await exportStocksToExcel(dataToExport, fileName)

      if (success) {
        if (dataToExport.length === 0) {
          alert('빈 양식이 다운로드되었습니다.')
        } else {
          alert(`${dataToExport.length}개의 데이터가 다운로드되었습니다.`)
        }
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
      {/* 엑셀 업로드 진행 상황 모달 */}
      <UploadProgressModal
        isOpen={isUploading}
        progress={uploadProgress}
        status={uploadStatus}
        title="재고 엑셀 업로드"
      />

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <h1 style={{ fontSize: '28px', color: theme.colors.textPrimary, margin: 0 }}>
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
            disabled={isLoading || isUploading}
          >
            ⬆️ 엑셀 +
          </Button>

          {/* 엑셀 수량 차감 업로드 버튼 */}
          <Button
            variant="secondary"
            onClick={() => fileDeductRef.current?.click()}
            disabled={isLoading || isUploading}
          >
            ⬆️ 엑셀 -
          </Button>

          {/* 엑셀 다운로드 버튼 */}
          <Button
            variant="secondary"
            onClick={handleDownloadExcel}
            disabled={isLoading || isUploading}
          >
            ⬇️ 엑셀
          </Button>

          {/* 삭제 버튼 */}
          <Button
            variant="danger"
            onClick={handleDeleteSelected}
            disabled={isLoading || isUploading}
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
          backgroundColor: theme.colors.dangerLight,
          color: theme.colors.danger,
          border: `1px solid ${theme.colors.danger}`,
          borderRadius: theme.radius.md,
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
          ...theme.modal.overlay,
        }}>
          <div style={{
            ...theme.modal.content,
            minWidth: '480px', maxWidth: '640px',
            maxHeight: '80vh', overflowY: 'auto',
          }}>
            {/* 헤더 */}
            <h3 style={{ margin: '0 0 6px', fontSize: '16px', color: theme.colors.textPrimary }}>
              엑셀 차감 오류
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: theme.colors.textSecondary }}>
              <span style={{ color: theme.colors.dangerHover, fontWeight: 700 }}>모든 처리를 거부</span>하였습니다. 오류 사유를 확인 후 재요청해주세요.
            </p>

            {/* 오류사유 1: 로케이션-바코드 미존재 */}
            {deductErrors.notFound.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: theme.colors.dangerHover, marginBottom: '8px' }}>
                  오류사유 1 &nbsp;·&nbsp; 로케이션 - 바코드가 존재하지 않습니다&nbsp;
                  <span style={{ fontWeight: 400, color: theme.colors.textSecondary }}>
                    ({deductErrors.notFound.length}건)
                  </span>
                </div>
                <div style={{
                  background: theme.colors.dangerLight, borderRadius: theme.radius.sm,
                  padding: '10px 14px', maxHeight: '160px', overflowY: 'auto',
                }}>
                  {/* 컬럼 헤더 */}
                  <div style={{
                    display: 'flex', gap: '8px', fontSize: '12px',
                    color: theme.colors.textMuted, paddingBottom: '6px',
                    borderBottom: '1px solid #fecaca', marginBottom: '4px',
                  }}>
                    <span style={{ width: '140px' }}>로케이션</span>
                    <span style={{ flex: 1 }}>바코드</span>
                  </div>
                  {deductErrors.notFound.map((r, i) => (
                    <div key={i} style={{
                      display: 'flex', gap: '8px', fontSize: '13px',
                      color: theme.colors.textPrimary, padding: '4px 0',
                      borderBottom: i < deductErrors.notFound.length - 1
                        ? '1px solid #fee2e2' : 'none',
                    }}>
                      <span style={{ width: '140px', color: theme.colors.textSecondary }}>{r.location || '(없음)'}</span>
                      <span style={{ flex: 1 }}>{r.barcode}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 오류사유 2: 재고 부족 */}
            {deductErrors.insufficient.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: theme.colors.warning, marginBottom: '8px' }}>
                  오류사유 2 &nbsp;·&nbsp; 재고 수량이 차감 수량보다 적습니다&nbsp;
                  <span style={{ fontWeight: 400, color: theme.colors.textSecondary }}>
                    ({deductErrors.insufficient.length}건)
                  </span>
                </div>
                <div style={{
                  background: '#fffbeb', borderRadius: theme.radius.sm,
                  padding: '10px 14px', maxHeight: '160px', overflowY: 'auto',
                }}>
                  {/* 컬럼 헤더 */}
                  <div style={{
                    display: 'flex', gap: '8px', fontSize: '12px',
                    color: theme.colors.textMuted, paddingBottom: '6px',
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
                      color: theme.colors.textPrimary, padding: '4px 0',
                      borderBottom: i < deductErrors.insufficient.length - 1
                        ? '1px solid #fde68a' : 'none',
                    }}>
                      <span style={{ width: '120px', color: theme.colors.textSecondary }}>{r.location || '(없음)'}</span>
                      <span style={{ flex: 1 }}>{r.barcode}</span>
                      <span style={{ width: '60px', textAlign: 'right' }}>{r.currentQty}</span>
                      <span style={{ width: '60px', textAlign: 'right', color: theme.colors.dangerHover, fontWeight: 600 }}>{r.requestedQty}</span>
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
                  padding: '8px 24px', border: 'none', borderRadius: theme.radius.sm,
                  background: theme.colors.primary, color: 'white',
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