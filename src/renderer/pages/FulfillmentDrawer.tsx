/* ================================================================
   Fulfillment 히스토리 드로어
   - 선택된 ft_order_items.id의 fulfillment 이력을 우측 패널로 표시
   - purchase_agent FulfillmentDrawer.tsx를 CSS(po- prefix) 버전으로 이식
   ================================================================ */

import React, { useState, useEffect, useCallback } from 'react'
import {
  fetchFulfillmentHistory,
  type FulfillmentRow,
} from '../services/orderFulfillmentService'
import { checkInvoiceExists, printInvoice } from '../services/invoiceService'
import type { AuthUser } from '../types/auth'

// ── Props ──────────────────────────────────────────────────────────
interface Props {
  itemIds: string[]          // ft_order_items.id 배열 (여러 재주문 이력 포함)
  itemName: string | null
  optionName: string | null
  orderNo: string | null
  itemNo: string | null
  productNo: string | null
  onClose: () => void
}

// ── 타입 배지 설정 ────────────────────────────────────────────────
const TYPE_CONFIG: Record<string, { label: string; className: string }> = {
  ARRIVAL:  { label: '입고', className: 'po-badge-gray' },
  PACKED:   { label: '패킹', className: 'po-badge-gray' },
  SHIPMENT: { label: '출고', className: 'po-badge-blue' },
  CANCEL:   { label: '취소', className: 'po-badge-red' },
  RETURN:   { label: '취소', className: 'po-badge-red' },
  arrival:  { label: '입고', className: 'po-badge-gray' },
  cancel:   { label: '취소', className: 'po-badge-red' },
  ship:     { label: '출고', className: 'po-badge-blue' },
  partial:  { label: '부분입고', className: 'po-badge-gray' },
}

// ── 날짜 포맷 헬퍼 ────────────────────────────────────────────────
function formatDateTime(iso: string): string {
  return iso.replace('T', ' ').slice(0, 19)
}

// ── 컴포넌트 ──────────────────────────────────────────────────────
const FulfillmentDrawer: React.FC<Props> = ({
  itemIds, itemName, optionName, orderNo, itemNo, productNo, onClose,
}) => {
  const [rows, setRows] = useState<FulfillmentRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasInvoice, setHasInvoice] = useState(false)

  const isOpen = itemIds.length > 0

  // ── 사용자 정보 (order_user_id) ─────────────────────────────────
  const getOrderUserId = useCallback((): string => {
    const raw = localStorage.getItem('user')
    if (!raw) return ''
    const user: AuthUser = JSON.parse(raw)
    return user.order_user_id ?? ''
  }, [])

  // ── 사용자 ID (Storage 경로용) ──────────────────────────────────
  const getUserId = useCallback((): string => {
    const raw = localStorage.getItem('user')
    if (!raw) return ''
    const user: AuthUser = JSON.parse(raw)
    return user.id ?? ''
  }, [])

  // ── 이력 조회 + 송장 존재 확인 ────────────────────────────────
  const fetchData = useCallback(async () => {
    if (itemIds.length === 0) { setRows([]); setHasInvoice(false); return }
    const orderUserId = getOrderUserId()
    if (!orderUserId) { setRows([]); setHasInvoice(false); return }

    setIsLoading(true)
    setHasInvoice(false)
    try {
      const data = await fetchFulfillmentHistory(itemIds, orderUserId)
      setRows(data)

      // 송장 PDF 존재 여부 확인
      if (orderNo) {
        const userId = getUserId()
        if (userId) {
          const exists = await checkInvoiceExists(userId, orderNo)
          setHasInvoice(exists)
        }
      }
    } catch (err) {
      console.error('[FulfillmentDrawer] 이력 조회 실패:', err)
      setRows([])
    } finally {
      setIsLoading(false)
    }
  }, [itemIds, orderNo, getOrderUserId, getUserId])

  useEffect(() => { fetchData() }, [fetchData])

  // ── 송장 인쇄 ─────────────────────────────────────────────────
  const handlePrintInvoice = useCallback(async () => {
    if (!orderNo) return
    const userId = getUserId()
    if (!userId) return
    await printInvoice(userId, orderNo)
  }, [orderNo, getUserId])

  // ── ESC 키로 닫기 ──────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // ── 렌더 ────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Backdrop ── */}
      <div
        className={`po-drawer-backdrop${isOpen ? ' open' : ''}`}
        onClick={onClose}
      />

      {/* ── Drawer panel ── */}
      <aside className={`po-drawer${isOpen ? ' open' : ''}`}>

        {/* ── Header ── */}
        <div className="po-drawer-header">
          <div className="po-drawer-header-info">
            <span className="po-drawer-label">Fulfillment History</span>
            <p className="po-drawer-product">
              {[itemName, optionName].filter(Boolean).join(', ') || '상품 정보 없음'}
            </p>
            <p className="po-drawer-meta">
              {orderNo ?? '-'}
              {hasInvoice && (
                <button
                  className="po-invoice-print-btn"
                  title="송장 인쇄"
                  onClick={handlePrintInvoice}
                >
                  📄
                </button>
              )}
            </p>
            <p className="po-drawer-meta">
              {[productNo, itemNo].filter(Boolean).join(' | ') || '-'}
            </p>
          </div>
          <button className="po-drawer-close" onClick={onClose}>✕</button>
        </div>

        {/* ── Body ── */}
        <div className="po-drawer-body">
          {isLoading ? (
            <div className="po-drawer-empty">불러오는 중...</div>
          ) : rows.length === 0 ? (
            <div className="po-drawer-empty">이력이 없습니다.</div>
          ) : (
            <table className="po-drawer-table">
              <thead>
                <tr>
                  <th style={{ width: '160px' }}>일시</th>
                  <th style={{ width: '70px' }}>타입</th>
                  <th style={{ width: '50px', textAlign: 'center' }}>수량</th>
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((row) => {
                  const nodes: React.ReactNode[] = []

                  // ── 메인 행 ──
                  const cfg = row.type ? TYPE_CONFIG[row.type] : null
                  nodes.push(
                    <tr key={row.id}>
                      <td className="po-drawer-cell-date">
                        {formatDateTime(row.created_at)}
                      </td>
                      <td>
                        {cfg ? (
                          <span className={`po-type-badge ${cfg.className}`}>
                            {cfg.label}
                          </span>
                        ) : (
                          <span className="po-type-badge po-badge-gray">
                            {row.type ?? '-'}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {row.quantity != null ? row.quantity.toLocaleString() : '-'}
                      </td>
                    </tr>,
                  )

                  // ── 취소사유 행 (CANCEL / RETURN 모두 포함) ──
                  if ((row.type === 'CANCEL' || row.type === 'RETURN') && row.cancel_reason) {
                    nodes.push(
                      <tr key={`${row.id}-reason`} className="po-drawer-cancel-row">
                        <td colSpan={3}>취소사유: {row.cancel_reason}</td>
                      </tr>,
                    )
                  }

                  // ── ��고 송장 행 ──
                  if (row.shipment_no) {
                    nodes.push(
                      <tr key={`${row.id}-ship`}>
                        <td className="po-drawer-cell-date">{row.shipment_no}</td>
                        <td>
                          <span className="po-type-badge po-badge-blue">출고</span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {row.quantity != null ? row.quantity.toLocaleString() : '-'}
                        </td>
                      </tr>,
                    )
                  }

                  return nodes
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Footer ── */}
        {!isLoading && rows.length > 0 && (
          <div className="po-drawer-footer">
            총 <strong>{rows.length}건</strong>의 이력
          </div>
        )}
      </aside>
    </>
  )
}

export default FulfillmentDrawer
