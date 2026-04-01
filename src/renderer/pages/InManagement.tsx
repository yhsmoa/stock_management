import React, { useState, useRef, useEffect } from 'react'
import { theme } from '../styles/theme'
import Button from '../components/common/Button'
import { supabase } from '../services/supabase'
import { StockService } from '../services/stockService'
import type { Stock } from '../types/stock'

// CoupangItem interface
interface CoupangItem {
  option_id: string;
  item_id: string;
  barcode: string;
  item_name: string;
  option_name: string;
  price: number;
  regular_price: number;
  sales_status: string;
  item_status: string;
  product_id?: string;
  item_code?: string;
  product_name?: string;
  stock?: number;
  user_id?: string;
}

// Scanned Item interface for temporary storage
interface ScannedItem {
  location: string;
  barcode: string;
  item_name: string;
  option_name: string;
  qty: number;
  timestamp: Date;
}

// Stock Location interface
interface StockLocation {
  location: string;
  barcode: string;
}

const InManagement: React.FC = () => {
  const [location, setLocation] = useState('')
  const [barcode, setBarcode] = useState('')
  const [activeInput, setActiveInput] = useState<string | null>(null)
  const [resultMessage, setResultMessage] = useState('')
  const [coupangItems, setCoupangItems] = useState<CoupangItem[]>([])
  const [loading, setLoading] = useState(false)
  const [dataReady, setDataReady] = useState(false) // 데이터 로딩 완료 상태
  const [matchedItem, setMatchedItem] = useState<CoupangItem | null>(null)
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([])
  const [showSlidePanel, setShowSlidePanel] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [stockLocations, setStockLocations] = useState<StockLocation[]>([])
  const [availableLocations, setAvailableLocations] = useState<string[]>([])
  const [locationMode, setLocationMode] = useState<'fixed' | 'unfixed'>('unfixed')

  // 새로운 상태 추가
  const [currentScanData, setCurrentScanData] = useState<{
    barcode: string;
    item: CoupangItem;
    qty: number;
  } | null>(null)
  const [pendingItems, setPendingItems] = useState<ScannedItem[]>([])
  const [showBarcodeResult, setShowBarcodeResult] = useState(false)

  const barcodeRef = useRef<HTMLInputElement>(null)
  const locationRef = useRef<HTMLInputElement>(null)

  // 입력 포커스 핸들러
  const handleInputFocus = (inputType: string, currentValue: string) => {
    setActiveInput(inputType)

    // 바코드 입력폼 포커스 시에만 바코드 값 지우기
    if (inputType === 'barcode' && currentValue) {
      setBarcode('')
    }

    // 로케이션 입력폼 포커스 시 로케이션 값만 지우기 (바코드 결과는 유지)
    if (inputType === 'location' && currentValue) {
      setLocation('')
    }
  }

  // 바코드 Enter 핸들러
  const handleBarcodeKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && barcode.trim() && dataReady) {
      processBarcode(barcode.trim())
    }
  }

  // 로케이션 Enter 핸들러
  const handleLocationKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && location.trim()) {
      // currentScanData가 있거나 location이 없는 항목들이 있을 때 처리
      if (currentScanData || scannedItems.some(item => !item.location)) {
        handleLocationSubmit()
      }
    }
  }

  // 로케이션 제출 처리
  const handleLocationSubmit = (customLocation?: string) => {
    const targetLocation = customLocation || location
    if (!targetLocation.trim()) return

    // 두 가지 작업을 수행:
    // 1. 현재 스캔 데이터가 있으면 해당 로케이션으로 추가
    // 2. 기존 '미지정' 항목들을 모두 해당 로케이션으로 업데이트

    let updatedItems = [...scannedItems]

    // 기존 미지정 항목들을 모두 해당 로케이션으로 업데이트
    updatedItems = updatedItems.map(item => {
      if (!item.location || item.location === '') {
        return { ...item, location: targetLocation }
      }
      return item
    })

    // 현재 스캔 데이터가 있는 경우 새 항목 추가
    if (currentScanData) {
      const newScannedItem: ScannedItem = {
        location: targetLocation,
        barcode: currentScanData.barcode,
        item_name: currentScanData.item.item_name,
        option_name: currentScanData.item.option_name || '',
        qty: currentScanData.qty,
        timestamp: new Date()
      }

      // 새 항목을 맨 앞에 추가
      updatedItems = [newScannedItem, ...updatedItems]

      // Clear current scan data
      setCurrentScanData(null)
      setShowBarcodeResult(false)
      setMatchedItem(null)
      setAvailableLocations([])
      setBarcode('')

      // Clear location if unfixed mode and not custom location
      if (locationMode === 'unfixed' && !customLocation) {
        setLocation('')
      }
    }

    // 업데이트된 항목들을 상태에 반영
    setScannedItems(updatedItems)

    // 바코드 입력창으로 포커스 복귀
    setTimeout(() => barcodeRef.current?.focus(), 0)
  }

  // Load data on component mount
  useEffect(() => {
    loadCoupangItems()
    loadStockLocations()
  }, [])

  // Load stock locations from si_stocks
  const loadStockLocations = async () => {
    try {
      // Get user UUID from localStorage
      const userStr = localStorage.getItem('user');
      const user = userStr ? JSON.parse(userStr) : null;
      const userId = user?.id;

      if (!userId) {
        console.error('No user id found for stocks');
        return;
      }

      console.log('Loading stock locations for user:', userId)

      // Fetch all stock locations (페이지네이션 루프 — 1000행 제한 해소)
      let allData: { location: string; barcode: string }[] = []
      let from = 0
      const batchSize = 1000
      let hasMore = true

      while (hasMore) {
        const { data, error } = await supabase
          .from('si_stocks')
          .select('location, barcode')
          .not('location', 'is', null)
          .neq('location', '')
          .not('barcode', 'is', null)
          .neq('barcode', '')
          .range(from, from + batchSize - 1)

        if (error) {
          console.error('Error loading stock locations:', error)
          hasMore = false
        } else if (data && data.length > 0) {
          allData = [...allData, ...data]
          from += batchSize
          if (data.length < batchSize) hasMore = false
        } else {
          hasMore = false
        }
      }

      if (allData.length > 0) {
        setStockLocations(allData)
        console.log(`Loaded ${allData.length} stock locations`)
      }
    } catch (error) {
      console.error('Error in loadStockLocations:', error)
    }
  }

  // Load coupang items with barcode data
  const loadCoupangItems = async () => {
    setLoading(true)
    try {
      // Get user UUID from localStorage
      const userStr = localStorage.getItem('user');
      const user = userStr ? JSON.parse(userStr) : null;
      const userId = user?.id;

      if (!userId) {
        console.error('No user id found');
        setResultMessage('사용자 정보를 찾을 수 없습니다.')
        setLoading(false)
        return;
      }

      // Fetch items with barcode data for this user - batch processing to get all data
      let allData: CoupangItem[] = []
      let from = 0
      const batchSize = 1000
      let hasMore = true

      while (hasMore) {
        const { data, error } = await supabase
          .from('si_coupang_items')
          .select('*')
          .eq('user_id', userId)
          .not('barcode', 'is', null)
          .neq('barcode', '')
          .range(from, from + batchSize - 1)

        if (error) {
          console.error('Error loading items:', error)
          setResultMessage('데이터 로드 중 오류가 발생했습니다.')
          hasMore = false
        } else if (data && data.length > 0) {
          allData = [...allData, ...data]
          from += batchSize

          if (data.length < batchSize) {
            hasMore = false
          }
        } else {
          hasMore = false
        }
      }

      // Set all fetched data
      setCoupangItems(allData)
      console.log(`Loaded ${allData.length} items with barcodes for user ${userId}`)
      setDataReady(true) // 데이터 로딩 완료
    } catch (error) {
      console.error('Error in loadCoupangItems:', error)
      setResultMessage('데이터 로드 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  // 바코드 처리
  const processBarcode = (barcodeValue: string) => {
    // Find matching item in loaded data
    const item = coupangItems.find(item => item.barcode === barcodeValue)

    if (!item) {
      setResultMessage(`바코드 "${barcodeValue}"에 해당하는 상품을 찾을 수 없습니다.`)
      setBarcode('')
      setTimeout(() => barcodeRef.current?.focus(), 0)
      return
    }

    // 현재 스캔 데이터가 있고 같은 바코드인 경우
    if (currentScanData && currentScanData.barcode === barcodeValue) {
      // 수량만 증가
      setCurrentScanData({
        ...currentScanData,
        qty: currentScanData.qty + 1
      })

      // 같은 바코드여도 location 버튼은 유지
      const locations = [...new Set(stockLocations
        .filter(sl => sl.barcode === barcodeValue)
        .map(sl => sl.location)
        .filter(loc => loc))]
      setAvailableLocations(locations)
    } else {
      // 다른 바코드인 경우
      if (currentScanData) {
        // 이전 스캔 데이터를 pending으로 이동 (location 없이)
        const pendingItem: ScannedItem = {
          location: '', // location 없이 저장
          barcode: currentScanData.barcode,
          item_name: currentScanData.item.item_name,
          option_name: currentScanData.item.option_name || '',
          qty: currentScanData.qty,
          timestamp: new Date()
        }

        // 상태창에 바로 추가
        setScannedItems(prev => [pendingItem, ...prev])

        // 이전 버튼 초기화
        setAvailableLocations([])
      }

      // 새 바코드 데이터 설정
      setCurrentScanData({
        barcode: barcodeValue,
        item: item,
        qty: 1
      })

      // 새 바코드에 대한 location 버튼 설정
      const locations = [...new Set(stockLocations
        .filter(sl => sl.barcode === barcodeValue)
        .map(sl => sl.location)
        .filter(loc => loc))]
      setAvailableLocations(locations)
    }

    // 결과 표시 모드로 전환
    setShowBarcodeResult(true)
    setMatchedItem(item)

    // 바코드 입력값 초기화하지만 포커스 유지
    setBarcode('')
    setTimeout(() => barcodeRef.current?.focus(), 0)
  }

  // 상태창 핸들러
  const handleStatusWindow = () => {
    // 현재 스캔 데이터가 있으면 location 없이 상태창에 추가
    if (currentScanData) {
      const pendingItem: ScannedItem = {
        location: '', // location 없이 저장
        barcode: currentScanData.barcode,
        item_name: currentScanData.item.item_name,
        option_name: currentScanData.item.option_name || '',
        qty: currentScanData.qty,
        timestamp: new Date()
      }

      // 상태창에 추가
      setScannedItems(prev => [pendingItem, ...prev])

      // Clear current scan data
      setCurrentScanData(null)
      setShowBarcodeResult(false)
      setMatchedItem(null)
      setAvailableLocations([])
      setBarcode('')

      // 바코드 입력창으로 포커스 복귀
      setTimeout(() => barcodeRef.current?.focus(), 0)
    }

    setShowSlidePanel(true)
  }

  // 슬라이드 패널 닫기
  const handleClosePanel = () => {
    setShowSlidePanel(false)
  }

  // 데이터 저장
  const handleSaveData = async () => {
    if (scannedItems.length === 0) {
      alert('저장할 데이터가 없습니다.')
      return
    }

    // Get user UUID from localStorage
    const userStr = localStorage.getItem('user');
    const user = userStr ? JSON.parse(userStr) : null;
    const userId = user?.id;

    if (!userId) {
      alert('사용자 정보를 찾을 수 없습니다.')
      return
    }

    setIsSaving(true)
    try {
      // Convert scanned items to Stock format with user_id (UUID)
      const stocksToSave = scannedItems.map(item => ({
        location: item.location,
        barcode: item.barcode,
        item_name: item.item_name,
        option_name: item.option_name,
        qty: item.qty,
        season: null,
        note: null,
        user_id: userId
      }))

      // 동일 (location + barcode + user_id) 존재 시 qty 합산, 없으면 신규 INSERT
      const savePromises = stocksToSave.map(stock => StockService.upsertStock(stock, userId))
      const results = await Promise.all(savePromises)

      const successCount = results.filter(r => r !== null).length
      if (successCount === stocksToSave.length) {
        alert(`${successCount}개 항목이 저장되었습니다.`)
        // Clear scanned items after successful save
        setScannedItems([])
        setShowSlidePanel(false)
      } else {
        alert(`${successCount}/${stocksToSave.length}개 항목만 저장되었습니다.`)
      }
    } catch (error) {
      console.error('저장 실패:', error)
      alert('저장 중 오류가 발생했습니다.')
    } finally {
      setIsSaving(false)
    }
  }


  // 스타일 정의 - Export 페이지와 독립적인 스타일
  const inManagementStyles = {
    container: {
      padding: '20px',
      maxWidth: '1400px',
      margin: '0 auto',
    },
    headerRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '20px',
    },
    header: {
      fontSize: '32px',
      color: theme.colors.textPrimary,
      margin: 0,
      fontWeight: 'bold',
    },
    badge: {
      position: 'absolute' as const,
      top: '-8px',
      right: '-8px',
      backgroundColor: theme.colors.danger,
      color: 'white',
      borderRadius: '50%',
      width: '24px',
      height: '24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '12px',
      fontWeight: 'bold',
    },
    inputFormContainer: {
      ...theme.card,
      padding: '30px',
      marginBottom: '20px',
    },
    inputSection: {
      marginBottom: '20px',
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'stretch',
    },
    inputWrapper: {
      position: 'relative' as const,
      marginBottom: '20px',
      width: '100%',
    },
    input: {
      width: '100%',
      height: '200px',
      padding: '30px',
      borderColor: theme.colors.border,
      borderWidth: '3px',
      borderStyle: 'solid',
      borderRadius: theme.radius.lg,
      fontSize: '48px',
      fontWeight: '500',
      transition: 'all 0.3s',
      outline: 'none',
      boxSizing: 'border-box' as const,
      textAlign: 'center' as const,
      caretColor: 'transparent',
    },
    inputActive: {
      borderColor: theme.colors.primary,
      borderWidth: '4px',
    },
    resultForm: {
      backgroundColor: theme.colors.bgTableHeader,
      borderRadius: theme.radius.lg,
      padding: '30px',
      width: '100%',
      height: '200px',
      border: `3px solid ${theme.colors.border}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxSizing: 'border-box' as const,
      marginBottom: '20px',
    },
    resultFormPlaceholder: {
      color: theme.colors.textSecondary,
      fontSize: '36px',
      textAlign: 'center' as const,
    },
    resultMessage: {
      fontSize: '42px',
      fontWeight: '500',
      color: theme.colors.textPrimary,
      textAlign: 'center' as const,
    },
    // Slide panel styles
    slidePanel: {
      position: 'fixed' as const,
      top: 0,
      right: 0,
      width: '45%',
      height: '100vh',
      backgroundColor: theme.colors.bgCard,
      boxShadow: theme.shadows.lg,
      transform: showSlidePanel ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 0.3s ease-in-out',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column' as const,
    },
    slidePanelHeader: {
      padding: '20px',
      borderBottom: `1px solid ${theme.colors.border}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: theme.colors.bgTableHeader,
    },
    slidePanelTitle: {
      fontSize: '24px',
      fontWeight: 'bold',
      color: theme.colors.textPrimary,
    },
    slidePanelActions: {
      display: 'flex',
      gap: '10px',
    },
    slidePanelContent: {
      flex: 1,
      overflow: 'auto',
      padding: '20px',
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse' as const,
    },
    tableHeader: {
      backgroundColor: theme.colors.bgTableHeader,
      borderBottom: `2px solid ${theme.colors.border}`,
    },
    tableHeaderCell: {
      padding: '12px',
      textAlign: 'left' as const,
      fontWeight: 'bold',
      fontSize: '14px',
      color: theme.colors.textSecondary,
    },
    tableRow: {
      borderBottom: `1px solid ${theme.colors.border}`,
      transition: 'background-color 0.2s',
    },
    tableCell: {
      padding: '12px',
      fontSize: '14px',
      verticalAlign: 'top' as const,
    },
    itemInfo: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '4px',
    },
    itemName: {
      fontWeight: 'bold',
      color: theme.colors.textPrimary,
    },
    optionName: {
      color: theme.colors.textSecondary,
      fontSize: '13px',
    },
    quantityInfo: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '4px',
      textAlign: 'right' as const,
    },
    locationQty: {
      fontWeight: 'bold',
      color: theme.colors.primary,
      fontSize: '16px',
    },
    totalQty: {
      color: theme.colors.textSecondary,
      fontSize: '13px',
    },
    emptyMessage: {
      textAlign: 'center' as const,
      padding: '40px',
      color: theme.colors.textSecondary,
      fontSize: '16px',
    },
    overlay: {
      position: 'fixed' as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: theme.colors.overlay,
      display: showSlidePanel ? 'block' : 'none',
      zIndex: 999,
    },
  }

  return (
    <div style={inManagementStyles.container}>
      {/* 헤더와 버튼 영역 */}
      <div style={inManagementStyles.headerRow}>
        <h1 style={inManagementStyles.header}>입고 관리</h1>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {/* 위치 고정/해제 토글 버튼 */}
          <Button
            variant={locationMode === 'fixed' ? 'primary' : 'secondary'}
            onClick={() => setLocationMode('fixed')}

          >
            위치 고정
          </Button>
          <Button
            variant={locationMode === 'unfixed' ? 'primary' : 'secondary'}
            onClick={() => setLocationMode('unfixed')}

          >
            위치 해제
          </Button>

          <div style={{ width: '2px', height: '30px', backgroundColor: theme.colors.border, margin: '0 10px' }} />

          <Button
            variant="info"
            onClick={handleStatusWindow}

          >
            상태창
            {scannedItems.length > 0 && (
              <span style={inManagementStyles.badge}>
                {scannedItems.length}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* 입력 폼 영역 */}
      <div style={inManagementStyles.inputFormContainer}>
        <div style={inManagementStyles.inputSection}>
          {/* 바코드 입력/결과 하이브리드 폼 */}
          <div style={{...inManagementStyles.inputWrapper, position: 'relative'}}>
            <input
              ref={barcodeRef}
              type="text"
              placeholder={!dataReady ? "데이터 로딩 중..." : (showBarcodeResult ? '' : "바코드")}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyPress={handleBarcodeKeyPress}
              onFocus={() => handleInputFocus('barcode', barcode)}
              onBlur={() => setActiveInput(null)}
              disabled={!dataReady}
              style={{
                ...inManagementStyles.input,
                ...(activeInput === 'barcode' ? inManagementStyles.inputActive : {}),
                opacity: !dataReady ? 0.5 : 1,
                cursor: !dataReady ? 'not-allowed' : 'text',
                backgroundColor: showBarcodeResult ? 'transparent' : theme.colors.bgCard,
                color: showBarcodeResult ? 'transparent' : theme.colors.textPrimary,
                caretColor: showBarcodeResult ? 'transparent' : 'auto',
              }}
            />

            {/* 결과 오버레이 */}
            {showBarcodeResult && currentScanData && (
              <div
                onClick={() => barcodeRef.current?.focus()}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: theme.colors.bgTableHeader,
                  border: `4px solid ${theme.colors.primary}`,
                  borderRadius: theme.radius.lg,
                  padding: '30px',
                  cursor: 'pointer',
                  transition: 'border-color 0.3s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = theme.colors.primaryHover
                  e.currentTarget.style.boxShadow = `0 0 10px rgba(74,140,247,0.3)`
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = theme.colors.primary
                  e.currentTarget.style.boxShadow = 'none'
                }}>
                <div style={{ width: '100%', display: 'flex', alignItems: 'center', height: '100%' }}>
                  {/* 왼쪽 절반 - 상품 정보 */}
                  <div style={{ flex: 1, borderRight: `2px solid ${theme.colors.border}`, paddingRight: '20px' }}>
                    <div style={{ fontSize: '32px', fontWeight: 'bold', color: theme.colors.textPrimary, marginBottom: '8px' }}>
                      {currentScanData.item.item_name}
                    </div>
                    {currentScanData.item.option_name && (
                      <div style={{ fontSize: '26px', color: theme.colors.textSecondary, marginBottom: '8px' }}>
                        {currentScanData.item.option_name}
                      </div>
                    )}
                    <div style={{ fontSize: '22px', color: theme.colors.textMuted }}>
                      {currentScanData.barcode}
                    </div>
                  </div>

                  {/* 오른쪽 절반 - 수량 정보 */}
                  <div style={{ flex: 1, paddingLeft: '30px', display: 'flex', alignItems: 'center', justifyContent: 'space-around' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '18px', color: theme.colors.textMuted, marginBottom: '10px' }}>
                        수량
                      </div>
                      <div style={{ fontSize: '72px', fontWeight: 'bold', color: theme.colors.primary, lineHeight: 1 }}>
                        {currentScanData.qty}
                      </div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '18px', color: theme.colors.textMuted, marginBottom: '10px' }}>
                        전체수량
                      </div>
                      <div style={{ fontSize: '72px', fontWeight: 'bold', color: theme.colors.textPrimary, lineHeight: 1 }}>
                        {scannedItems
                          .filter(item => item.barcode === currentScanData.barcode)
                          .reduce((sum, item) => sum + item.qty, 0) + currentScanData.qty}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>


          {/* 로케이션 입력 */}
          <div style={inManagementStyles.inputWrapper}>
            <input
              ref={locationRef}
              type="text"
              placeholder="로케이션"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              onKeyPress={handleLocationKeyPress}
              onFocus={() => handleInputFocus('location', location)}
              onBlur={() => setActiveInput(null)}
              style={{
                ...inManagementStyles.input,
                ...(activeInput === 'location' ? inManagementStyles.inputActive : {}),
              }}
            />
          </div>

          {/* 로케이션 버튼들 - 현재 스캔 데이터가 있을 때만 표시 */}
          {currentScanData && availableLocations.length > 0 && (
            <div style={{
              width: '100%',
              display: 'flex',
              flexWrap: 'nowrap',  // 한 줄로 표시
              gap: '10px',
              marginTop: '10px',
              alignItems: 'center'
            }}>
              {availableLocations.map((loc, index) => (
                <button
                  key={index}
                  style={{
                    flex: '1 1 0',  // 모든 버튼이 동일한 너비로 공간을 나눔
                    minWidth: '0',  // flex가 제대로 작동하도록
                    height: '80px',  // 버튼 높이도 크게
                    padding: '12px 16px',
                    backgroundColor: theme.colors.bgCard,
                    border: `2px solid ${theme.colors.primary}`,
                    borderRadius: theme.radius.md,
                    cursor: 'pointer',
                    fontSize: availableLocations.length > 10 ? '14px' : availableLocations.length > 5 ? '16px' : '18px',  // 개수에 따라 폰트 크기 조정
                    fontWeight: 'bold',
                    color: theme.colors.primary,
                    transition: 'all 0.3s',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    // location 버튼 클릭 시 즉시 저장
                    handleLocationSubmit(loc)

                    // 위치 고정 모드면 location 설정
                    if (locationMode === 'fixed') {
                      setLocation(loc)
                    }
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = theme.colors.primary
                    e.currentTarget.style.color = 'white'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = theme.colors.bgCard
                    e.currentTarget.style.color = theme.colors.primary
                  }}
                >
                  {loc}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Overlay */}
      <div style={inManagementStyles.overlay} onClick={handleClosePanel} />

      {/* Slide Panel */}
      <div style={inManagementStyles.slidePanel}>
        <div style={inManagementStyles.slidePanelHeader}>
          <h2 style={inManagementStyles.slidePanelTitle}>스캔 현황</h2>
          <div style={inManagementStyles.slidePanelActions}>
            <Button
              variant="primary"
              onClick={handleSaveData}
              disabled={isSaving}
  
            >
              {isSaving ? '저장 중...' : '저장'}
            </Button>
            <Button
              variant="secondary"
              onClick={handleClosePanel}
            >
              닫기
            </Button>
          </div>
        </div>

        <div style={inManagementStyles.slidePanelContent}>
          {scannedItems.length > 0 ? (
            <table style={inManagementStyles.table}>
              <thead style={inManagementStyles.tableHeader}>
                <tr>
                  <th style={inManagementStyles.tableHeaderCell}>로케이션</th>
                  <th style={inManagementStyles.tableHeaderCell}>바코드</th>
                  <th style={inManagementStyles.tableHeaderCell}>상품명/옵션명</th>
                  <th style={{...inManagementStyles.tableHeaderCell, textAlign: 'center'}}>수량</th>
                  <th style={{...inManagementStyles.tableHeaderCell, textAlign: 'center'}}>전체</th>
                  <th style={{...inManagementStyles.tableHeaderCell, textAlign: 'center'}}>삭제</th>
                </tr>
              </thead>
              <tbody>
                {scannedItems.map((item, index) => (
                  <tr
                    key={`${item.location}-${item.barcode}-${index}`}
                    style={inManagementStyles.tableRow}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = theme.colors.bgHover
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                  >
                    <td style={{
                      ...inManagementStyles.tableCell,
                      color: item.location ? theme.colors.textPrimary : theme.colors.danger,
                      fontStyle: item.location ? 'normal' : 'italic'
                    }}>
                      {item.location || '미지정'}
                    </td>
                    <td style={inManagementStyles.tableCell}>{item.barcode}</td>
                    <td style={inManagementStyles.tableCell}>
                      <div style={inManagementStyles.itemInfo}>
                        <span style={inManagementStyles.itemName}>{item.item_name}</span>
                        {item.option_name && (
                          <span style={inManagementStyles.optionName}>{item.option_name}</span>
                        )}
                      </div>
                    </td>
                    <td style={{...inManagementStyles.tableCell, textAlign: 'center'}}>
                      <span style={inManagementStyles.locationQty}>{item.qty}</span>
                    </td>
                    <td style={{...inManagementStyles.tableCell, textAlign: 'center'}}>
                      <span style={{...inManagementStyles.locationQty, color: theme.colors.textPrimary}}>
                        {scannedItems
                          .filter(si => si.barcode === item.barcode)
                          .reduce((sum, si) => sum + si.qty, 0)}
                      </span>
                    </td>
                    <td style={{...inManagementStyles.tableCell, textAlign: 'center'}}>
                      <Button
                        variant="danger"
                        onClick={() => {
                          const newItems = scannedItems.filter((_, i) => i !== index)
                          setScannedItems(newItems)
                        }}
                        style={{ padding: '4px 12px', fontSize: '12px', fontWeight: 'bold' }}
                      >
                        삭제
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={inManagementStyles.emptyMessage}>
              스캔된 데이터가 없습니다
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default InManagement