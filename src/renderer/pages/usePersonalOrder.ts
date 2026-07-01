/* ================================================================
   개인주문 페이지 — 커스텀 훅
   - 상태 관리, 데이터 로드, 핸들러, 필터/페이지네이션 로직
   ================================================================ */

import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import * as XLSX from 'xlsx'
import {
  fetchAllOrdersheets,
  fetchAllReturnRequests,
  mapOrderToRows,
  savePersonalOrders,
  fetchPersonalOrders,
  acknowledgeOrders,
  updateOrderStatusToInstruct,
  upsertTrackingNumbers,
  fetchTrackingNumbers,
  cleanupStaleTracking,
  fetchOrderNotes,
  saveOrderNote,
  STATUS_MAP,
  STATUS_REVERSE_MAP,
  type PersonalOrderRow,
} from '../services/personalOrderService'
import {
  fetchFulfillmentData,
  fetchOrderCartKeys,
  fetchCancelMetaForItems,
  fetchShipmentsWithin,
  fetchShipmentDetails,
  makeFulfillmentKey,
  deriveFulfillmentStatus,
  EMPTY_AGG,
  type FulfillmentAgg,
  type FulfillmentStatus,
  type OrderItemDetail,
  type ShipmentPickerOption,
  type ShipmentDetailRow,
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
  fetchInvoiceOrderIds,
  deleteInvoicesByOrderIds,
} from '../services/invoiceService'
import { sendPersonalOrdersPre } from '../services/orderSendService'
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
  { key: 'product_info',   label: '상품정보',  width: '268px' },
  { key: 'receiver_name',  label: '수취인',    width: '80px'  },
  { key: 'shipping_count', label: '수량',      width: '50px'  },
  { key: 'status_label',   label: '주문상태',  width: '70px'  },
  { key: 'estimated_shipping_date', label: '출고예정', width: '60px' },
  { key: 'ordered_at_label', label: '주문일', width: '60px' },
  { key: 'ff_status',      label: '상태',      width: '36px'  },
  { key: 'ff_arrival',     label: '입고',      width: '36px'  },
  { key: 'ff_packed',      label: '포장',      width: '36px'  },
  { key: 'ff_cancel',      label: '취소',      width: '36px'  },
  { key: 'ff_shipped',     label: '출고',      width: '36px'  },
] as const

// ── 상태 점 설정 ──────────────────────────────────────────────────
// 상태 판정 로직은 orderFulfillmentService.deriveFulfillmentStatus 로 공유
export type StatusType = FulfillmentStatus

