/* ================================================================
   로켓그로스 출고 (RocketShipment) — 커스텀 훅
   - xlsx 등록(파싱+조인), 사이즈 탭 필터, 체크박스 선택,
     그로스 입고 xlsx 생성
   ================================================================ */

import { useCallback, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  parseOutboundExcel,
  enrichOutboundRows,
  buildGrowthInboundWorkbook,
  expectedSize,
  SIZES,
  type SizeTab,
  type RocketShipmentRow,
} from '../services/rocketShipmentService'
import { parseShipmentSizeExcel, saveShipmentSize } from '../services/purchaseService'

// ── 테이블 컬럼 정의 (위치·등록id·옵션id·바코드·상품명·옵션명·입고수량·쿠팡사이즈) ──
export const COLUMNS = [
  { key: 'location',    label: '위치',      width: '90px'  },
  { key: 'itemId',      label: '등록id',    width: '90px'  },
  { key: 'optionId',    label: '옵션id',    width: '90px'  },
  { key: 'barcode',     label: '바코드',    width: '130px' },
  { key: 'itemName',    label: '상품명',    width: '250px' },
  { key: 'optionName',  label: '옵션명',    width: '140px' },
  { key: 'quantity',    label: '입고수량',  width: '70px'  },
  { key: 'coupangSize', label: '쿠팡사이즈', width: '80px'  },
] as const

// ── 사용자 ID (localStorage) ──────────────────────────────────────
function getUserId(): string | null {
  const raw = localStorage.getItem('user')
  if (!raw) return null
  try {
    return JSON.parse(raw)?.id ?? null
  } catch {
    return null
  }
}

