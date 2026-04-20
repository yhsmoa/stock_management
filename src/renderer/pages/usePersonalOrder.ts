/* ================================================================
   개인주문 페이지 — 커스텀 훅
   - 상태 관리, 데이터 로드, 핸들러, 필터/페이지네이션 로직
   ================================================================ */

import { useState, useMemo, useCallback, useEffect } from 'react'
import * as XLSX from 'xlsx'
import {
  fetchAllOrdersheets,
  mapOrderToRows,
  savePersonalOrders,
  fetchPersonalOrders,
  acknowledgeOrders,
  updateOrderStatusToInstruct,
  STATUS_MAP,
  STATUS_REVERSE_MAP,
  type PersonalOrderRow,
} from '../services/personalOrderService'
import {
  fetchFulfillmentData,
  EMPTY_AGG,
  type FulfillmentAgg,
  type OrderItemDetail,
} from '../services/orderFulfillmentService'
import {
  fetchRgItemsWithBarcode,
  matchBarcodes,
  saveBarcodes,
} from '../services/barcodeMatchingService'
import {
  parsePdfInvoices,
  splitAndUploadPages,
  printMultipleInvoices,
} from '../services/invoiceService'
import type { ProgressStep } from '../components/common/ProgressModal'
import type { AuthUser } from '../types/auth'

// ── 상수 ──────────────────────────────────────────────────────────
export const PAGE_SIZE = 100

/** 주문 상태 탭 */
export const ORDER_STATUS_TABS = [
  '전체',
  '결제완료',
  '상품준비중',
  '배송지시',
  '배송중',
  '배송완료',
  '업체직송',
] as const

export type OrderStatusTab = (typeof ORDER_STATUS_TABS)[number]

/** 테이블 컬럼 정의 */
export const COLUMNS = [
  { key: 'order_id',       label: '주문번호',  width: '70px'  },
  { key: 'seller_product_id', label: '등록id', width: '70px'  },
  { key: 'vendor_item_id', label: '옵션id',    width: '70px'  },
  { key: 'barcode',        label: '바코드',    width: '70px'  },
  { key: 'product_info',   label: '상품정보',  width: '280px' },
  { key: 'receiver_name',  label: '수취인',    width: '80px'  },
  { key: 'shipping_count', label: '수량',      width: '50px'  },
  { key: 'status_label',   label: '주문상태',  width: '70px'  },
  { key: 'estimated_shipping_date', label: '출고예정', width: '60px' },
  { key: 'ordered_at_label', label: '주문일시', width: '60px' },
  { key: 'ff_status',      label: '상태',      width: '20px'  },
  { key: 'ff_arrival',     label: '입고',      width: '20px'  },
  { key: 'ff_packed',      label: '포장',      width: '20px'  },
  { key: 'ff_cancel',      label: '취소',      width: '20px'  },
  { key: 'ff_shipped',     label: '출고',      width: '20px'  },
] as const

// ── 상태 점 설정 ──────────────────────────────────────────────────
export type StatusType = 'green' | 'red' | 'gray' | 'none'

export const STATUS_DOT_LABELS: Record<StatusType, string> = {
  green: '포장완료',
  red: '전량취소',
  gray: '미발송',
  none: '미주문',
}

// ── 유틸 ──────────────────────────────────────────────────────────

