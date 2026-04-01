import React, { useState, useCallback, useEffect, useMemo } from 'react'
import Button from '../components/common/Button'
import ShipmentTable from '../components/shipment/ShipmentTable'
import ShipmentScanTable from '../components/shipment/ShipmentScanTable'
import ShipmentAddPanel from '../components/shipment/ShipmentAddPanel'
import ScanWorkflow from '../components/shipment/ScanWorkflow'
import { ShipmentService } from '../services/shipmentService'
import type { ShipmentRow, ScanState, ShipmentScan } from '../types/shipment'
import { theme } from '../styles/theme'

// ── 뷰 모드: 출고리스트 / 스캔기록 ─────────────────────────────────
type ViewMode = 'list' | 'scan'

// ── 토스트 메시지 타입 ──────────────────────────────────────────────
interface Toast {
  text: string
  visible: boolean
}

const ShipmentList: React.FC = () => {
  // ═══════════════════════════════════════════════════════════════════
  // ── 사용자 정보 ────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  const userId = useMemo(() => {
    const userStr = localStorage.getItem('user')
    return userStr ? JSON.parse(userStr)?.id ?? null : null
  }, [])

  // ═══════════════════════════════════════════════════════════════════
  // ── 상태 관리 ─────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // ── 테이블 데이터 (in-memory) ─────────────────────────────────────
  const [shipmentRows, setShipmentRows] = useState<ShipmentRow[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // ── 페이지 마운트 시 3-query 조합 로드 ─────────────────────────────
  // si_shipment_list(요청개수) + si_stocks(위치) + si_shipment_scan(스캔수량)
  useEffect(() => {
    if (!userId) { setIsLoading(false); return }

    const loadShipmentList = async () => {
      try {
        const rows = await ShipmentService.fetchShipmentList(userId)
        setShipmentRows(rows)
      } catch (err) {
        console.error('출고 리스트 로드 오류:', err)
      } finally {
        setIsLoading(false)
      }
    }
    loadShipmentList()
  }, [userId])

  // ── 슬라이드 패널 ────────────────────────────────────────────────
  const [isPanelOpen, setIsPanelOpen] = useState(false)

  // ── 스캔 워크플로 ────────────────────────────────────────────────
  const [scanState, setScanState] = useState<ScanState>({
    activeStep: 'box',
    boxValue: '',
    locationValue: '',
    barcodeValue: '',
  })

  // ── 뷰 모드 (출고리스트 / 스캔기록) ─────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [scanRecords, setScanRecords] = useState<ShipmentScan[]>([])
  const [isScanLoading, setIsScanLoading] = useState(false)

  // ── 저장/초기화 상태 ──────────────────────────────────────────────
  const [isSavingList, setIsSavingList] = useState(false)
  const [isSavingScan, setIsSavingScan] = useState(false)
  const [isResetting, setIsResetting] = useState(false)

  // ── 스캔 행 하이라이트 (현재 / 이전) ─────────────────────────────
  const [activeBarcode, setActiveBarcode] = useState<string | null>(null)
  const [prevBarcode, setPrevBarcode] = useState<string | null>(null)

  // ── 중앙 토스트 ──────────────────────────────────────────────────
  const [toast, setToast] = useState<Toast | null>(null)

  const showToast = useCallback((text: string) => {
    setToast({ text, visible: true })
  }, [])

  // 토스트 자동 사라짐
  useEffect(() => {
    if (!toast?.visible) return
    const fadeTimer = setTimeout(() => setToast(prev => prev ? { ...prev, visible: false } : null), 1200)
    const removeTimer = setTimeout(() => setToast(null), 1600)
    return () => { clearTimeout(fadeTimer); clearTimeout(removeTimer) }
  }, [toast?.visible])

  // ═══════════════════════════════════════════════════════════════════
  // ── 항목 추가 (슬라이드 패널 → 테이블) ────────────────────────────
  // 동일 바코드 → shipmentQty 합산
  // ═══════════════════════════════════════════════════════════════════

  const handleAddItem = useCallback((item: ShipmentRow) => {
    setShipmentRows(prev => {
      const existingIdx = prev.findIndex(r => r.barcode === item.barcode)
      if (existingIdx >= 0) {
        const updated = [...prev]
        updated[existingIdx] = {
          ...updated[existingIdx],
          shipmentQty: updated[existingIdx].shipmentQty + item.shipmentQty,
        }
        return updated
      }
      return [...prev, item]
    })
    showToast('추가 성공')
  }, [showToast])

  // ═══════════════════════════════════════════════════════════════════
  // ── 스캔 완료 처리 ────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  const handleScanComplete = useCallback((box: string, location: string, barcode: string) => {
    const bc = barcode.trim()
    const loc = location.trim()

    // 이전/현재 바코드 하이라이트 갱신
    setActiveBarcode(prev => {
      if (prev && prev !== bc) setPrevBarcode(prev)
      return bc
    })

    setShipmentRows(prev => {
      const rowIdx = prev.findIndex(r => r.barcode.trim() === bc)
      if (rowIdx < 0) {
        showToast(`바코드 ${bc}가 출고리스트에 없습니다`)
        return prev
      }

      const row = prev[rowIdx]
      const locIdx = row.stockLocations.findIndex(sl => sl.location.trim() === loc)
      if (locIdx < 0) {
        showToast(`위치 ${loc}에 해당 바코드 재고가 없습니다`)
        return prev
      }

      const updated = [...prev]
      const updatedRow = { ...row }
      const updatedLocations = [...updatedRow.stockLocations]
      updatedLocations[locIdx] = {
        ...updatedLocations[locIdx],
        scannedQty: updatedLocations[locIdx].scannedQty + 1,
        shipmentBox: box,
      }
      updatedRow.stockLocations = updatedLocations
      updated[rowIdx] = updatedRow
      return updated
    })
  }, [showToast])

  // ═══════════════════════════════════════════════════════════════════
  // ── 리스트 저장 → si_shipment_list ────────────────────────────────
  // Replace 전략: DELETE(user_id) → INSERT(바코드별 1건, qty=요청개수)
  // ═══════════════════════════════════════════════════════════════════

  const handleSaveList = useCallback(async () => {
    if (!userId) { showToast('로그인 정보를 찾을 수 없습니다'); return }
    if (shipmentRows.length === 0) { showToast('저장할 리스트가 없습니다'); return }

    // 바코드별 1건: qty = shipmentQty (요청개수)
    const saveItems = shipmentRows.map(row => ({
      barcode: row.barcode,
      item_name: row.item_name,
      option_name: row.option_name,
      qty: row.shipmentQty,
      coupang_shipment_size: row.coupangShipmentSize || null,
      location: null,
      user_id: userId,
    }))

    setIsSavingList(true)
    try {
      const { created, errors } = await ShipmentService.saveShipmentList(saveItems, userId)
      if (errors > 0) {
        showToast(`리스트 ${created}건 성공, ${errors}건 실패`)
      } else {
        showToast(`리스트 ${created}건 저장 완료`)
      }
    } catch (err) {
      console.error('리스트 저장 오류:', err)
      showToast('리스트 저장 중 오류가 발생했습니다')
    } finally {
      setIsSavingList(false)
    }
  }, [userId, shipmentRows, showToast])

  // ═══════════════════════════════════════════════════════════════════
  // ── 스캔 저장 → si_shipment_scan ──────────────────────────────────
  // 스캔 처리된 데이터를 DB에 저장 (user_id 포함)
  // 저장 후 in-memory scannedQty만 리셋 (리스트는 유지)
  // ═══════════════════════════════════════════════════════════════════

  const handleSaveScan = useCallback(async () => {
    if (!userId) { showToast('로그인 정보를 찾을 수 없습니다'); return }

    const scanItems: Omit<ShipmentScan, 'id' | 'created_at'>[] = []

    // scannedQty > 0인 위치만 수집
    for (const row of shipmentRows) {
      for (const sl of row.stockLocations) {
        if (sl.scannedQty > 0 && sl.shipmentBox) {
          scanItems.push({
            barcode: row.barcode,
            item_name: row.item_name,
            option_name: row.option_name,
            qty: sl.scannedQty,
            coupang_shipment_size: row.coupangShipmentSize || null,
            location: sl.location,
            shipment_box: sl.shipmentBox,
            user_id: userId,
          })
        }
      }
    }

    if (scanItems.length === 0) {
      showToast('저장할 스캔 데이터가 없습니다')
      return
    }

    // (shipment_box + location + barcode) 키로 그룹핑 → qty 합산
    const aggregated = new Map<string, Omit<ShipmentScan, 'id' | 'created_at'>>()
    for (const item of scanItems) {
      const key = `${item.shipment_box}|${item.location}|${item.barcode}`
      const existing = aggregated.get(key)
      if (existing) {
        existing.qty = (existing.qty ?? 0) + (item.qty ?? 0)
      } else {
        aggregated.set(key, { ...item })
      }
    }

    setIsSavingScan(true)
    try {
      const { created, errors } = await ShipmentService.saveShipmentScan(
        Array.from(aggregated.values()),
        userId
      )
      if (errors > 0) {
        showToast(`스캔 ${created}건 성공, ${errors}건 실패`)
      } else {
        showToast(`스캔 ${created}건 저장 완료`)
        // 스캔 저장 후: DB에서 다시 로드 → 스캔 수량 반영된 상태 유지
        const reloaded = await ShipmentService.fetchShipmentList(userId)
        setShipmentRows(reloaded)
        setScanState({ activeStep: 'box', boxValue: '', locationValue: '', barcodeValue: '' })
        setActiveBarcode(null)
        setPrevBarcode(null)
      }
    } catch (err) {
      console.error('스캔 저장 오류:', err)
      showToast('스캔 저장 중 오류가 발생했습니다')
    } finally {
      setIsSavingScan(false)
    }
  }, [userId, shipmentRows, showToast])

  // ═══════════════════════════════════════════════════════════════════
  // ── 리스트 초기화 (si_shipment_list + si_shipment_scan 전체 삭제) ─
  // ═══════════════════════════════════════════════════════════════════

  const handleReset = useCallback(async () => {
    if (!userId) { showToast('로그인 정보를 찾을 수 없습니다'); return }
    if (!window.confirm('리스트와 스캔 데이터를 모두 초기화하시겠습니까?')) return

    setIsResetting(true)
    try {
      const { success } = await ShipmentService.resetShipmentData(userId)
      if (success) {
        setShipmentRows([])
        setScanState({ activeStep: 'box', boxValue: '', locationValue: '', barcodeValue: '' })
        setActiveBarcode(null)
        setPrevBarcode(null)
        showToast('초기화 완료')
      } else {
        showToast('초기화 중 오류가 발생했습니다')
      }
    } catch (err) {
      console.error('초기화 오류:', err)
      showToast('초기화 중 오류가 발생했습니다')
    } finally {
      setIsResetting(false)
    }
  }, [userId, showToast])

  // ═══════════════════════════════════════════════════════════════════
  // ── 뷰 모드 전환 (출고리스트 ↔ 스캔기록) ───────────────────────────
  // 스캔기록 뷰 진입 시 si_shipment_scan 데이터 로드
  // ═══════════════════════════════════════════════════════════════════

  const handleToggleView = useCallback(async () => {
    if (viewMode === 'list') {
      // 스캔기록 뷰로 전환 → 데이터 로드
      if (!userId) return
      setIsScanLoading(true)
      setViewMode('scan')
      try {
        const records = await ShipmentService.fetchShipmentScanRecords(userId)
        setScanRecords(records)
      } catch (err) {
        console.error('스캔 기록 로드 오류:', err)
      } finally {
        setIsScanLoading(false)
      }
    } else {
      // 출고리스트 뷰로 복귀 → DB 최신 데이터 리로드
      setViewMode('list')
      if (userId) {
        try {
          const reloaded = await ShipmentService.fetchShipmentList(userId)
          setShipmentRows(reloaded)
        } catch (err) {
          console.error('출고 리스트 리로드 오류:', err)
        }
      }
    }
  }, [viewMode, userId])

  // ═══════════════════════════════════════════════════════════════════
  // ── 스캔 레코드 삭제 (스캔기록 뷰 전용) ──────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  const handleDeleteScanRecord = useCallback(async (id: string) => {
    const ok = await ShipmentService.deleteScanRecord(id)
    if (ok) {
      setScanRecords(prev => prev.filter(r => r.id !== id))
      showToast('삭제 완료')
    } else {
      showToast('삭제 실패')
    }
  }, [showToast])

  // ═══════════════════════════════════════════════════════════════════
  // ── 스캔 레코드 수량 수정 (스캔기록 뷰 전용) ────────────────────
  // qty = 0 → 삭제 처리
  // ═══════════════════════════════════════════════════════════════════

  const handleUpdateScanQty = useCallback(async (id: string, qty: number) => {
    const ok = await ShipmentService.updateScanRecordQty(id, qty)
    if (ok) {
      if (qty <= 0) {
        setScanRecords(prev => prev.filter(r => r.id !== id))
        showToast('삭제 완료')
      } else {
        setScanRecords(prev => prev.map(r => r.id === id ? { ...r, qty } : r))
        showToast('수정 완료')
      }
    } else {
      showToast('수정 실패')
    }
  }, [showToast])

  // ═══════════════════════════════════════════════════════════════════
  // ── 스캔 데이터 존재 여부 (스캔 저장 버튼 활성화 판단) ────────────
  // ═══════════════════════════════════════════════════════════════════

  const hasScanData = shipmentRows.some(row =>
    row.stockLocations.some(sl => sl.scannedQty > 0)
  )

  // ═══════════════════════════════════════════════════════════════════
  // ── 전체화면 토글 ─────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const handleChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handleChange)
    return () => document.removeEventListener('fullscreenchange', handleChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      document.documentElement.requestFullscreen()
    }
  }, [])

  // ── 버튼 공통 스타일 ──────────────────────────────────────────────
  const btnStyle: React.CSSProperties = { whiteSpace: 'nowrap' }

  // ═══════════════════════════════════════════════════════════════════
  // ── 렌더링 ────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div style={{ padding: '20px' }}>
      {/* ── 타이틀 ──────────────────────────────────────────────────── */}
      <h1 style={{ fontSize: '28px', color: theme.colors.textPrimary, margin: '0 0 12px 0' }}>출고리스트</h1>

      {/* ── 버튼 영역 ───────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
      }}>
        {/* 왼쪽: 리스트 추가 + 리스트 저장 + 리스트 초기화 */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button variant="default" onClick={() => setIsPanelOpen(true)} style={btnStyle}>
            리스트 추가
          </Button>
          <Button
            variant="default"
            onClick={handleSaveList}
            disabled={isSavingList || shipmentRows.length === 0}
            style={btnStyle}
          >
            {isSavingList ? '저장 중...' : '리스트 저장'}
          </Button>
          <Button
            variant="danger"
            onClick={handleReset}
            disabled={isResetting}
            style={btnStyle}
          >
            {isResetting ? '초기화 중...' : '리스트 초기화'}
          </Button>
        </div>

        {/* 오른쪽: 스캔기록 + 전체화면 + 스캔 저장 */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button
            variant={viewMode === 'scan' ? 'info' : 'default'}
            onClick={handleToggleView}
            style={btnStyle}
          >
            {viewMode === 'scan' ? '출고리스트' : '스캔기록'}
          </Button>
          <Button variant="default" onClick={toggleFullscreen} style={btnStyle}>
            {isFullscreen ? '화면 복원' : '전체화면'}
          </Button>
          <Button
            variant="default"
            onClick={handleSaveScan}
            disabled={isSavingScan || !hasScanData}
            style={btnStyle}
          >
            {isSavingScan ? '저장 중...' : '스캔 저장'}
          </Button>
        </div>
      </div>

      {/* ── 스캔 워크플로 (3개 폼 — 뷰 모드 무관 항상 표시) ──────── */}
      <ScanWorkflow
        scanState={scanState}
        onScanStateChange={setScanState}
        onScanComplete={handleScanComplete}
      />

      {/* ── 뷰 모드별 테이블 (빠른 전환) ─────────────────────────── */}
      <div style={{ transition: 'opacity 0.15s ease', opacity: 1 }}>
        {viewMode === 'list' ? (
          isLoading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: theme.colors.textMuted }}>
              데이터 불러오는 중...
            </div>
          ) : (
            <ShipmentTable
              data={shipmentRows}
              activeBarcode={activeBarcode}
              prevBarcode={prevBarcode}
            />
          )
        ) : (
          <ShipmentScanTable
            data={scanRecords}
            loading={isScanLoading}
            onDelete={handleDeleteScanRecord}
            onUpdateQty={handleUpdateScanQty}
          />
        )}
      </div>

      {/* ── 출고 추가 슬라이드 패널 ────────────────────────────────── */}
      <ShipmentAddPanel
        isOpen={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
        onAddItem={handleAddItem}
      />

      {/* ── 중앙 토스트 (반투명 페이드) ────────────────────────────── */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          zIndex: 9999,
        }}>
          <div style={{
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            color: 'white',
            padding: '24px 40px',
            borderRadius: theme.radius.lg,
            fontSize: '16px',
            fontWeight: '500',
            textAlign: 'center',
            opacity: toast.visible ? 1 : 0,
            transition: 'opacity 0.4s ease',
          }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>&#10003;</div>
            {toast.text}
          </div>
        </div>
      )}
    </div>
  )
}

export default ShipmentList