export function useRocketShipment() {
  const [rows, setRows] = useState<RocketShipmentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 사이즈 탭 (Small/Medium/Large) — 기본 Small ──────────────
  const [tab, setTab] = useState<SizeTab>('Small')
  // 선택된 행 (rows 원본 인덱스 집합)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [generating, setGenerating] = useState(false)

  // ── 쉽먼트 사이즈 xlsx (사입관리와 동일: si_coupang_shipment_size upsert) ──
  const [shipmentSizeUploading, setShipmentSizeUploading] = useState(false)
  const shipmentSizeInputRef = useRef<HTMLInputElement>(null)

  // ── xlsx 등록: 파일 읽기 → 파싱 → 조인 → 테이블 반영 ──────────
  const handleXlsxUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // 같은 파일 재선택 허용

    const userId = getUserId()
    if (!userId) {
      alert('로그인 정보를 확인해 주세요.')
      return
    }

    setLoading(true)
    setError('')
    setFileName(file.name)
    setSelected(new Set())
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' })

      const parsed = parseOutboundExcel(aoa)
      if (parsed.length === 0) {
        setRows([])
        setError('엑셀에서 바코드가 있는 데이터를 찾지 못했습니다.')
        return
      }

      const enriched = await enrichOutboundRows(userId, parsed)
      setRows(enriched)
    } catch (err: any) {
      console.error('[로켓그로스 출고] xlsx 등록 실패:', err)
      setError(`등록 실패: ${err?.message ?? err}`)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  // ── 쉽먼트 사이즈 xlsx 업로드 (사입관리 handleShipmentSizeExcelUpload 동일 로직) ──
  const handleShipmentSizeUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const userId = getUserId()
    if (!userId) {
      alert('로그인 정보를 확인해 주세요.')
      return
    }

    setShipmentSizeUploading(true)
    try {
      // 파일 읽기 → 시트 검증/파싱 → 배치 upsert
      const binaryStr = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (ev) => resolve(ev.target?.result as string)
        reader.onerror = () => reject(new Error('파일 읽기 실패'))
        reader.readAsBinaryString(file)
      })
      const workbook = XLSX.read(binaryStr, { type: 'binary' })
      const { items, skippedRows } = parseShipmentSizeExcel(workbook, userId)

      if (items.length === 0 && skippedRows.length === 0) {
        alert('업로드할 데이터가 없습니다. 엑셀 파일을 확인해주세요.')
        return
      }

      const { success, errors } = await saveShipmentSize(items, userId)

      let message = `쉽먼트 사이즈 업로드 완료!\n성공: ${success.toLocaleString()}건, 실패: ${errors.toLocaleString()}건`
      if (skippedRows.length > 0) {
        const SKIP_PREVIEW = 50
        const preview = skippedRows.slice(0, SKIP_PREVIEW).join(', ')
        const suffix = skippedRows.length > SKIP_PREVIEW ? ` ...외 ${skippedRows.length - SKIP_PREVIEW}건` : ''
        message += `\n\noption_id 누락으로 스킵된 행:\n${preview}행${suffix}`
      }
      alert(message)
    } catch (err: any) {
      console.error('[쉽먼트 사이즈 xlsx] 실패:', err)
      alert(`쉽먼트 사이즈 업로드 중 오류가 발생했습니다.\n${err?.message ?? ''}`)
    } finally {
      setShipmentSizeUploading(false)
    }
  }, [])

  // ── 현재 탭 필터 (위치의 박스코드 → 사이즈. A=Small/B=Medium/C=Large,
  //    P·X 등은 어느 탭에도 안 걸림). 원본 인덱스 유지 ────────
  const filtered = useMemo(
    () =>
      rows
        .map((row, idx) => ({ row, idx }))
        .filter(({ row }) => expectedSize(row.location) === tab),
    [rows, tab],
  )

  // ── 탭별 건수 (배지) — 박스코드 기준 ─────────────────────────
  const tabCounts = useMemo(() => {
    const c: Record<SizeTab, number> = { Small: 0, Medium: 0, Large: 0 }
    for (const r of rows) {
      const key = SIZES.find((sz) => sz === expectedSize(r.location))
      if (key) c[key]++
    }
    return c
  }, [rows])

  // ── 체크박스 ──────────────────────────────────────────────────
  const isAllSelected = filtered.length > 0 && filtered.every(({ idx }) => selected.has(idx))

  const handleSelectAll = useCallback((checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const { idx } of filtered) {
        if (checked) next.add(idx)
        else next.delete(idx)
      }
      return next
    })
  }, [filtered])

  const handleSelectRow = useCallback((idx: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(idx)
      else next.delete(idx)
      return next
    })
  }, [])

  const changeTab = useCallback((t: SizeTab) => setTab(t), [])

  // ── [그로스 입고 xlsx 생성]: 현재 탭의 체크된 행만 → 파일 다운로드 ──
  const handleGenerate = useCallback(() => {
    const targets = filtered.filter(({ idx }) => selected.has(idx)).map(({ row }) => row)
    if (targets.length === 0) {
      alert('생성할 행을 체크해 주세요. (현재 탭에서 체크된 행만 처리됩니다)')
      return
    }
    setGenerating(true)
    try {
      const wb = buildGrowthInboundWorkbook(targets)
      const today = new Date().toISOString().slice(0, 10)
      XLSX.writeFile(wb, `로켓그로스 입고 (${tab}, ${today}).xlsx`)
    } catch (err: any) {
      console.error('[로켓그로스 출고] xlsx 생성 실패:', err)
      alert(`xlsx 생성 실패: ${err?.message ?? err}`)
    } finally {
      setGenerating(false)
    }
  }, [filtered, selected, tab])

  return {
    rows,
    filtered,
    loading,
    error,
    fileName,
    fileInputRef,
    handleXlsxUpload,
    // 쉽먼트 사이즈 xlsx
    shipmentSizeUploading,
    shipmentSizeInputRef,
    handleShipmentSizeUpload,
    // 탭
    tab,
    changeTab,
    tabCounts,
    // 체크박스
    selected,
    isAllSelected,
    handleSelectAll,
    handleSelectRow,
    // 생성
    generating,
    handleGenerate,
  }
}