export const STATUS_DOT_LABELS: Record<StatusType, string> = {
  shipped: '출고완료',
  green: '포장완료',
  red: '전량취소',
  gray: '미발송',
  multi: '이력 확인 필요',
  cart: '카트',
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

/** 날짜만 포맷 (yyyy-MM-dd) — 시간 제외 */
export function formatDate(isoStr: string | null): string {
  return formatDateTime(isoStr).slice(0, 10)
}

// ── 쿠팡 DeliveryList 엑셀 헤더 ────────────────────────────────────
const DELIVERY_HEADERS = [
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

/**
 * DeliveryList aoa 생성 (헤더 + 행). boxPrefixOf 지정 시 등록상품명 앞에 박스 접두 추가.
 * - 기존 [엑셀] 과 입고엑셀 Delivery 시트가 공유.
 */
function buildDeliveryAoA(
  rows: PersonalOrderRow[],
  boxPrefixOf?: (r: PersonalOrderRow) => string,
): (string | number)[][] {
  const body = rows.map((r, i) => [
    i + 1, r.shipment_box_id, r.order_id, r.delivery_company_name, r.invoice_number,
    r.split_shipping === 'Y' ? 'Y' : '분리배송불가', r.planned_shipping_date ?? '',
    r.estimated_shipping_date ?? '',
    r.in_transit_date_time ? formatDateTime(r.in_transit_date_time) : '',
    r.ordered_at ? formatDateTime(r.ordered_at) : '',
    (boxPrefixOf ? boxPrefixOf(r) : '') + r.item_name, r.option_name, r.product_name, r.product_id, r.vendor_item_id,
    `${r.item_name},${r.option_name}`, r.external_vendor_sku_code, r.barcode,
    r.order_price_units, '무료', 0, 0, r.shipping_count, r.sales_price_units,
    r.orderer_name, r.receiver_safe_number, r.receiver_name, r.receiver_safe_number,
    r.receiver_post_code, r.receiver_address, r.parcel_print_message, '', '',
    r.delivered_date ? formatDateTime(r.delivered_date) : '', '', '', '', '',
    r.refer, r.shipment_type,
  ])
  return [DELIVERY_HEADERS, ...body]
}

/** 행 데이터 → 테이블 표시용 값 추출 */
export function getCellValue(row: PersonalOrderRow, key: string): string {
  switch (key) {
    case 'product_info':
      return row.item_name + (row.option_name ? ` / ${row.option_name}` : '')
    case 'status_label':
      return STATUS_MAP[row.status] ?? row.status
    case 'ordered_at_label':
      return formatDate(row.ordered_at)
    case 'estimated_shipping_date':
      return row.estimated_shipping_date ?? ''
    default:
      return String((row as any)[key] ?? '')
  }
}

// ── 행 유일 키 헬퍼 ───────────────────────────────────────────────
//   selectedIds / focusedCell.rowKey 의 통일된 키.
//   row.id (uuid) 우선, 없으면 (shipment_box_id|vendor_item_id) fallback.
export function getRowKey(r: PersonalOrderRow): string {
  return r.id ?? `${r.shipment_box_id}|${r.vendor_item_id ?? ''}`
}

// ── 드로어 선택 아이템 타입 ─────────────────────────────────────────
export interface DrawerItemState {
  ids: string[]                 // ft_order_items.id 배열 (재주문 등 복수)
  itemName: string | null
  optionName: string | null
  orderNo: string | null        // 표시/송장용 (ft_order_items.order_no)
  itemNo: string | null
  productNo: string | null
  noteOrderNo: string | null    // 비고 키 = 화면 order_id
  noteOptionId: string | null   // 비고 키 = 화면 vendor_item_id
}

// ══════════════════════════════════════════════════════════════════
// 커스텀 훅
// ══════════════════════════════════════════════════════════════════

export function usePersonalOrder() {
  // ── 상태 ──────────────────────────────────────────────────────
  // 배송 탭 다중 선택 — 빈 Set = '전체'(모든 상태). 기본 '상품준비중'
  const [selectedTabs, setSelectedTabs] = useState<Set<OrderStatusTab>>(new Set(['상품준비중']))
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
  const [showReleaseStopOnly, setShowReleaseStopOnly] = useState(false)
  const [showNoInvoiceOnly, setShowNoInvoiceOnly] = useState(false)
  const [showReorderOnly, setShowReorderOnly] = useState(false)
  // 📌 노트 필터: 고객주문 비고(note) 데이터가 있는 행만 보기
  const [showNoteOnly, setShowNoteOnly] = useState(false)
  // 🛒 카트 필터: status='ORDER' 카트에 담긴(미주문) 행만 보기
  const [showCartOnly, setShowCartOnly] = useState(false)
  // 상태 점(green/red/gray) 필터 — 멀티 선택(OR). 빈 Set = 필터 없음
  const [selectedStatuses, setSelectedStatuses] = useState<Set<StatusType>>(new Set())

  // ── 송장 파일 매칭 Set (Storage 에서 일괄 로드) ───────────
  const [invoiceOrderIds, setInvoiceOrderIds] = useState<Set<string>>(new Set())

  // ── 송장 xlsx 운송장 번호 (si_personal_order_tracking) ────
  const invoiceXlsxInputRef = useRef<HTMLInputElement>(null)
  const [invoiceXlsxUploading, setInvoiceXlsxUploading] = useState(false)
  const [trackingMap, setTrackingMap] = useState<Map<string, string>>(new Map())

  // ── fulfillment 상태 (키: `${order_id}|${option_id}`) ─────────
  const [aggMap, setAggMap] = useState<Map<string, FulfillmentAgg>>(new Map())
  const [multiKeys, setMultiKeys] = useState<Set<string>>(new Set())
  const [orderItemsMap, setOrderItemsMap] = useState<Map<string, OrderItemDetail[]>>(new Map())
  const [reorderCountMap, setReorderCountMap] = useState<Map<string, number>>(new Map())
  // ORDER 카트 매칭 키 집합 (복합 키: order_id|vendor_item_id) — '카트(🛒)' 판정용
  const [cartKeySet, setCartKeySet] = useState<Set<string>>(new Set())

  // ── 드로어 선택 상태 ──────────────────────────────────────────
  const [selectedDrawerItem, setSelectedDrawerItem] = useState<DrawerItemState | null>(null)

  // ── 고객주문 비고(note) Map<`${order_id}|${vendor_item_id}`, note> ──
  const [noteMap, setNoteMap] = useState<Map<string, string>>(new Map())

  // ── 입고준비 (shipment 재고 → 주문 바코드 할당) ──────────────
  const [inboundActive, setInboundActive] = useState(false)        // 매칭 적용 상태
  const [inboundLoading, setInboundLoading] = useState(false)
  const [inboundModalOpen, setInboundModalOpen] = useState(false)
  const [shipmentOptions, setShipmentOptions] = useState<ShipmentPickerOption[]>([])
  // rowKey → { boxStr, matched }
  const [inboundAllocMap, setInboundAllocMap] = useState<Map<string, { boxStr: string; matched: boolean }>>(new Map())
  // 엑셀 shipment_list 시트용: 상세 + 출고(allocated)
  const [inboundDetails, setInboundDetails] = useState<Array<ShipmentDetailRow & { allocated: number }>>([])

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

  // ── fulfillment 집계 헬퍼 (복합 키: order_id|option_id) ──────
  const getAgg = useCallback((row: PersonalOrderRow): FulfillmentAgg => {
    if (!row.order_id) return EMPTY_AGG
    const key = makeFulfillmentKey(row.order_id, row.vendor_item_id)
    return aggMap.get(key) ?? EMPTY_AGG
  }, [aggMap])

  // ── 상태 점 판별 ──────────────────────────────────────────────
  //   판정 규칙 (복합 키 기준):
  //     multiKeys 포함 → multi (set_seq 중복 = 이력 확인 필요)
  //     매칭 없음       → none  (미주문)
  //     그 외           → 기존 red / green / gray 분기
  const getRowStatus = useCallback(
    (row: PersonalOrderRow): StatusType =>
      deriveFulfillmentStatus(row.order_id, row.vendor_item_id, row.shipping_count ?? 0, {
        aggMap, multiKeys, orderItemsMap, cartKeys: cartKeySet,
      }),
    [aggMap, multiKeys, orderItemsMap, cartKeySet],
  )

  // ── fulfillment 데이터 로드 ─────────────────────────────────────
  const loadFulfillmentData = useCallback(async (orderRows: PersonalOrderRow[]) => {
    const { orderUserId } = getUserInfo()
    if (!orderUserId || orderRows.length === 0) {
      setAggMap(new Map())
      setMultiKeys(new Set())
      setOrderItemsMap(new Map())
      setReorderCountMap(new Map())
      setCartKeySet(new Set())
      return
    }

    try {
      const orderIds = Array.from(new Set(orderRows.map((r) => r.order_id).filter(Boolean)))
      // fulfillment 집계 + ORDER 카트 매칭 키 병렬 조회
      const [result, cartKeys] = await Promise.all([
        fetchFulfillmentData(orderIds, orderUserId),
        fetchOrderCartKeys(orderIds, orderUserId),
      ])
      setAggMap(result.aggMap)
      setMultiKeys(result.multiKeys)
      setOrderItemsMap(result.orderItemsMap)
      setReorderCountMap(result.reorderCountMap)
      setCartKeySet(cartKeys)
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
        // DB 주문 조회 + Storage 송장 파일 목록 + xlsx 운송장 번호 (병렬)
        const [data, invIds, trkMap, notes] = await Promise.all([
          fetchPersonalOrders(userId),
          fetchInvoiceOrderIds(userId),
          fetchTrackingNumbers(userId),
          fetchOrderNotes(userId),
        ])
        setItems(data)
        setInvoiceOrderIds(invIds)
        setTrackingMap(trkMap)
        setNoteMap(notes)
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
      { label: '출고중지/반품 조회', state: 'pending' },
      { label: '데이터 변환', state: 'pending' },
      { label: 'DB 저장', state: 'pending' },
      { label: '재조회', state: 'pending' },
      { label: '진행상황(fulfillment) 조회', state: 'pending' },
    ])
    setProgressStatus('')
    setProgressOpen(true)
    setUpdating(true)

    try {
      // STEP 1: 쿠팡 발주서 API
      updateStep(0, 'active')
      const apiData = await fetchAllOrdersheets((msg) => {
        updateStep(0, 'active', msg)
      })
      updateStep(0, 'done', `${apiData.length}건`)

      // STEP 2: 출고중지/반품 요청 조회
      updateStep(1, 'active')
      const releaseStopSet = await fetchAllReturnRequests((msg) => {
        updateStep(1, 'active', msg)
      })
      updateStep(1, 'done', `${releaseStopSet.size}건`)

      // STEP 3: 변환 (release_stop 플래그 주입)
      updateStep(2, 'active')
      const rows = mapOrderToRows(apiData, vendorId, userId, releaseStopSet)
      updateStep(2, 'done', `${rows.length}건`)

      // STEP 4: 저장
      updateStep(3, 'active', `${rows.length}건 저장 중`)
      const result = await savePersonalOrders(rows, userId)
      if (!result.success) {
        updateStep(3, 'error')
        setProgressStatus(`저장 실패: ${result.error}`)
        alert(`저장 실패: ${result.error}`)
        return
      }
      updateStep(3, 'done', `${result.count}건`)

      // STEP 5: 재조회
      updateStep(4, 'active')
      const freshData = await fetchPersonalOrders(userId)
      setItems(freshData)
      setCurrentPage(1)
      setSelectedIds(new Set())
      updateStep(4, 'done', `${freshData.length}건`)

      // STEP 5.5: xlsx 운송장 번호 stale 정리 (진행 단계 표시 없이 백그라운드)
      const validOrderIds = new Set(freshData.map((r) => r.order_id).filter(Boolean))
      const { deleted: trackingDeleted } = await cleanupStaleTracking(userId, validOrderIds)
      if (trackingDeleted > 0) {
        console.log(`[송장 tracking] stale ${trackingDeleted}건 정리`)
        setTrackingMap((prev) => {
          const next = new Map(prev)
          for (const key of next.keys()) {
            if (!validOrderIds.has(key)) next.delete(key)
          }
          return next
        })
      }

      // STEP 6: fulfillment
      updateStep(5, 'active')
      await loadFulfillmentData(freshData)
      updateStep(5, 'done')

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

    // selectedIds = row.id 집합 → 선택된 행에서 shipment_box_id 만 추출 (dedup)
    const selectedRows = items.filter((r) => selectedIds.has(getRowKey(r)))
    const shipmentBoxIds = Array.from(new Set(selectedRows.map((r) => r.shipment_box_id)))

    if (!confirm(`${shipmentBoxIds.length}건을 상품준비중으로 변경하시겠습니까?`)) {
      return
    }

    setAcknowledging(true)
    try {
      const result = await acknowledgeOrders(shipmentBoxIds)

      if (result.success > 0) {
        await updateOrderStatusToInstruct(shipmentBoxIds, userId)
        const boxSet = new Set(shipmentBoxIds)
        setItems((prev) =>
          prev.map((row) =>
            boxSet.has(row.shipment_box_id)
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
  }, [selectedIds, items, getUserInfo])

  // ── 탭 전환 (다중 선택) ───────────────────────────────────────
  //   '전체' 선택 → 비움(= 모든 상태). 그 외 → 토글. 모두 해제 시 = 전체.
  const handleTabChange = useCallback((tab: OrderStatusTab) => {
    setSelectedTabs((prev) => {
      if (tab === '전체') return new Set()
      const next = new Set(prev)
      if (next.has(tab)) next.delete(tab)
      else next.add(tab)
      return next
    })
    setCurrentPage(1)
    setSelectedIds(new Set())
    setShowUnorderedOnly(false)
    setShowCartOnly(false)
    setShowReleaseStopOnly(false)
    setShowNoInvoiceOnly(false)
    setShowReorderOnly(false)
    setShowNoteOnly(false)
    setSelectedStatuses(new Set())
  }, [])

  // ── 미주문 필터 토글 ──────────────────────────────────────────
  const toggleUnorderedOnly = useCallback(() => {
    setShowUnorderedOnly((prev) => !prev)
    setCurrentPage(1)
  }, [])

  // ── 🛒 카트 필터 토글 ─────────────────────────────────────────
  const toggleCartOnly = useCallback(() => {
    setShowCartOnly((prev) => !prev)
    setCurrentPage(1)
  }, [])

  // ── 출고중지 필터 토글 ────────────────────────────────────────
  const toggleReleaseStopOnly = useCallback(() => {
    setShowReleaseStopOnly((prev) => !prev)
    setCurrentPage(1)
  }, [])

  // ── 송장 미연결 필터 토글 ────────────────────────────────────
  const toggleNoInvoiceOnly = useCallback(() => {
    setShowNoInvoiceOnly((prev) => !prev)
    setCurrentPage(1)
  }, [])

  // ── 재주문 필터 토글 (2차 이상) ──────────────────────────────
  const toggleReorderOnly = useCallback(() => {
    setShowReorderOnly((prev) => !prev)
    setCurrentPage(1)
  }, [])

  // ── 📌 노트 필터 토글 (비고 데이터 있는 행) ──────────────────
  const toggleNoteOnly = useCallback(() => {
    setShowNoteOnly((prev) => !prev)
    setCurrentPage(1)
  }, [])

  // ── 상태 점(green/red/gray) 필터 토글 — 멀티 선택(OR) ─────
  const toggleStatusFilter = useCallback((status: StatusType) => {
    setSelectedStatuses((prev) => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
    setCurrentPage(1)
  }, [])

  // ── 검색 제출 (Enter 키) ────────────────────────────────────────
  const handleSearchSubmit = useCallback(() => {
    setAppliedSearch(searchValue.trim())
    setCurrentPage(1)
  }, [searchValue])

  // ── 필터링 (선택 탭 다중 + 검색 + 미주문 필터 + 주문일시 오름차순) ──
  const filteredItems = useMemo(() => {
    // 선택 탭이 비어있으면 '전체'. 아니면 선택된 상태코드들로 OR 필터.
    let result = items
    if (selectedTabs.size > 0) {
      const codes = new Set(
        Array.from(selectedTabs).map((t) => STATUS_REVERSE_MAP[t]).filter(Boolean),
      )
      result = items.filter((row) => codes.has(row.status))
    }

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

    // ── 상태 점 판정 인라인 (복합 키 기준, getRowStatus 와 동일 로직) ──
    const computeStatus = (row: PersonalOrderRow): StatusType => {
      if (!row.order_id) return 'none'
      const key = makeFulfillmentKey(row.order_id, row.vendor_item_id)
      if (multiKeys.has(key)) return 'multi'
      const itemsForKey = orderItemsMap.get(key)
      // ft_order_items 매칭 없음 → ORDER 카트에 있으면 '카트(🛒)', 아니면 '미주문'
      if (!itemsForKey || itemsForKey.length === 0) {
        return cartKeySet.has(key) ? 'cart' : 'none'
      }
      const agg = aggMap.get(key) ?? EMPTY_AGG
      const qty = row.shipping_count ?? 0
      if (qty > 0 && agg.cancel >= qty) return 'red'
      if (qty > 0 && agg.shipped >= qty) return 'shipped'  // 전량 출고
      if (agg.packed > 0) return 'green'
      return 'gray'
    }

    // 미주문 필터 (카트 행은 별도 상태 → 제외됨)
    if (showUnorderedOnly) {
      result = result.filter((row) => computeStatus(row) === 'none')
    }

    // 🛒 카트 필터
    if (showCartOnly) {
      result = result.filter((row) => computeStatus(row) === 'cart')
    }

    // 출고중지 필터
    if (showReleaseStopOnly) {
      result = result.filter((row) => row.release_stop)
    }

    // 송장 미연결 필터 (PDF 송장, xlsx 운송장, API 운송장 모두 없는 행)
    if (showNoInvoiceOnly) {
      result = result.filter(
        (row) =>
          !!row.order_id
          && !invoiceOrderIds.has(row.order_id)
          && !trackingMap.has(row.order_id)
          && !row.invoice_number,
      )
    }

    // 상태 점 필터 (멀티 선택 OR)
    if (selectedStatuses.size > 0) {
      result = result.filter((row) => selectedStatuses.has(computeStatus(row)))
    }

    // 재주문 필터 (2차 이상)
    if (showReorderOnly) {
      result = result.filter((row) => {
        if (!row.order_id) return false
        const key = makeFulfillmentKey(row.order_id, row.vendor_item_id)
        return (reorderCountMap.get(key) ?? 1) >= 2
      })
    }

    // 📌 노트 필터 (비고 데이터 있는 행)
    if (showNoteOnly) {
      result = result.filter((row) => {
        if (!row.order_id) return false
        const key = makeFulfillmentKey(row.order_id, row.vendor_item_id)
        return noteMap.has(key)
      })
    }

    return result.sort((a, b) => {
      const dateA = a.ordered_at ? new Date(a.ordered_at).getTime() : 0
      const dateB = b.ordered_at ? new Date(b.ordered_at).getTime() : 0
      return dateA - dateB
    })
  }, [items, selectedTabs, appliedSearch, showUnorderedOnly, showCartOnly, showReleaseStopOnly, showNoInvoiceOnly, showReorderOnly, showNoteOnly, selectedStatuses, invoiceOrderIds, trackingMap, aggMap, multiKeys, orderItemsMap, reorderCountMap, cartKeySet, noteMap])

  // ── [엑셀 다운] 핸들러 (쿠팡 DeliveryList 양식) ────────────────
  const handleExcelDownload = useCallback(() => {
    const targetRows =
      selectedIds.size > 0
        ? filteredItems.filter((r) => selectedIds.has(getRowKey(r)))
        : filteredItems

    if (targetRows.length === 0) {
      alert('다운로드할 데이터가 없습니다.')
      return
    }

    const ws = XLSX.utils.aoa_to_sheet(buildDeliveryAoA(targetRows))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Delivery')

    const today = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `DeliveryList(${today}).xlsx`)
  }, [filteredItems, selectedIds])

  // ── [복사] 구글 시트 클립보드 복사 ──────────────────────────
  //   기본: A~V 22열 TSV (Q열 빈 값)
  //   '전량취소' 상태 필터(red) 활성 시: red 행 한정 Q열에
  //     "취소사유1 / 취소사유2\nsite_url" (TSV 큰따옴표 감쌈)
  const handleOrderCopy = useCallback(async () => {
    const targetRows =
      selectedIds.size > 0
        ? filteredItems.filter((r) => selectedIds.has(getRowKey(r)))
        : filteredItems

    if (targetRows.length === 0) {
      alert('복사할 데이터가 없습니다.')
      return
    }

    // ── 전량취소(red) 필터 활성 시 Q열용 메타 사전 fetch ─────
    //   rowKey(=row.id, getRowKey) → Q열 셀(이미 TSV 인코딩된 문자열)
    let qByRowKey: Map<string, string> | null = null
    if (selectedStatuses.has('red')) {
      const { orderUserId } = getUserInfo()
      const redItemIds: string[] = []
      const redRowMeta: { rowKey: string; itemIds: string[] }[] = []
      for (const r of targetRows) {
        if (getRowStatus(r) !== 'red' || !r.order_id) continue
        const key = makeFulfillmentKey(r.order_id, r.vendor_item_id)
        const ids = (orderItemsMap.get(key) ?? []).map((oi) => oi.id)
        if (ids.length === 0) continue
        redItemIds.push(...ids)
        redRowMeta.push({ rowKey: getRowKey(r), itemIds: ids })
      }
      if (redItemIds.length > 0 && orderUserId) {
        try {
          const meta = await fetchCancelMetaForItems(redItemIds, orderUserId)
          qByRowKey = new Map()
          for (const { rowKey, itemIds } of redRowMeta) {
            const reasons: string[] = []
            let siteUrl: string | null = null
            for (const id of itemIds) {
              const m = meta.get(id)
              if (!m) continue
              reasons.push(...m.cancelReasons)
              if (!siteUrl && m.siteUrl) siteUrl = m.siteUrl
            }
            // TSV 셀 안 줄바꿈 보존: 큰따옴표 wrap + 내부 " → "" 이스케이프
            const body = `${reasons.join(' / ')}\n${siteUrl ?? ''}`
            qByRowKey.set(rowKey, `"${body.replace(/"/g, '""')}"`)
          }
        } catch (err) {
          console.error('[handleOrderCopy] 취소 메타 조회 실패:', err)
          // 메타 조회 실패해도 기본 복사는 진행
        }
      }
    }

    // ── TSV 행 생성 (A~V = 22열) ──
    //   GAP 14열: G~T (인덱스 0~13). Q = GAP[10] (G=7번째 컬럼 → 17-7=10)
    const lines = targetRows.map((r) => {
      const gap = new Array(14).fill('')
      const q = qByRowKey?.get(getRowKey(r))
      if (q) gap[10] = q                            // Q열에만 채움
      const cols = [
        '',                                         // A
        '',                                         // B
        r.item_name,                                // C
        r.option_name,                              // D
        r.shipping_count,                           // E
        r.barcode,                                  // F
        ...gap,                                     // G~T
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
  }, [filteredItems, selectedIds, selectedStatuses, getRowStatus, orderItemsMap, getUserInfo])

  // ── [주문 전송] 핸들러 — ft_carts + ft_cart_items 일괄 insert ───
  //   기본 흐름: [주문 전송] 클릭 → 사전 검증 → CartNameInputModal 오픈
  //               → 사용자가 cart_name 입력 후 [저장] → 실제 전송
  const [orderSending, setOrderSending] = useState(false)
  const [orderSendModalOpen, setOrderSendModalOpen] = useState(false)

  /** [주문 전송] 버튼 onClick — 검증 통과 시 모달만 오픈 */
  const handleOrderSend = useCallback(() => {
    if (selectedIds.size === 0) {
      alert('전송할 주문을 선택해 주세요.')
      return
    }
    const { orderUserId } = getUserInfo()
    if (!orderUserId) {
      alert('주문 계정 정보가 없습니다. 관리자에게 문의하세요.')
      return
    }
    const targetRows = filteredItems.filter((r) => selectedIds.has(getRowKey(r)))
    if (targetRows.length === 0) {
      alert('전송할 주문이 없습니다.')
      return
    }
    setOrderSendModalOpen(true)
  }, [selectedIds, filteredItems, getUserInfo])

  /** 모달에서 [저장] 클릭 시 — 실제 전송 + 사용자 알림 */
  const handleConfirmOrderSend = useCallback(async (cartName: string) => {
    const { orderUserId } = getUserInfo()
    if (!orderUserId) {
      alert('주문 계정 정보가 없습니다. 관리자에게 문의하세요.')
      return
    }
    const targetRows = filteredItems.filter((r) => selectedIds.has(getRowKey(r)))
    if (targetRows.length === 0) {
      alert('전송할 주문이 없습니다.')
      return
    }

    setOrderSending(true)
    try {
      const { count } = await sendPersonalOrdersPre(targetRows, orderUserId, cartName)
      setSelectedIds(new Set())
      setOrderSendModalOpen(false)
      alert(`${count}건 전송 완료 (${cartName})`)
    } catch (err: any) {
      console.error('[주문 전송] 실패:', err)
      alert(`주문 전송 실패: ${err.message}`)
      // 모달은 그대로 → 사용자가 이름 바꿔 재시도 가능
    } finally {
      setOrderSending(false)
    }
  }, [selectedIds, filteredItems, getUserInfo])

  // ── 행 클릭 → 드로어 열기 ────────────────────────────────────
  //   주문 이력(ft_order_items)이 없는 행(미주문 등)도 비고 입력을 위해 모두 열림.
  const handleRowClick = useCallback((row: PersonalOrderRow) => {
    if (!row.order_id) return
    const key = makeFulfillmentKey(row.order_id, row.vendor_item_id)
    const oitems = orderItemsMap.get(key) ?? []
    const first = oitems[0]  // 이력 없으면 undefined → 행 값으로 폴백
    setSelectedDrawerItem({
      ids: oitems.map((oi) => oi.id),
      itemName: first?.item_name ?? row.item_name,
      optionName: first?.option_name ?? row.option_name,
      orderNo: first?.order_no ?? row.order_id,
      itemNo: first?.item_no ?? null,
      productNo: first?.product_no ?? null,
      noteOrderNo: row.order_id,
      noteOptionId: row.vendor_item_id,
    })
  }, [orderItemsMap])

  // ── 비고 저장 (드로어 입력폼 blur) ──────────────────────────
  const handleSaveNote = useCallback(async (orderNo: string, optionId: string | null, note: string) => {
    const { userId } = getUserInfo()
    if (!userId || !orderNo) return
    const key = makeFulfillmentKey(orderNo, optionId)
    const trimmed = note.trim()
    // 로컬 Map 선반영 (낙관적)
    setNoteMap((prev) => {
      const next = new Map(prev)
      if (trimmed === '') next.delete(key)
      else next.set(key, trimmed)
      return next
    })
    try {
      await saveOrderNote(userId, orderNo, optionId ?? '', trimmed)
    } catch {
      alert('비고 저장에 실패했습니다. (coupang_personal_orders_details 테이블 생성 여부를 확인하세요)')
    }
  }, [getUserInfo])

  // ── 입고준비 토글: 활성→해제 / 비활성→shipment 선택 모달 오픈 ──
  const handleInboundToggle = useCallback(async () => {
    if (inboundActive) {
      setInboundActive(false)
      setInboundAllocMap(new Map())
      setInboundDetails([])
      return
    }
    const { orderUserId } = getUserInfo()
    if (!orderUserId) { alert('주문 계정(order_user_id)이 없습니다.'); return }
    setInboundLoading(true)
    try {
      const opts = await fetchShipmentsWithin(orderUserId, 31)
      setShipmentOptions(opts)
      setInboundModalOpen(true)
    } catch (e: any) {
      alert('shipment 목록 조회 실패: ' + (e?.message ?? ''))
    } finally {
      setInboundLoading(false)
    }
  }, [inboundActive, getUserInfo])

  // ── 모달 [준비] → 상세 조회 + 바코드 할당(선착순·분할·부분충당) ──
  //   여러 shipment 를 동시에 선택 가능 → 재고를 합쳐 매칭
  const handleInboundConfirm = useCallback(async (shipmentIds: string[]) => {
    const { orderUserId } = getUserInfo()
    if (!orderUserId || shipmentIds.length === 0) return
    setInboundLoading(true)
    try {
      const detailLists = await Promise.all(
        shipmentIds.map((sid) => fetchShipmentDetails(sid, orderUserId)),
      )
      const details = detailLists.flat()

      // ── 재고: barcode → [{idx, box_code, remaining}] (box_code 오름차순) ──
      //   매칭 대상은 shipment_type='PERSONAL' 입고분만 (DIRECT/COUPANG 제외)
      const allocated = new Array<number>(details.length).fill(0)
      const stock = new Map<string, Array<{ idx: number; box_code: string; remaining: number }>>()
      details.forEach((d, idx) => {
        if (d.shipment_type !== 'PERSONAL') return
        if (!d.barcode || !d.quantity || d.quantity <= 0) return
        const arr = stock.get(d.barcode) ?? []
        arr.push({ idx, box_code: d.box_code ?? '', remaining: d.quantity })
        stock.set(d.barcode, arr)
      })
      for (const arr of stock.values()) arr.sort((a, b) => a.box_code.localeCompare(b.box_code))

      // ── 매칭 풀: 선택 탭 주문, 주문일 오름차순(선착순) ──
      const codes = selectedTabs.size > 0
        ? new Set(Array.from(selectedTabs).map((t) => STATUS_REVERSE_MAP[t]).filter(Boolean))
        : null
      const pool = items
        .filter((r) => !codes || codes.has(r.status))
        .slice()
        .sort((a, b) => {
          const da = a.ordered_at ? new Date(a.ordered_at).getTime() : 0
          const db = b.ordered_at ? new Date(b.ordered_at).getTime() : 0
          return da - db
        })

      const allocMap = new Map<string, { boxStr: string; matched: boolean }>()
      for (const row of pool) {
        const bc = row.barcode
        let need = row.shipping_count ?? 0
        if (!bc || need <= 0) continue
        const units = stock.get(bc)
        if (!units || units.length === 0) continue
        const parts: string[] = []
        for (const u of units) {
          if (need <= 0) break
          if (u.remaining <= 0) continue
          const take = Math.min(need, u.remaining)
          u.remaining -= take
          need -= take
          allocated[u.idx] += take
          parts.push(`${u.box_code} - ${take}`)
        }
        if (parts.length === 0) continue
        if (need > 0) parts.push('추가★')
        allocMap.set(getRowKey(row), { boxStr: `[${parts.join(', ')}]`, matched: true })
      }

      setInboundAllocMap(allocMap)
      // shipment_list 시트: PERSONAL + DIRECT 만
      setInboundDetails(
        details
          .map((d, idx) => ({ ...d, allocated: allocated[idx] }))
          .filter((d) => d.shipment_type === 'PERSONAL' || d.shipment_type === 'DIRECT'),
      )
      setInboundActive(true)
      setInboundModalOpen(false)
    } catch (e: any) {
      alert('입고준비 매칭 실패: ' + (e?.message ?? ''))
    } finally {
      setInboundLoading(false)
    }
  }, [getUserInfo, items, selectedTabs])

  // ── 입고엑셀: 시트1 Delivery(매칭 주문) + 시트2 shipment_list ──
  const handleInboundExcel = useCallback(() => {
    // 매칭된 주문 (주문일 오름차순)
    const deliveryRows = items
      .filter((r) => inboundAllocMap.get(getRowKey(r))?.matched)
      .slice()
      .sort((a, b) => {
        const da = a.ordered_at ? new Date(a.ordered_at).getTime() : 0
        const db = b.ordered_at ? new Date(b.ordered_at).getTime() : 0
        return da - db
      })

    if (deliveryRows.length === 0 && inboundDetails.length === 0) {
      alert('내보낼 데이터가 없습니다.')
      return
    }

    // 시트1: Delivery (등록상품명 앞에 박스 접두, ✔️ 제외)
    const aoa1 = buildDeliveryAoA(deliveryRows, (r) => {
      const a = inboundAllocMap.get(getRowKey(r))
      return a?.boxStr ? `${a.boxStr} ` : ''
    })

    // 시트2: shipment_list (구성 컬럼 + 출고/잔여)
    const SHIPMENT_HEADERS = [
      'box_code', 'shipment_no', 'product_no', 'barcode', 'item_name', 'option_name',
      'china_option1', 'china_option2', 'price_cny', 'shipment_size', '수량', '출고', '잔여', 'composition',
    ]
    const aoa2: (string | number)[][] = [
      SHIPMENT_HEADERS,
      ...inboundDetails.map((d) => [
        d.box_code ?? '', d.shipment_no ?? '', d.product_no ?? '', d.barcode ?? '',
        d.item_name ?? '', d.option_name ?? '', d.china_option1 ?? '', d.china_option2 ?? '',
        d.price_cny ?? '', d.shipment_size ?? '', d.quantity ?? 0,
        d.allocated, (d.quantity ?? 0) - d.allocated, d.composition ?? '',
      ]),
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa1), 'Delivery')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa2), 'shipment_list')
    const today = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `입고준비(${today}).xlsx`)
  }, [items, inboundAllocMap, inboundDetails])

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
      { label: '배송완료 송장 정리', state: 'pending' },
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
      // xlsx 운송장 등록 또는 기존 PDF가 있는 주문만 업로드
      const matched = pages.filter(
        (p) => orderIdSet.has(p.orderId)
          && (trackingMap.has(p.orderId) || invoiceOrderIds.has(p.orderId)),
      )
      const unmatched = pages.filter(
        (p) => !orderIdSet.has(p.orderId)
          || (!trackingMap.has(p.orderId) && !invoiceOrderIds.has(p.orderId)),
      )

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

      // 업로드된 order_id 를 invoiceOrderIds 에 즉시 반영 (📝 표시 제거)
      if (result.success > 0) {
        setInvoiceOrderIds((prev) => {
          const next = new Set(prev)
          for (const p of matched) next.add(p.orderId)
          return next
        })
      }

      // STEP 4: 배송완료 송장 정리 — 준비중/배송지시 없이 배송완료만 남은 주문의 파일 삭제
      updateStep(3, 'active')
      const ACTIVE_STATUSES = new Set(['INSTRUCT', 'DEPARTURE'])
      const TERMINAL_STATUS = 'FINAL_DELIVERY'

      // order_id → 현재 주문의 status Set (동일 order_id 여러 행 고려)
      const orderStatuses = new Map<string, Set<string>>()
      for (const row of items) {
        if (!row.order_id) continue
        const s = orderStatuses.get(row.order_id) ?? new Set<string>()
        s.add(row.status)
        orderStatuses.set(row.order_id, s)
      }

      // 삭제 대상 추출:
      //   - 활성 상태(상품준비중/배송지시) 없음
      //   - 배송완료 포함
      //   - Storage 파일 존재(invoiceOrderIds) — 불필요한 remove 호출 방지
      // 업로드 직후 반영된 Set 기준으로 판단
      const nowInvoiceSet = new Set(invoiceOrderIds)
      for (const p of matched) nowInvoiceSet.add(p.orderId)

      const deleteOrderIds: string[] = []
      for (const [orderId, statuses] of orderStatuses) {
        const hasActive = [...statuses].some((st) => ACTIVE_STATUSES.has(st))
        const hasTerminal = statuses.has(TERMINAL_STATUS)
        if (!hasActive && hasTerminal && nowInvoiceSet.has(orderId)) {
          deleteOrderIds.push(orderId)
        }
      }

      let cleanupResult: { deleted: number; errors: string[] } = { deleted: 0, errors: [] }
      if (deleteOrderIds.length > 0) {
        cleanupResult = await deleteInvoicesByOrderIds(userId, deleteOrderIds)
        if (cleanupResult.deleted > 0) {
          // 로컬 Set 에서도 제거 (📝 표시 갱신)
          setInvoiceOrderIds((prev) => {
            const next = new Set(prev)
            for (const id of deleteOrderIds) next.delete(id)
            return next
          })
        }
      }
      updateStep(3, 'done', `${cleanupResult.deleted}건 정리`)

      setProgressStatus(
        `완료 — 업로드 ${result.success}, 매칭 실패 ${unmatched.length}, 정리 ${cleanupResult.deleted}` +
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
  }, [items, invoiceOrderIds, trackingMap, getUserInfo, updateStep, closeProgress])

  // ── [송장 xlsx] 핸들러 — 엑셀 운송장 번호 업로드 ──────────────────
  const handleInvoiceXlsxUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const { userId } = getUserInfo()
    if (!userId) {
      alert('로그인 정보를 확인해 주세요.')
      return
    }

    setInvoiceXlsxUploading(true)
    try {
      // STEP 1: 파일 읽기
      const binaryStr = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (ev) => resolve(ev.target?.result as string)
        reader.onerror = () => reject(new Error('파일 읽기 실패'))
        reader.readAsBinaryString(file)
      })
      const workbook = XLSX.read(binaryStr, { type: 'binary' })
      const worksheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][]

      // STEP 2: 파싱 — C열(index 2) = 주문번호, E열(index 4) = 운송장번호
      const orderIdSet = new Set(items.map((r) => r.order_id).filter(Boolean))
      const parsed: { user_id: string; order_id: string; invoice_number: string }[] = []
      let unmatchedCount = 0

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        if (!row) continue

        const orderId = row[2] != null ? String(row[2]).trim() : ''
        const invoiceNum = row[4] != null ? String(row[4]).trim() : ''
        const skipFlag = row[5] != null ? String(row[5]).trim().toUpperCase() : ''

        if (!orderId || !invoiceNum) continue
        if (skipFlag === 'N') continue // F열 "N" → 저장 불필요

        if (orderIdSet.has(orderId)) {
          parsed.push({ user_id: userId, order_id: orderId, invoice_number: invoiceNum })
        } else {
          unmatchedCount++
        }
      }

      if (parsed.length === 0) {
        alert(`매칭 가능한 데이터가 없습니다.${unmatchedCount > 0 ? `\n(미매칭: ${unmatchedCount}건)` : ''}`)
        return
      }

      // STEP 3: DB 저장
      const { success, errors } = await upsertTrackingNumbers(parsed)

      // STEP 4: 로컬 상태 갱신
      setTrackingMap((prev) => {
        const next = new Map(prev)
        for (const r of parsed) {
          next.set(r.order_id, r.invoice_number)
        }
        return next
      })

      alert(
        `송장 xlsx 업로드 완료!\n` +
        `매칭 저장: ${success}건${errors > 0 ? `, 실패: ${errors}건` : ''}` +
        `${unmatchedCount > 0 ? `\n미매칭(주문번호 없음): ${unmatchedCount}건` : ''}`,
      )
    } catch (err: any) {
      console.error('[송장 xlsx] 실패:', err)
      alert(`송장 xlsx 업로드 중 오류가 발생했습니다.\n${err.message || ''}`)
    } finally {
      setInvoiceXlsxUploading(false)
      if (invoiceXlsxInputRef.current) invoiceXlsxInputRef.current.value = ''
    }
  }, [items, getUserInfo])

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

    // 선택된 행(row.id) → order_id 매핑 (중복 제거)
    const orderIds = Array.from(
      new Set(
        items
          .filter((r) => selectedIds.has(getRowKey(r)))
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
  //   selectedIds 키 = row.id (uuid). 한 송장박스(shipment_box_id)에 여러
  //   아이템이 들어있는 케이스에서 행 하나만 선택 가능하도록 행별 유일 키 사용.
  //   id 가 없는 행은 (shipment_box_id|vendor_item_id) fallback.

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        const ids = new Set(pagedItems.map(getRowKey))
        setSelectedIds(ids)
      } else {
        setSelectedIds(new Set())
      }
    },
    [pagedItems],
  )

  const handleSelectRow = useCallback(
    (rowKey: string, checked: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (checked) next.add(rowKey)
        else next.delete(rowKey)
        return next
      })
    },
    [],
  )

  const isAllSelected =
    pagedItems.length > 0 && pagedItems.every((r) => selectedIds.has(getRowKey(r)))

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
    selectedTabs,
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
    showCartOnly,
    showReleaseStopOnly,
    showNoInvoiceOnly,
    showReorderOnly,
    showNoteOnly,
    selectedStatuses,
    invoiceOrderIds,
    selectedDrawerItem,
    setSelectedDrawerItem,
    noteMap,
    handleSaveNote,

    // 입고준비 / 입고엑셀
    inboundActive,
    inboundLoading,
    inboundModalOpen,
    setInboundModalOpen,
    shipmentOptions,
    inboundAllocMap,
    handleInboundToggle,
    handleInboundConfirm,
    handleInboundExcel,

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
    handleOrderSend,
    orderSending,
    orderSendModalOpen,
    setOrderSendModalOpen,
    handleConfirmOrderSend,
    handleRowClick,
    handleBarcodeLink,
    barcodeLoading,
    handleInvoiceLink,
    invoiceLinking,
    handleInvoiceXlsxUpload,
    invoiceXlsxUploading,
    invoiceXlsxInputRef,
    trackingMap,
    handleInvoicePrint,
    invoicePrinting,
    handleSelectAll,
    handleSelectRow,
    toggleUnorderedOnly,
    toggleCartOnly,
    toggleReleaseStopOnly,
    toggleNoInvoiceOnly,
    toggleReorderOnly,
    toggleNoteOnly,
    toggleStatusFilter,

    // fulfillment 헬퍼
    getAgg,
    getRowStatus,
    reorderCountMap,
  }
}
