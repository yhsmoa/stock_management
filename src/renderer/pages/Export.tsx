import React, { useState, useRef, useEffect, useMemo } from 'react'
import Button from '../components/common/Button'
import ExportTable from '../components/export/ExportTable'
import type { Export as ExportType } from '../types/export'
import * as XLSX from 'xlsx'
import { supabase } from '../services/supabase'
import {
  fetchCoupangReturns,
  fetchCoupangItemByOptionId,
  fetchStockLocationByBarcode,
  CoupangReturn,
} from '../services/supabase'

const Export: React.FC = () => {
  // ── 테이블 표시 데이터 ────────────────────────────────────────────
  const [exportData, setExportData] = useState<ExportType[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // ── UI 상태 ──────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false)
  const [location, setLocation] = useState('')
  const [qBarcode, setQBarcode] = useState('')
  const [preciseQBarcode, setPreciseQBarcode] = useState('')  // 정밀 Q 바코드
  const [activeInput, setActiveInput] = useState<string | null>(null)

  // ── 업로드 상태 ──────────────────────────────────────────────────
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStatus, setUploadStatus] = useState('')

  const fileInputRef       = useRef<HTMLInputElement>(null)
  const qBarcodeRef        = useRef<HTMLInputElement>(null)
  const preciseQBarcodeRef = useRef<HTMLInputElement>(null)

  /**
   * si_coupang_returns 전체 조회 캐시 (최근 3개월)
   * - 페이지 로드 시 한 번만 fetch
   * - Q바코드 / 정밀 Q 바코드 스캔 시 STEP 1을 메모리에서 수행 (DB 재조회 없음)
   * - si_coupang_items는 로드하지 않음 (메모리 절약)
   */
  const [coupangReturns, setCoupangReturns] = useState<CoupangReturn[]>([])

  // ── 쿠팡반품 XLSX 업로드 ─────────────────────────────────────────
  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    setUploadProgress(0)
    setUploadStatus('파일을 읽는 중...')

    try {
      // localStorage에서 사용자 UUID 조회 (si_users.id)
      const userStr = localStorage.getItem('user')
      const user = userStr ? JSON.parse(userStr) : null
      const userId = user?.id as string | undefined

      if (!userId) {
        console.error('사용자 UUID를 찾을 수 없습니다. 재로그인 필요')
        setUploadStatus('로그인 정보를 찾을 수 없습니다. 다시 로그인해주세요.')
        setTimeout(() => { setIsUploading(false); setUploadProgress(0); setUploadStatus('') }, 3000)
        return
      }

      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data)
      const worksheet = workbook.Sheets[workbook.SheetNames[0]]
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

      console.log('Total rows in Excel:', jsonData.length)
      console.log('Using user_id:', userId)

      // 8행부터 데이터 시작 (인덱스 7)
      const dataRows = jsonData.slice(7) as any[][]
      console.log('Data rows to process:', dataRows.length)
      setUploadStatus(`총 ${dataRows.length}개 데이터 처리 중...`)

      let totalInserted = 0
      let totalErrors = 0
      const errorDetails: string[] = []

      // 전체 행 파싱 후 order_id 기준 중복 제거 (마지막 항목 유지)
      const allItems = dataRows
        .filter(row => row[4]) // order_id (E열) 필수
        .map(row => ({
          type:           row[2]  ? String(row[2]).trim()  : '',   // C열
          return_id:      row[3]  ? String(row[3]).trim()  : null, // D열
          order_id:       String(row[4]).trim(),                   // E열 (primary key)
          option_id:      row[5]  ? String(row[5]).trim()  : null, // F열
          item_name:      row[6]  ? String(row[6]).trim()  : null, // G열
          return_reason:  row[7]  ? String(row[7]).trim()  : null, // H열
          q_barcode:      row[8]  ? String(row[8]).trim()  : null, // I열
          quality_grade:  row[9]  ? String(row[9]).trim()  : null, // J열
          status:         row[10] ? String(row[10]).trim() : null, // K열
          apply_date:     row[1]  || null,                         // B열
          user_id:        userId,
        }))

      const uniqueItemsMap = new Map<string, typeof allItems[0]>()
      allItems.forEach(item => uniqueItemsMap.set(item.order_id, item))
      const uniqueItems = Array.from(uniqueItemsMap.values())

      console.log(`전체 행: ${dataRows.length}, 유효: ${allItems.length}, 중복 제거 후: ${uniqueItems.length}`)
      setUploadStatus('기존 데이터 확인 중...')

      // 기존 order_id 확인 — 100개씩 배치 (URL 길이 제한 회피)
      const orderIds = uniqueItems.map(item => item.order_id)
      const CHECK_BATCH = 100
      const existingOrderIds = new Set<string>()

      for (let i = 0; i < orderIds.length; i += CHECK_BATCH) {
        const batchIds = orderIds.slice(i, i + CHECK_BATCH)
        const { data: batchData, error: checkError } = await supabase
          .from('si_coupang_returns')
          .select('order_id')
          .eq('user_id', userId)
          .in('order_id', batchIds)

        if (checkError) {
          console.error('기존 데이터 조회 오류:', checkError)
          setUploadStatus('기존 데이터 조회 중 오류가 발생했습니다.')
          setTimeout(() => { setIsUploading(false); setUploadProgress(0); setUploadStatus('') }, 3000)
          return
        }

        batchData?.forEach(item => existingOrderIds.add(item.order_id))
      }

      // 신규 데이터만 필터링
      const newItems = uniqueItems.filter(item => !existingOrderIds.has(item.order_id))
      const skippedCount = uniqueItems.length - newItems.length
      console.log(`기존: ${skippedCount}개 스킵, 신규 삽입: ${newItems.length}개`)

      if (newItems.length === 0) {
        setUploadStatus(`모든 데이터가 이미 존재합니다. (${skippedCount}개 스킵)`)
        setTimeout(() => { setIsUploading(false); setUploadProgress(0); setUploadStatus('') }, 3000)
        return
      }

      setUploadStatus(`총 ${newItems.length}개 신규 데이터 처리 중... (${skippedCount}개 스킵)`)

      // 100개씩 배치 INSERT
      const INSERT_BATCH = 100
      for (let i = 0; i < newItems.length; i += INSERT_BATCH) {
        const items = newItems.slice(i, Math.min(i + INSERT_BATCH, newItems.length))
        if (!items.length) continue

        try {
          const { error } = await supabase.from('si_coupang_returns').insert(items)

          if (error) {
            console.error(`배치 ${Math.floor(i / INSERT_BATCH) + 1} insert error:`, error)
            errorDetails.push(`배치 ${Math.floor(i / INSERT_BATCH) + 1}: ${error.message}`)
            totalErrors += items.length
          } else {
            totalInserted += items.length
          }
        } catch (err) {
          console.error(`배치 ${Math.floor(i / INSERT_BATCH) + 1} 예외:`, err)
          errorDetails.push(`배치 ${Math.floor(i / INSERT_BATCH) + 1}: 예상치 못한 오류`)
          totalErrors += items.length
        }

        const progress = Math.round((i + items.length) / newItems.length * 100)
        setUploadProgress(progress)
        setUploadStatus(
          `업로드 중... ${i + items.length}/${newItems.length} (성공: ${totalInserted}, 실패: ${totalErrors}, 스킵: ${skippedCount})`
        )

        await new Promise(resolve => setTimeout(resolve, 50))
      }

      console.log(`업로드 완료 — 성공: ${totalInserted}, 실패: ${totalErrors}, 스킵: ${skippedCount}`)
      if (errorDetails.length) console.log('에러 상세:', errorDetails)

      setUploadStatus(`업로드 완료! 성공: ${totalInserted}개, 실패: ${totalErrors}개, 스킵: ${skippedCount}개`)
      setTimeout(() => { setIsUploading(false); setUploadProgress(0); setUploadStatus('') }, 3000)

      if (fileInputRef.current) fileInputRef.current.value = ''

      // 업로드 후 Q바코드 lookup 캐시 갱신
      const freshReturns = await fetchCoupangReturns()
      setCoupangReturns(freshReturns)

    } catch (error) {
      console.error('Upload error:', error)
      setUploadStatus('업로드 중 오류가 발생했습니다.')
      setTimeout(() => { setIsUploading(false); setUploadProgress(0); setUploadStatus('') }, 3000)
    }
  }

  // ── 삭제 버튼 — 체크된 행을 exportData에서 제거 ──────────────────
  const handleDeleteSelected = () => {
    if (!selectedIds.length) return
    setExportData(prev => prev.filter(item => !selectedIds.includes(item.id)))
  }

  /**
   * 클립보드에 TSV 문자열을 복사
   * Electron 렌더러 프로세스에서는 navigator.clipboard 가 미지원이므로
   * textarea + execCommand('copy') 폴백 방식 사용
   * @param tsv - 탭 구분 값 문자열 (구글 시트 직접 붙여넣기 가능)
   */
  const copyToClipboard = (tsv: string) => {
    const el = document.createElement('textarea')
    el.value = tsv
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0'
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
  }

  /**
   * 라벨(기본) — 현재 테이블 표시 순서 그대로 클립보드 복사
   * 열 순서: 바코드 \t 상품명 \t 개수
   * (reversedExportData = 최신 스캔이 위에 오는 순서)
   */
  const handleLabelBasic = () => {
    if (!reversedExportData.length) return

    const tsv = reversedExportData
      .map(item => `${item.barcode}\t${item.itemName}\t${item.qty}`)
      .join('\n')

    copyToClipboard(tsv)
  }

  // 분류 정렬 기준 — CoupangManagement.tsx 의 PACKAGE_TYPE_OPTIONS 순서와 동일
  const PACKAGE_TYPE_ORDER = ['출고', '렉', '박스', '시즌오프', '폐기', '기타']

  /**
   * 라벨(정렬) — 분류(packageType) 기준으로 그룹핑 후 클립보드 복사
   *
   * 구조:
   *   [구분 행] 바코드=S00000, 상품명=분류이름, 개수=1
   *   [데이터 행] 바코드 \t 상품명 \t 개수
   *   ... (해당 분류 전체)
   *   [구분 행] 다음 분류 ...
   *
   * 정렬 우선순위: PACKAGE_TYPE_ORDER 배열 순서
   * packageType 이 null 인 항목은 '기타' 그룹에 포함
   */
  const handleLabelSorted = () => {
    if (!exportData.length) return

    // ── STEP 1: 분류별 그룹핑 ────────────────────────────────────
    const groupMap = new Map<string, ExportType[]>()
    exportData.forEach(item => {
      const key = item.packageType || '기타'
      if (!groupMap.has(key)) groupMap.set(key, [])
      groupMap.get(key)!.push(item)
    })

    // ── STEP 2: 분류 키 정렬 (PACKAGE_TYPE_ORDER 기준, 미정의 분류는 뒤로) ──
    const sortedKeys = Array.from(groupMap.keys()).sort((a, b) => {
      const ai = PACKAGE_TYPE_ORDER.indexOf(a)
      const bi = PACKAGE_TYPE_ORDER.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b, 'ko')
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })

    // ── STEP 3: 구분 행 + 데이터 행 조합 ────────────────────────
    const rows: string[] = []
    sortedKeys.forEach(key => {
      // 분류 구분 행: 바코드=S00000, 상품명=분류이름, 개수=1
      rows.push(`S00000\t${key}\t1`)
      // 해당 분류에 속하는 아이템 행
      groupMap.get(key)!.forEach(item => {
        rows.push(`${item.barcode}\t${item.itemName}\t${item.qty}`)
      })
    })

    copyToClipboard(rows.join('\n'))
  }

  /**
   * 페이지 초기 데이터 로드
   * - si_coupang_returns (최근 3개월)만 캐시 — Q바코드 스캔 STEP 1 lookup용
   * - si_coupang_items는 로드하지 않음 (메모리 절약, 정밀 스캔 시 on-demand 조회)
   */
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      try {
        const returns = await fetchCoupangReturns()
        setCoupangReturns(returns)
      } catch (error) {
        console.error('Error loading coupang returns:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  // ── 입력 포커스 핸들러 ───────────────────────────────────────────
  const handleInputFocus = (inputType: string, currentValue: string) => {
    setActiveInput(inputType)
    if (inputType === 'location'      && currentValue) setLocation('')
    if (inputType === 'qBarcode'      && currentValue) setQBarcode('')
    if (inputType === 'preciseQBarcode' && currentValue) setPreciseQBarcode('')
  }

  // ── Q바코드 Enter 핸들러 ─────────────────────────────────────────
  const handleQBarcodeKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && qBarcode.trim()) {
      processQBarcode(qBarcode.trim())
    }
  }

  // ── 정밀 Q 바코드 Enter 핸들러 ───────────────────────────────────
  const handlePreciseQBarcodeKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && preciseQBarcode.trim()) {
      processPreciseQBarcode(preciseQBarcode.trim())
    }
  }

  /**
   * Q바코드 스캔 처리 (캐시 기반 — 빠름)
   * - STEP 1: coupangReturns 메모리 캐시에서 q_barcode 조회
   * - 테이블 바코드 컬럼 = 스캔한 Q바코드 값
   * - 동일 location + Q바코드 재스캔 → qty +1
   */
  const processQBarcode = (scannedQBarcode: string) => {
    const returnItem = coupangReturns.find(ret => ret.q_barcode === scannedQBarcode)
    if (!returnItem) return

    addToExportTable({
      barcode:      scannedQBarcode,        // Q바코드 자체를 바코드 컬럼에 저장
      itemName:     returnItem.item_name || '-',
      qualityGrade: returnItem.quality_grade,
      returnReason: returnItem.return_reason,
    })

    setQBarcode('')
    setTimeout(() => qBarcodeRef.current?.focus(), 0)
  }

  /**
   * 정밀 Q 바코드 스캔 처리 (3-step DB 체인 조회)
   *
   * STEP 1: coupangReturns 메모리 캐시에서 q_barcode 조회
   *         → option_id, item_name, quality_grade, return_reason
   *         (DB 호출 없음 — 페이지 로드 시 이미 캐시됨)
   *
   * STEP 2: si_coupang_items에서 option_id로 상품 조회
   *         → barcode, item_name, option_name
   *         (user_id + barcode IS NOT NULL 필터로 최속 조회)
   *
   * STEP 3: si_stocks에서 barcode로 재고 위치 조회
   *         → location
   *         (user_id + location IS NOT NULL 필터, LIMIT 1)
   *
   * 결과: 로케이션 입력폼 자동 설정 + 테이블에 행 추가/수량 증가
   */
  const processPreciseQBarcode = async (scannedQBarcode: string) => {
    // 사용자 UUID 가져오기
    const userStr = localStorage.getItem('user')
    const user = userStr ? JSON.parse(userStr) : null
    const userId = user?.id as string | undefined
    if (!userId) return

    // ── STEP 1: 메모리 캐시에서 q_barcode 조회 ────────────────────
    const returnItem = coupangReturns.find(ret => ret.q_barcode === scannedQBarcode)
    if (!returnItem?.option_id) return

    // ── STEP 2: si_coupang_items에서 option_id → barcode 조회 ────
    const coupangItem = await fetchCoupangItemByOptionId(returnItem.option_id, userId)
    if (!coupangItem?.barcode) return

    // ── STEP 3: si_stocks에서 barcode → location 조회 ────────────
    const foundLocation = await fetchStockLocationByBarcode(coupangItem.barcode, userId)

    // 위치 자동 설정 (발견된 경우만)
    if (foundLocation) setLocation(foundLocation)

    // 테이블에 추가 (location은 DB에서 찾은 값 우선, package_type은 si_coupang_items에서 조회)
    addToExportTable({
      barcode:          coupangItem.barcode,
      itemName:         `${coupangItem.item_name}, ${coupangItem.option_name}`,
      qualityGrade:     returnItem.quality_grade,
      returnReason:     returnItem.return_reason,
      locationOverride: foundLocation,
      packageType:      coupangItem.package_type,
    })

    setPreciseQBarcode('')
    setTimeout(() => preciseQBarcodeRef.current?.focus(), 0)
  }

  /**
   * 반출 테이블에 항목 추가 / 수량 증가
   * - 동일 (location + barcode) 조합이 이미 있으면 qty +1
   * - 없으면 qty = 1로 신규 추가
   *
   * @param locationOverride - 정밀 Q 바코드 모드에서 DB 조회된 location을 직접 지정
   *                           undefined면 location state 값 사용 (일반 Q 바코드 모드)
   */
  const addToExportTable = (data: {
    barcode:           string
    itemName:          string
    qualityGrade:      string | null
    returnReason:      string | null
    locationOverride?: string | null
    packageType?:      string | null  // 정밀 Q 바코드 모드에서 si_coupang_items.package_type
  }) => {
    const effectiveLocation =
      data.locationOverride !== undefined ? data.locationOverride : (location || null)

    setExportData(prevData => {
      const existingIndex = prevData.findIndex(
        item => item.location === effectiveLocation && item.barcode === data.barcode
      )

      if (existingIndex >= 0) {
        const newData = [...prevData]
        newData[existingIndex] = { ...newData[existingIndex], qty: newData[existingIndex].qty + 1 }
        return newData
      }

      const newItem: ExportType = {
        id:           `${Date.now()}-${Math.random()}`,
        packageType:  data.packageType ?? null,
        location:     effectiveLocation,
        barcode:      data.barcode,
        itemName:     data.itemName,
        qty:          1,
        qualityGrade: data.qualityGrade,
        returnReason: data.returnReason,
      }
      return [...prevData, newItem]
    })
  }

  // 매 렌더마다 새 배열 참조가 생성되지 않도록 메모이제이션
  // (새 참조 → ExportTable useEffect([data]) 재실행 → onSelectionChange([]) → 무한 루프)
  const reversedExportData = useMemo(() => [...exportData].reverse(), [exportData])

  // ── 스타일 ────────────────────────────────────────────────────────
  const styles = {
    container: {
      padding: '20px',
    },
    headerRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '20px',
    },
    header: {
      fontSize: '28px',
      color: '#333',
      margin: 0,
    },
    buttonContainer: {
      display: 'flex',
      gap: '10px',
    },
    inputFormContainer: {
      backgroundColor: 'white',
      borderRadius: '8px',
      padding: '20px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      marginBottom: '20px',
    },
    // 로케이션 | Q바코드 | 정밀 Q바코드 — 3컬럼 레이아웃
    inputRow: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: '15px',
    },
    inputWrapper: {
      position: 'relative' as const,
    },
    input: {
      width: '100%',
      padding: '24px 12px',
      borderColor: '#d0d0d0',
      borderWidth: '2px',
      borderStyle: 'solid',
      borderRadius: '4px',
      fontSize: '30px',
      transition: 'all 0.3s',
      outline: 'none',
      boxSizing: 'border-box' as const,
      textAlign: 'center' as const,
      caretColor: 'transparent',
    },
    inputActive: {
      borderColor: '#4CAF50',
      borderWidth: '3px',
    },
    /** 정밀 Q 바코드 — 활성 시 파란색 테두리로 일반 Q 바코드와 구분 */
    inputActivePrecise: {
      borderColor: '#007bff',
      borderWidth: '3px',
    },
    hiddenFileInput: {
      display: 'none',
    },
  }

  return (
    <div style={styles.container}>
      {/* 헤더 & 버튼 */}
      <div style={styles.headerRow}>
        <h1 style={styles.header}>반출건관리</h1>
        <div style={styles.buttonContainer}>
          <Button
            variant="primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            쿠팡반품 XLSX
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleExcelUpload}
            style={styles.hiddenFileInput}
          />
          <Button variant="danger" onClick={handleDeleteSelected}>
            삭제
          </Button>
          <span style={{ alignSelf: 'center', color: '#d1d5db', fontSize: '18px', userSelect: 'none' }}>|</span>
          <Button variant="secondary" onClick={handleLabelBasic}>
            라벨(기본)
          </Button>
          <Button variant="secondary" onClick={handleLabelSorted}>
            라벨(정렬)
          </Button>

        </div>
      </div>

      {/* 입력 폼 — 로케이션 | Q바코드 | 정밀 Q바코드 */}
      <div style={styles.inputFormContainer}>
        <div style={styles.inputRow}>

          {/* 로케이션 입력 */}
          <div style={styles.inputWrapper}>
            <input
              type="text"
              placeholder="로케이션"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              onFocus={() => handleInputFocus('location', location)}
              onBlur={() => setActiveInput(null)}
              style={{
                ...styles.input,
                ...(activeInput === 'location' ? styles.inputActive : {}),
              }}
            />
          </div>

          {/* Q바코드 입력 — 캐시 기반 빠른 스캔 */}
          <div style={styles.inputWrapper}>
            <input
              ref={qBarcodeRef}
              type="text"
              placeholder="Q 바코드"
              value={qBarcode}
              onChange={(e) => setQBarcode(e.target.value)}
              onKeyPress={handleQBarcodeKeyPress}
              onFocus={() => handleInputFocus('qBarcode', qBarcode)}
              onBlur={() => setActiveInput(null)}
              style={{
                ...styles.input,
                ...(activeInput === 'qBarcode' ? styles.inputActive : {}),
              }}
            />
          </div>

          {/* 정밀 Q 바코드 입력 — 3-step DB 조회 (barcode + location 자동 설정) */}
          <div style={styles.inputWrapper}>
            <input
              ref={preciseQBarcodeRef}
              type="text"
              placeholder="정밀 Q 바코드"
              value={preciseQBarcode}
              onChange={(e) => setPreciseQBarcode(e.target.value)}
              onKeyPress={handlePreciseQBarcodeKeyPress}
              onFocus={() => handleInputFocus('preciseQBarcode', preciseQBarcode)}
              onBlur={() => setActiveInput(null)}
              style={{
                ...styles.input,
                ...(activeInput === 'preciseQBarcode' ? styles.inputActivePrecise : {}),
              }}
            />
          </div>

        </div>
      </div>

      {/* 반출 테이블 — 최신 스캔 항목이 위에 오도록 역순 표시 */}
      <ExportTable
        data={reversedExportData}
        loading={loading}
        onSelectionChange={setSelectedIds}
      />

      {/* 업로드 진행 모달 */}
      {isUploading && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999,
        }}>
          <div style={{
            backgroundColor: 'white', borderRadius: '8px',
            padding: '30px', minWidth: '400px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#333' }}>
              엑셀 업로드 중
            </h3>
            <div style={{ marginBottom: '15px' }}>
              <div style={{
                width: '100%', height: '30px',
                backgroundColor: '#e0e0e0', borderRadius: '15px', overflow: 'hidden',
              }}>
                <div style={{
                  width: `${uploadProgress}%`, height: '100%',
                  backgroundColor: '#4CAF50', transition: 'width 0.3s ease',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'white', fontWeight: 'bold',
                }}>
                  {uploadProgress}%
                </div>
              </div>
            </div>
            <p style={{ textAlign: 'center', color: '#666', marginBottom: 0 }}>
              {uploadStatus}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default Export