/** 날짜 포맷 (yyyy-MM-dd HH:mm) */
export function formatDateTime(isoStr: string | null): string {
  if (!isoStr) return ''
  try {
    const d = new Date(isoStr)
    const yyyy = d.getFullYear()
    const MM = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const HH = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${yyyy}-${MM}-${dd} ${HH}:${mm}`
  } catch {
    return ''
  }
}

/** 행 데이터 → 테이블 표시용 값 추출 */
export function getCellValue(row: PersonalOrderRow, key: string): string {
  switch (key) {
    case 'product_info':
      return row.item_name + (row.option_name ? ` / ${row.option_name}` : '')
    case 'status_label':
      return STATUS_MAP[row.status] ?? row.status
    case 'ordered_at_label':
      return formatDateTime(row.ordered_at)
    case 'estimated_shipping_date':
      return row.estimated_shipping_date ?? ''
    default:
      return String((row as any)[key] ?? '')
  }
}

// ── 드로어 선택 아이템 타입 ─────────────────────────────────────────
export interface DrawerItemState {
  id: string
  itemName: string | null
  optionName: string | null
  orderNo: string | null
  itemNo: string | null
  productNo: string | null
}

// ══════════════════════════════════════════════════════════════════
// 커스텀 훅
// ══════════════════════════════════════════════════════════════════

export function usePersonalOrder() {
  // ── 상태 ──────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<OrderStatusTab>('전체')
  const [searchValue, setSearchValue] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [items, setItems] = useState<PersonalOrderRow[]>([])
  const [loading, setLoading] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [acknowledging, setAcknowledging] = useState(false)
  const [showUnorderedOnly, setShowUnorderedOnly] = useState(false)

  // ── fulfillment 상태 ──────────────────────────────────────────
  const [aggMap, setAggMap] = useState<Map<string, FulfillmentAgg>>(new Map())
  const [orderItemMap, setOrderItemMap] = useState<Map<string, OrderItemDetail>>(new Map())

  // ── 드로어 선택 상태 ──────────────────────────────────────────
  const [selectedDrawerItem, setSelectedDrawerItem] = useState<DrawerItemState | null>(null)

  // ── 진행 모달 상태 (업데이트/바코드연결/송장연결 공용) ─────
  const [progressOpen, setProgressOpen] = useState(false)
  const [progressTitle, setProgressTitle] = useState('처리 중')
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([])
  const [progressStatus, setProgressStatus] = useState('')

  /**
   * 단계 배열의 idx 번째를 state 로, detail 로 갱신 (immutable)
   * - 이전 단계가 pending 이면 자동으로 done 처리 (선형 진행 가정)
   */
  const updateStep = useCallback(
    (idx: number, state: ProgressStep['state'], detail?: string) => {
      setProgressSteps((prev) => {
        if (!prev[idx]) return prev
        return prev.map((s, i) => {
          if (i < idx && s.state === 'pending') return { ...s, state: 'done' }
          if (i === idx) return { ...s, state, detail }
          return s
        })
      })
    },
    [],
  )

  /** 모달 닫기 + 상태 초기화 */
  const closeProgress = useCallback(() => {
    setProgressOpen(false)
    setProgressSteps([])
    setProgressStatus('')
  }, [])

  // ── 사용자 정보 ───────────────────────────────────────────────
  const getUserInfo = useCallback((): { userId: string; vendorId: string; orderUserId: string } => {
    const raw = localStorage.getItem('user')
    if (!raw) return { userId: '', vendorId: '', orderUserId: '' }
    const user: AuthUser = JSON.parse(raw)
    return {
      userId: user.id ?? '',
      vendorId: user.vendor_id ?? '',
      orderUserId: user.order_user_id ?? '',
    }
  }, [])

  // ── fulfillment 집계 헬퍼 ────────────────────────────────────
  const getAgg = useCallback((orderId: string | null): FulfillmentAgg => {
    if (!orderId) return EMPTY_AGG
    return aggMap.get(orderId) ?? EMPTY_AGG
  }, [aggMap])

  // ── 상태 점 판별 ──────────────────────────────────────────────
  const getRowStatus = useCallback((row: PersonalOrderRow): StatusType => {
    const agg = getAgg(row.order_id)
    const qty = row.shipping_count ?? 0
    if (qty > 0 && agg.cancel >= qty) return 'red'
    if (agg.packed > 0) return 'green'
    if (row.order_id && orderItemMap.has(row.order_id)) return 'gray'
    return 'none'
  }, [getAgg, orderItemMap])

  // ── fulfillment 데이터 로드 ─────────────────────────────────────
  const loadFulfillmentData = useCallback(async (orderRows: PersonalOrderRow[]) => {
    const { orderUserId } = getUserInfo()
    if (!orderUserId || orderRows.length === 0) {
      setAggMap(new Map())
      setOrderItemMap(new Map())
      return
    }

    try {
      const orderIds = Array.from(new Set(orderRows.map((r) => r.order_id).filter(Boolean)))
      const result = await fetchFulfillmentData(orderIds, orderUserId)
      setAggMap(result.aggMap)
      setOrderItemMap(result.orderItemMap)
    } catch (err) {
      console.error('[PersonalOrder] fulfillment 조회 실패:', err)
    }
  }, [getUserInfo])

  // ── 초기 데이터 로드 ──────────────────────────────────────────
  useEffect(() => {
    const loadData = async () => {
      const { userId } = getUserInfo()
      if (!userId) return
      setLoading(true)
      try {
        const data = await fetchPersonalOrders(userId)
        setItems(data)
        await loadFulfillmentData(data)
      } catch (err) {
        console.error('데이터 로드 실패:', err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [getUserInfo, loadFulfillmentData])

  // ── [업데이트] 핸들러 ─────────────────────────────────────────
  const handleUpdate = useCallback(async () => {
    const { userId, vendorId } = getUserInfo()
    if (!userId || !vendorId) {
      alert('로그인 정보를 확인해 주세요.')
      return
    }

    // ── 진행 모달 초기화 ──────────────────────────────────────
    setProgressTitle('개인주문 업데이트')
    setProgressSteps([
      { label: '쿠팡 발주서 조회', state: 'pending' },
      { label: '데이터 변환', state: 'pending' },
      { label: 'DB 저장', state: 'pending' },
      { label: '재조회', state: 'pending' },
      { label: '진행상황(fulfillment) 조회', state: 'pending' },
    ])
    setProgressStatus('')
    setProgressOpen(true)
    setUpdating(true)

    try {
      // STEP 1: 쿠팡 API
      updateStep(0, 'active')
      const apiData = await fetchAllOrdersheets((msg) => {
        updateStep(0, 'active', msg)
      })
      updateStep(0, 'done', `${apiData.length}건`)

      // STEP 2: 변환
      updateStep(1, 'active')
      const rows = mapOrderToRows(apiData, vendorId, userId)
      updateStep(1, 'done', `${rows.length}건`)

      // STEP 3: 저장
      updateStep(2, 'active', `${rows.length}건 저장 중`)
      const result = await savePersonalOrders(rows, userId)
      if (!result.success) {
        updateStep(2, 'error')
        setProgressStatus(`저장 실패: ${result.error}`)
        alert(`저장 실패: ${result.error}`)
        return
      }
      updateStep(2, 'done', `${result.count}건`)

      // STEP 4: 재조회
      updateStep(3, 'active')
      const freshData = await fetchPersonalOrders(userId)
      setItems(freshData)
      setCurrentPage(1)
      setSelectedIds(new Set())
      updateStep(3, 'done', `${freshData.length}건`)

      // STEP 5: fulfillment
      updateStep(4, 'active')
      await loadFulfillmentData(freshData)
      updateStep(4, 'done')

      setProgressStatus(`${result.count}건 업데이트 완료`)
      // 완료 메시지를 잠깐 보여준 후 자동 닫기
      setTimeout(() => closeProgress(), 1200)
    } catch (err: any) {
      console.error('업데이트 실패:', err)
      setProgressSteps((prev) =>
        prev.map((s) => (s.state === 'active' ? { ...s, state: 'error' } : s)),
      )
      setProgressStatus(`실패: ${err.message}`)
      alert(`업데이트 실패: ${err.message}`)
    } finally {
      setUpdating(false)
    }
  }, [getUserInfo, loadFulfillmentData, updateStep, closeProgress])

  // ── [주문확인] 핸들러 (결제완료 → 상품준비중) ──────────────────
  const handleAcknowledge = useCallback(async () => {
    if (selectedIds.size === 0) {
      alert('주문을 선택해 주세요.')
      return
    }

    const { userId } = getUserInfo()
    if (!userId) {
      alert('로그인 정보를 확인해 주세요.')
      return
    }

    const shipmentBoxIds = [...selectedIds]

    if (!confirm(`${shipmentBoxIds.length}건을 상품준비중으로 변경하시겠습니까?`)) {
      return
    }

    setAcknowledging(true)
    try {
      const result = await acknowledgeOrders(shipmentBoxIds)

      if (result.success > 0) {
        await updateOrderStatusToInstruct(shipmentBoxIds, userId)
        setItems((prev) =>
          prev.map((row) =>
            shipmentBoxIds.includes(row.shipment_box_id)
              ? { ...row, status: 'INSTRUCT' }
              : row,
          ),
        )
      }

      setSelectedIds(new Set())
      if (result.failed === 0) {
        alert(`${result.success}건 주문확인 완료`)
      } else {
        alert(
          `성공: ${result.success}건, 실패: ${result.failed}건\n\n` +
          result.errors.slice(0, 5).join('\n'),
        )
      }
    } catch (err: any) {
      console.error('주문확인 실패:', err)
      alert(`주문확인 실패: ${err.message}`)
    } finally {
      setAcknowledging(false)
    }
  }, [selectedIds, getUserInfo])

  // ── 탭 전환 ───────────────────────────────────────────────────
  const handleTabChange = useCallback((tab: OrderStatusTab) => {
    setActiveTab(tab)
    setCurrentPage(1)
    setSelectedIds(new Set())
    setShowUnorderedOnly(false)
  }, [])

  // ── 미주문 필터 토글 ──────────────────────────────────────────
  const toggleUnorderedOnly = useCallback(() => {
    setShowUnorderedOnly((prev) => !prev)
    setCurrentPage(1)
  }, [])

  // ── 검색 제출 (Enter 키) ────────────────────────────────────────
  const handleSearchSubmit = useCallback(() => {
    setAppliedSearch(searchValue.trim())
    setCurrentPage(1)
  }, [searchValue])

  // ── 필터링 (activeTab + 검색 + 미주문 필터 + 주문일시 오름차순) ──
  const filteredItems = useMemo(() => {
    const statusCode = STATUS_REVERSE_MAP[activeTab]
    let result = statusCode ? items.filter((row) => row.status === statusCode) : items

    // 검색 필터 (Enter로 적용된 검색어 기준)
    if (appliedSearch) {
      const keyword = appliedSearch.toLowerCase()
      result = result.filter((row) => {
        const targets = [
          row.order_id,
          row.item_name,
          row.option_name,
          row.product_name,
          row.receiver_name,
        ]
        return targets.some((v) => v && v.toLowerCase().includes(keyword))
      })
    }

    // 미주문 필터 (getRowStatus 참조 불가 → 인라인 판별)
    if (showUnorderedOnly) {
      result = result.filter((row) => {
        const agg = row.order_id ? (aggMap.get(row.order_id) ?? EMPTY_AGG) : EMPTY_AGG
        const qty = row.shipping_count ?? 0
        const isRed = qty > 0 && agg.cancel >= qty
        const isGreen = agg.packed > 0
        const isGray = !!(row.order_id && orderItemMap.has(row.order_id))
        return !isRed && !isGreen && !isGray // none = 미주문
      })
    }

    return result.sort((a, b) => {
      const dateA = a.ordered_at ? new Date(a.ordered_at).getTime() : 0
      const dateB = b.ordered_at ? new Date(b.ordered_at).getTime() : 0
      return dateA - dateB
    })
  }, [items, activeTab, appliedSearch, showUnorderedOnly, aggMap, orderItemMap])

  // ── [엑셀 다운] 핸들러 (쿠팡 DeliveryList 양식) ────────────────
  const handleExcelDownload = useCallback(() => {
    const targetRows =
      selectedIds.size > 0
        ? filteredItems.filter((r) => selectedIds.has(r.shipment_box_id))
        : filteredItems

    if (targetRows.length === 0) {
      alert('다운로드할 데이터가 없습니다.')
      return
    }

    const HEADERS = [
      '번호', '묶음배송번호', '주문번호', '택배사', '운송장번호',
      '분리배송 Y/N', '분리배송 출고예정일', '주문시 출고예정일',
      '출고일(발송일)', '주문일', '등록상품명', '등록옵션명',
      '노출상품명(옵션명)', '노출상품ID', '옵션ID',
      '최초등록등록상품명/옵션명', '업체상품코드', '바코드',
      '결제액', '배송비구분', '배송비', '도서산간 추가배송비',
      '구매수(수량)', '옵션판매가(판매단가)', '구매자', '구매자전화번호',
      '수취인이름', '수취인전화번호', '우편번호', '수취인 주소',
      '배송메세지', '상품별 추가메시지', '주문자 추가메시지',
      '배송완료일', '구매확정일자', '개인통관번호(PCCC)',
      '통관용수취인전화번호', '기타', '결제위치', '배송유형',
    ]

    const rows = targetRows.map((r, i) => [
      i + 1, r.shipment_box_id, r.order_id, r.delivery_company_name, r.invoice_number,
      r.split_shipping === 'Y' ? 'Y' : '분리배송불가', r.planned_shipping_date ?? '',
      r.estimated_shipping_date ?? '',
      r.in_transit_date_time ? formatDateTime(r.in_transit_date_time) : '',
      r.ordered_at ? formatDateTime(r.ordered_at) : '',
      r.item_name, r.option_name, r.product_name, r.product_id, r.vendor_item_id,
      `${r.item_name},${r.option_name}`, r.external_vendor_sku_code, r.barcode,
      r.order_price_units, '무료', 0, 0, r.shipping_count, r.sales_price_units,
      r.orderer_name, r.receiver_safe_number, r.receiver_name, r.receiver_safe_number,
      r.receiver_post_code, r.receiver_address, r.parcel_print_message, '', '',
      r.delivered_date ? formatDateTime(r.delivered_date) : '', '', '', '', '',
      r.refer, r.shipment_type,
    ])

    const wsData = [HEADERS, ...rows]
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Delivery')

    const today = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `DeliveryList(${today}).xlsx`)
  }, [filteredItems, selectedIds])

  // ── [주문] 구글 시트 클립보드 복사 ──────────────────────────
  const handleOrderCopy = useCallback(() => {
    const targetRows =
      selectedIds.size > 0
        ? filteredItems.filter((r) => selectedIds.has(r.shipment_box_id))
        : filteredItems

    if (targetRows.length === 0) {
      alert('복사할 데이터가 없습니다.')
      return
    }

    // ── TSV 행 생성 (A~V = 22열) ──
    const GAP = new Array(14).fill('')  // G~T 빈 열
    const lines = targetRows.map((r) => {
      const cols = [
        '',                                         // A
        '',                                         // B
        r.item_name,                                // C
        r.option_name,                              // D
        r.shipping_count,                           // E
        r.barcode,                                  // F
        ...GAP,                                     // G~T
        r.vendor_item_id,                           // U
        `P-${r.order_id} ${r.receiver_name}`,       // V
      ]
      return cols.join('\t')
    })
    const tsv = lines.join('\n')

    // ── 클립보드 복사 (Electron 호환) ──
    const el = document.createElement('textarea')
    el.value = tsv
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0'
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)

    alert(`${targetRows.length}건 클립보드에 복사되었습니다.`)
  }, [filteredItems, selectedIds])

  // ── 행 클릭 → 드로어 열기 ────────────────────────────────────
  const handleRowClick = useCallback((row: PersonalOrderRow) => {
    if (!row.order_id) return
    const oi = orderItemMap.get(row.order_id)
    if (!oi) return
    setSelectedDrawerItem({
      id: oi.id,
      itemName: oi.item_name,
      optionName: oi.option_name,
      orderNo: oi.order_no,
      itemNo: oi.item_no,
      productNo: oi.product_no,
    })
  }, [orderItemMap])

  // ── [바코드 연결] 핸들러 ──────────────────────────────────────────
  const [barcodeLoading, setBarcodeLoading] = useState(false)

  const handleBarcodeLink = useCallback(async () => {
    const { userId } = getUserInfo()
    if (!userId) {
      alert('로그인 정보를 확인해 주세요.')
      return
    }

    // 바코드 없는 주문만 대상
    const targets = items.filter((r) => !r.barcode)
    if (targets.length === 0) {
      alert('바코드가 없는 주문이 없습니다.')
      return
    }

    // ── 진행 모달 초기화 ──────────────────────────────────────
    setProgressTitle('바코드 연결')
    setProgressSteps([
      { label: '로켓그로스 상품(si_rg_items) 조회', state: 'pending' },
      { label: '6단계 규칙 매칭', state: 'pending' },
      { label: 'DB 저장', state: 'pending' },
    ])
    setProgressStatus(`대상 ${targets.length}건`)
    setProgressOpen(true)
    setBarcodeLoading(true)

    try {
      // STEP 1: 로켓그로스 상품 조회
      updateStep(0, 'active')
      const rgItems = await fetchRgItemsWithBarcode(userId)
      if (rgItems.length === 0) {
        updateStep(0, 'error')
        alert('로켓그로스 상품(si_rg_items)에 바코드 데이터가 없습니다.')
        closeProgress()
        return
      }
      updateStep(0, 'done', `${rgItems.length}건`)

      // STEP 2: 매칭
      updateStep(1, 'active')
      const matches = matchBarcodes(targets, rgItems)
      if (matches.size === 0) {
        updateStep(1, 'error')
        alert(`매칭 결과: 0건\n대상 ${targets.length}건 중 매칭된 바코드가 없습니다.`)
        closeProgress()
        return
      }
      updateStep(1, 'done', `${matches.size}/${targets.length}건`)

      // STEP 3: DB 저장
      updateStep(2, 'active')
      const saveResult = await saveBarcodes(matches, userId)
      updateStep(2, 'done', `${saveResult.updated}건`)

      // 로컬 상태 업데이트
      setItems((prev) =>
        prev.map((row) => {
          if (row.id && matches.has(row.id)) {
            return { ...row, barcode: matches.get(row.id)! }
          }
          return row
        }),
      )

      const unmatched = targets.length - matches.size
      setProgressStatus(`성공 ${matches.size} / 실패 ${unmatched} / 저장 ${saveResult.updated}`)
      setTimeout(() => closeProgress(), 1500)
    } catch (err: any) {
      console.error('[바코드 연결] 실패:', err)
      setProgressSteps((prev) =>
        prev.map((s) => (s.state === 'active' ? { ...s, state: 'error' } : s)),
      )
      setProgressStatus(`실패: ${err.message}`)
      alert(`바코드 연결 실패: ${err.message}`)
    } finally {
      setBarcodeLoading(false)
    }
  }, [items, getUserInfo, updateStep, closeProgress])

  // ── [송장 연결] 핸들러 ────────────────────────────────────────────
  const [invoiceLinking, setInvoiceLinking] = useState(false)

  const handleInvoiceLink = useCallback(async (file: File) => {
    const { userId } = getUserInfo()
    if (!userId) {
      alert('로그인 정보를 확인해 주세요.')
      return
    }

    // ── 진행 모달 초기화 ──────────────────────────────────────
    setProgressTitle('송장 연결')
    setProgressSteps([
      { label: 'PDF 페이지 파싱 (주문번호 추출)', state: 'pending' },
      { label: '주문 데이터와 매칭', state: 'pending' },
      { label: 'Supabase Storage 업로드', state: 'pending' },
    ])
    setProgressStatus(file.name)
    setProgressOpen(true)
    setInvoiceLinking(true)

    try {
      // STEP 1: PDF 파싱
      updateStep(0, 'active')
      const pages = await parsePdfInvoices(file)
      if (pages.length === 0) {
        updateStep(0, 'error')
        alert('PDF에서 주문번호를 추출할 수 없습니다.')
        closeProgress()
        return
      }
      updateStep(0, 'done', `${pages.length}페이지`)

      // STEP 2: 매칭
      updateStep(1, 'active')
      const orderIdSet = new Set(items.map((r) => r.order_id))
      const matched = pages.filter((p) => orderIdSet.has(p.orderId))
      const unmatched = pages.filter((p) => !orderIdSet.has(p.orderId))

      if (matched.length === 0) {
        updateStep(1, 'error')
        alert(
          `매칭된 주문이 없습니다.\n` +
          `추출된 주문번호 ${pages.length}건 중 현재 주문 데이터와 일치하는 건이 없습니다.`,
        )
        closeProgress()
        return
      }
      updateStep(1, 'done', `${matched.length}/${pages.length}건`)

      // STEP 3: Storage 업로드
      updateStep(2, 'active', `0/${matched.length}`)
      const result = await splitAndUploadPages(file, matched, userId)
      updateStep(2, 'done', `${result.success}/${matched.length}`)

      setProgressStatus(
        `완료 — 성공 ${result.success}, 매칭 실패 ${unmatched.length}` +
        (result.failed > 0 ? `, 업로드 실패 ${result.failed}` : ''),
      )
      setTimeout(() => closeProgress(), 1500)
    } catch (err: any) {
      console.error('[송장 연결] 실패:', err)
      setProgressSteps((prev) =>
        prev.map((s) => (s.state === 'active' ? { ...s, state: 'error' } : s)),
      )
      setProgressStatus(`실패: ${err.message}`)
      alert(`송장 연결 실패: ${err.message}`)
    } finally {
      setInvoiceLinking(false)
    }
  }, [items, getUserInfo, updateStep, closeProgress])

  // ── [송장 인쇄] 핸들러 (체크된 주문 일괄 인쇄) ───────────────────
  const [invoicePrinting, setInvoicePrinting] = useState(false)

  const handleInvoicePrint = useCallback(async () => {
    if (selectedIds.size === 0) {
      alert('주문을 선택해 주세요.')
      return
    }

    const { userId } = getUserInfo()
    if (!userId) {
      alert('로그인 정보를 확인해 주세요.')
      return
    }

    // 선택된 shipment_box_id → order_id 매핑 (중복 제거)
    const orderIds = Array.from(
      new Set(
        items
          .filter((r) => selectedIds.has(r.shipment_box_id))
          .map((r) => r.order_id)
          .filter(Boolean),
      ),
    )

    if (orderIds.length === 0) {
      alert('선택된 주문의 주문번호를 찾을 수 없습니다.')
      return
    }

    setInvoicePrinting(true)
    try {
      const result = await printMultipleInvoices(userId, orderIds)

      // 결과 요약 (인쇄 창은 서비스에서 열림)
      const parts = [`인쇄 준비 완료\n- 선택: ${orderIds.length}건\n- 성공: ${result.success}건`]
      if (result.missing.length > 0) {
        parts.push(`- 송장 미등록: ${result.missing.length}건\n  (${result.missing.slice(0, 5).join(', ')}${result.missing.length > 5 ? '...' : ''})`)
      }
      if (result.failed.length > 0) {
        parts.push(`- 처리 실패: ${result.failed.length}건`)
      }
      if (result.success === 0) {
        alert(parts.join('\n'))
      } else if (result.missing.length > 0 || result.failed.length > 0) {
        alert(parts.join('\n'))
      }
    } catch (err: any) {
      console.error('[송장 인쇄] 실패:', err)
      alert(`송장 인쇄 실패: ${err.message}`)
    } finally {
      setInvoicePrinting(false)
    }
  }, [selectedIds, items, getUserInfo])

  // ── 페이지네이션 ──────────────────────────────────────────────
  const filteredCount = filteredItems.length
  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE))
  const pagedItems = filteredItems.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  // ── 체크박스 핸들러 ───────────────────────────────────────────
  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        const ids = new Set(pagedItems.map((r) => r.shipment_box_id))
        setSelectedIds(ids)
      } else {
        setSelectedIds(new Set())
      }
    },
    [pagedItems],
  )

  const handleSelectRow = useCallback(
    (shipmentBoxId: string, checked: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (checked) next.add(shipmentBoxId)
        else next.delete(shipmentBoxId)
        return next
      })
    },
    [],
  )

  const isAllSelected =
    pagedItems.length > 0 && pagedItems.every((r) => selectedIds.has(r.shipment_box_id))

  // ── 페이지네이션 헬퍼 ──────────────────────────────────────────
  const getPageNumbers = useCallback(() => {
    const pages: (number | 'ellipsis')[] = []
    if (totalPages <= 5) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (currentPage > 3) pages.push('ellipsis')
      const start = Math.max(2, currentPage - 1)
      const end = Math.min(totalPages - 1, currentPage + 1)
      for (let i = start; i <= end; i++) pages.push(i)
      if (currentPage < totalPages - 2) pages.push('ellipsis')
      pages.push(totalPages)
    }
    return pages
  }, [currentPage, totalPages])

  // ── 반환 ──────────────────────────────────────────────────────
  return {
    // 상태
    activeTab,
    searchValue,
    setSearchValue,
    currentPage,
    setCurrentPage,
    loading,
    updating,
    updateMsg,
    selectedIds,
    acknowledging,
    showUnorderedOnly,
    selectedDrawerItem,
    setSelectedDrawerItem,

    // 진행 모달
    progressOpen,
    progressTitle,
    progressSteps,
    progressStatus,

    // 필터/페이지네이션
    filteredCount,
    totalPages,
    pagedItems,
    isAllSelected,
    getPageNumbers,

    // 핸들러
    handleSearchSubmit,
    handleTabChange,
    handleUpdate,
    handleAcknowledge,
    handleExcelDownload,
    handleOrderCopy,
    handleRowClick,
    handleBarcodeLink,
    barcodeLoading,
    handleInvoiceLink,
    invoiceLinking,
    handleInvoicePrint,
    invoicePrinting,
    handleSelectAll,
    handleSelectRow,
    toggleUnorderedOnly,

    // fulfillment 헬퍼
    getAgg,
    getRowStatus,
  }
}
