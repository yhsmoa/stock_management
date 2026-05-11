/* ================================================================
   OrderModal — 사입관리 '주문' 열 조회 조건 설정 모달
   - 섹션1: shipment_type (포함할 주문 유형 선택, 기본 COUPANG 체크)
   - 섹션2: 출고일 (차감할 출고건 선택, 기본 전체 체크)
   - [적용] 클릭 시 선택값을 onApply 콜백으로 전달
   ================================================================ */

import { useEffect, useState } from 'react'
import {
  fetchRecentShipments,
  type ShipmentOption,
  type ShipmentType,
} from '../../services/orderFulfillmentService'
import { getOrderUserId } from '../../services/supabase'

// ── 상수 ──────────────────────────────────────────────────────────
const SHIPMENT_TYPES: ShipmentType[] = ['COUPANG', 'DIRECT', 'PERSONAL']
const RECENT_SHIPMENT_LIMIT = 2

// ── Props ─────────────────────────────────────────────────────────
interface OrderModalProps {
  isOpen: boolean
  onClose: () => void
  onApply: (includeTypes: ShipmentType[], excludeShipmentIds: string[]) => void
}

// ══════════════════════════════════════════════════════════════════
// OrderModal
// ══════════════════════════════════════════════════════════════════
export default function OrderModal({ isOpen, onClose, onApply }: OrderModalProps) {
  // ── 상태 ────────────────────────────────────────────────────────
  const [shipments, setShipments] = useState<ShipmentOption[]>([])
  const [selectedTypes, setSelectedTypes] = useState<Set<ShipmentType>>(new Set(['COUPANG']))
  const [checkedShipmentIds, setCheckedShipmentIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── 모달 열릴 때 최근 출고일 조회 (현재 사용자 기준) ──────────
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false

    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const orderUserId = await getOrderUserId()
        if (cancelled) return
        if (!orderUserId) {
          setError('로그인 사용자의 order_user_id 가 없습니다.')
          setShipments([])
          return
        }
        const list = await fetchRecentShipments(orderUserId, RECENT_SHIPMENT_LIMIT)
        if (cancelled) return
        setShipments(list)
        // 기본: 전체 출고일 체크 (= 전부 차감)
        setCheckedShipmentIds(new Set(list.map((s) => s.id)))
      } catch (e) {
        if (cancelled) return
        console.error('[OrderModal] fetchRecentShipments', e)
        setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [isOpen])

  if (!isOpen) return null

  // ── 체크박스 토글 헬퍼 ─────────────────────────────────────────
  const toggleType = (t: ShipmentType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }
  const toggleShipment = (id: string) => {
    setCheckedShipmentIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── 적용 ────────────────────────────────────────────────────────
  const handleApply = () => {
    const includeTypes = Array.from(selectedTypes)
    // 미체크된 출고일 = 차감 제외 대상
    const excludeIds = shipments
      .filter((s) => !checkedShipmentIds.has(s.id))
      .map((s) => s.id)
    onApply(includeTypes, excludeIds)
    onClose()
  }

  // ══════════════════════════════════════════════════════════════
  // 렌더
  // ══════════════════════════════════════════════════════════════
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ minWidth: '340px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 600 }}>
          주문 조회 조건
        </h3>

        {/* ── 섹션 1: shipment_type (포함) ───────────────────── */}
        <div className="order-modal-section">
          <div className="order-modal-section-title">
            주문 유형{' '}
            <span style={{ fontWeight: 400, color: '#6B7280', fontSize: '11px' }}>
              (선택된 유형만 포함)
            </span>
          </div>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {SHIPMENT_TYPES.map((t) => (
              <label key={t} className="order-modal-checkbox">
                <input
                  type="checkbox"
                  checked={selectedTypes.has(t)}
                  onChange={() => toggleType(t)}
                />
                <span>{t}</span>
              </label>
            ))}
          </div>
        </div>

        {/* ── 섹션 2: 출고일 (체크 = 차감) ──────────────────── */}
        <div className="order-modal-section">
          <div className="order-modal-section-title">
            출고일{' '}
            <span style={{ fontWeight: 400, color: '#6B7280', fontSize: '11px' }}>
              (체크된 출고건을 차감)
            </span>
          </div>
          {loading && <div style={{ fontSize: '12px', color: '#6B7280' }}>불러오는 중...</div>}
          {error && (
            <div style={{ fontSize: '12px', color: '#EF4444' }}>조회 실패: {error}</div>
          )}
          {!loading && !error && shipments.length === 0 && (
            <div style={{ fontSize: '12px', color: '#9CA3AF' }}>최근 출고 내역이 없습니다.</div>
          )}
          {shipments.map((s) => (
            <label key={s.id} className="order-modal-checkbox">
              <input
                type="checkbox"
                checked={checkedShipmentIds.has(s.id)}
                onChange={() => toggleShipment(s.id)}
              />
              <span style={{ fontWeight: 500 }}>{s.date}</span>
              {s.shipment_no && (
                <span style={{ color: '#6B7280', fontSize: '12px' }}>
                  ({s.shipment_no})
                </span>
              )}
            </label>
          ))}
        </div>

        {/* ── 푸터 ───────────────────────────────────────────── */}
        <div className="order-modal-footer">
          <button className="purchase-btn" onClick={onClose}>
            취소
          </button>
          <button
            className="purchase-btn"
            style={{ background: '#3B82F6', color: '#fff', borderColor: '#3B82F6' }}
            onClick={handleApply}
            disabled={loading || selectedTypes.size === 0}
          >
            적용
          </button>
        </div>
      </div>
    </div>
  )
}
