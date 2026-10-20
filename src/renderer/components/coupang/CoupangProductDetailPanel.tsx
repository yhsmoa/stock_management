/* ================================================================
   상품관리 — 상품 상세 패널 (오른쪽 슬라이드)
   - [정보] 탭: 저장된 행(si_coupang_items)으로 바로 그리고, 상태 변경 이력만 쿠팡 API 로 받는다
   - [수정] 탭: 쿠팡 최신 상세를 받아 배송·반품(즉시) · 상품 정보·옵션(재승인)을 고친다
     (CoupangProductEditForm — 탭을 열 때만 쿠팡을 부른다)
   ================================================================ */

import React, { useEffect, useState } from 'react'
import type { CoupangProductGroup, ApiProductHistory, CoupangNotice } from '../../types/coupangProduct'
import { productKind, rowChannel } from '../../types/coupangProduct'
import { fetchProductHistories, fetchProductNotices } from '../../services/coupangProductService'
import { isCompositionNoticeName } from '../../services/coupangNotices'
import { num, won, deliveryChargeLabel, shortDateTime } from './format'
import CoupangProductEditForm from './CoupangProductEditForm'
import { useCoupangProductEdit } from './useCoupangProductEdit'

interface Props {
  group: CoupangProductGroup
  userId: string
  busy: boolean
  onClose: () => void
  onRefetch: (itemId: string) => void
  /** 수정이 쿠팡에 반영된 뒤 — 목록 다시 읽기 */
  onChanged: () => void
}

type PanelTab = 'info' | 'edit'

/** [수정] 탭 — 이 컴포넌트가 그려질 때만 쿠팡 최신 상세를 받는다 */
const EditTab: React.FC<{ userId: string; itemId: string; onChanged: () => void }> = ({ userId, itemId, onChanged }) => {
  const edit = useCoupangProductEdit(userId, itemId, onChanged)
  return <CoupangProductEditForm edit={edit} />
}

const CoupangProductDetailPanel: React.FC<Props> = ({ group, userId, busy, onClose, onRefetch, onChanged }) => {
  const [tab, setTab] = useState<PanelTab>('info')
  const [histories, setHistories] = useState<ApiProductHistory[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)

  // 고시정보 — DB 에 저장된 값 (상세 받기 때 저장). undefined = 읽는 중, null = 받은 적 없음
  const [notices, setNotices] = useState<{ list: CoupangNotice[] | null; composition: string | null } | undefined>(undefined)
  const [noticeError, setNoticeError] = useState<string | null>(null)

  // 다른 상품을 열면 [정보] 탭부터
  useEffect(() => { setTab('info') }, [group.itemId])

  // 고시정보 — 패널을 열 때 상품 1개만 (목록 조회에는 싣지 않는다)
  useEffect(() => {
    let cancelled = false
    setNotices(undefined)
    setNoticeError(null)
    fetchProductNotices(userId, group.itemId)
      .then((r) => { if (!cancelled) setNotices({ list: r.notices, composition: r.composition }) })
      .catch((err) => { if (!cancelled) setNoticeError(err instanceof Error ? err.message : '고시정보 조회 실패') })
    return () => { cancelled = true }
  }, [userId, group.itemId])

  // 상태 변경 이력 — 패널을 열 때 한 번
  useEffect(() => {
    let cancelled = false
    setHistories(null)
    setHistoryError(null)
    fetchProductHistories(group.itemId)
      .then((h) => { if (!cancelled) setHistories(h) })
      .catch((err) => { if (!cancelled) setHistoryError(err instanceof Error ? err.message : '이력 조회 실패') })
    return () => { cancelled = true }
  }, [group.itemId])

  // Esc 로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const first = group.rows[0]
  const kind = productKind(group.summary, group.rows)
  const kindLabel = kind === 'hybrid' ? '전체 (로켓 + 일반)' : kind === 'rg' ? '로켓그로스' : '일반'
  const lastDetail = group.rows.map((r) => r.detail_synced_at).filter((v): v is string => !!v).sort().pop() ?? null

  return (
    <>
      <div className="cp-panel-overlay" onClick={onClose} aria-hidden="true" />
      <aside className={`cp-panel${tab === 'edit' ? ' cp-panel-wide' : ''}`} role="dialog" aria-label="상품 상세">
        <header className="cp-panel-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className={`cp-badge ${kind === 'hybrid' ? 'cp-badge-hybrid' : kind === 'rg' ? 'cp-badge-rg' : 'cp-badge-mp'}`}>{kindLabel}</span>
              {group.approval && (
                <span className={`cp-badge${group.approval === '승인완료' ? '' : ' cp-badge-warn'}`}>{group.approval}</span>
              )}
              {first?.delivery_charge_type && (
                <span className="cp-badge">{deliveryChargeLabel(first.delivery_charge_type, first.delivery_charge, first.free_ship_over_amount)}</span>
              )}
            </div>
            <h2>{group.itemName}</h2>
            <div className="cp-num" style={{ fontSize: 12, color: '#6B7280' }}>
              등록상품 {group.itemId}
              {' · '}
              {group.productId
                ? <a href={`https://www.coupang.com/vp/products/${group.productId}`} target="_blank" rel="noreferrer">노출상품 {group.productId} ↗</a>
                : '노출상품 ID 없음'}
              {' · '}상세 받은 시각 {lastDetail ? shortDateTime(lastDetail) : '없음'}
            </div>
          </div>
          <button type="button" className="cp-btn cp-btn-icon" aria-label="닫기" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        {/* ── 탭 ── */}
        <div className="cp-panel-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'info'} className={tab === 'info' ? 'is-active' : ''} onClick={() => setTab('info')}>정보</button>
          <button type="button" role="tab" aria-selected={tab === 'edit'} className={tab === 'edit' ? 'is-active' : ''} onClick={() => setTab('edit')}>수정</button>
        </div>

        {tab === 'edit' ? (
          <div className="cp-panel-body">
            <EditTab userId={userId} itemId={group.itemId} onChanged={onChanged} />
          </div>
        ) : (
        <div className="cp-panel-body">
          {/* ── 이미지 · 기본 정보 ── */}
          <section className="cp-panel-section" style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
            <div className="cp-panel-image" role="img" aria-label="대표 이미지">
              {group.imgUrl ? <img src={group.imgUrl} alt="" /> : '이미지 없음'}
            </div>
            <dl className="cp-dl" style={{ flex: 1 }}>
              <dt>노출상품명</dt><dd>{first?.product_name ?? '—'}</dd>
              <dt>등록상품명</dt><dd>{first?.item_name ?? '—'}</dd>
              <dt>상품상태</dt><dd>{first?.item_status ?? '—'}</dd>
              <dt>배송비</dt><dd>{deliveryChargeLabel(first?.delivery_charge_type, first?.delivery_charge, first?.free_ship_over_amount)}</dd>
            </dl>
          </section>

          {/* ── 옵션 (이 페이지에 보이는 행) ── */}
          <section className="cp-panel-section">
            <h3>옵션 {group.summary ? `${num(group.summary.totalOptions)}개` : ''}{group.summary && group.summary.totalOptions > group.rows.length ? ` (이 페이지 ${group.rows.length}개만 표시)` : ''}</h3>
            <div className="cp-panel-table cp-num">
              <div className="cp-panel-row is-head"><div>옵션명</div><div>구분</div><div className="cp-right">판매가</div><div className="cp-right">재고</div><div>상태</div></div>
              {group.rows.map((r) => (
                <div key={r.option_id} className="cp-panel-row">
                  <div className="cp-ellipsis" title={r.option_name ?? ''}>{r.option_name ?? '—'}</div>
                  <div>{rowChannel(r) === 'RG' ? '로켓' : '일반'}</div>
                  <div className="cp-right">{won(r.price)}</div>
                  <div className={`cp-right${r.stock === 0 ? ' cp-stock-zero' : ''}`}>{num(r.stock)}</div>
                  <div style={{ fontSize: 12 }}>{r.sales_status ?? '미확인'}</div>
                </div>
              ))}
            </div>
          </section>

          {/* ── 고시정보 (상세 받기 때 저장한 값) ── */}
          <section className="cp-panel-section">
            <h3>
              고시정보
              {notices?.list && notices.list[0]?.category && <span className="cp-notice-category"> · {notices.list[0].category}</span>}
            </h3>
            {noticeError && <div style={{ color: '#B91C1C', fontSize: 12 }}>{noticeError}</div>}
            {!noticeError && notices === undefined && <div style={{ color: '#6B7280', fontSize: 12 }}>불러오는 중…</div>}
            {notices && notices.list === null && (
              <div style={{ color: '#6B7280', fontSize: 12 }}>
                아직 받지 않았습니다 — 아래 [이 상품 다시 받기] 나 [상세 받기] › 고시정보 받기 뒤에 보입니다.
              </div>
            )}
            {notices?.list && notices.list.length === 0 && <div style={{ color: '#6B7280', fontSize: 12 }}>쿠팡에 등록된 고시정보가 없습니다.</div>}
            {notices?.list && notices.list.length > 0 && (
              <>
                <dl className="cp-dl">
                  {notices.list.map((n, i) => {
                    const isComposition = isCompositionNoticeName(n.name)
                    return (
                      <React.Fragment key={i}>
                        <dt className={isComposition ? 'cp-notice-key' : undefined}>{n.name}</dt>
                        <dd className={isComposition ? 'cp-notice-key' : undefined}>{n.content || '—'}</dd>
                      </React.Fragment>
                    )
                  })}
                </dl>
                <div className="cp-notice-composition">
                  라벨 혼용률: {notices.composition
                    ? <b>{notices.composition}</b>
                    : <span>없음 (소재 칸이 비었거나 "상세페이지 참조" 같은 안내 문구 — 상품정보 화면에서 직접 입력하면 그 값을 씁니다)</span>}
                </div>
              </>
            )}
          </section>

          {/* ── 상태 변경 이력 (쿠팡 API) ── */}
          <section className="cp-panel-section">
            <h3>상태 변경 이력</h3>
            {historyError && <div style={{ color: '#B91C1C', fontSize: 12 }}>{historyError}</div>}
            {!historyError && histories === null && <div style={{ color: '#6B7280', fontSize: 12 }}>불러오는 중…</div>}
            {histories && histories.length === 0 && <div style={{ color: '#6B7280', fontSize: 12 }}>이력이 없습니다.</div>}
            {histories && histories.length > 0 && (
              <ol className="cp-history">
                {histories.map((h, i) => (
                  <li key={i}>
                    <div className="cp-history-date cp-num">{shortDateTime(h.createdAt)}</div>
                    <div>
                      <strong style={{ fontWeight: 600 }}>{h.statusName ?? '—'}</strong>
                      {h.createdBy && <span style={{ color: '#6B7280' }}> · {h.createdBy}</span>}
                      {h.comment && <div className="cp-history-comment">{h.comment}</div>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
        )}

        <footer className="cp-panel-foot">
          {group.productId && (
            <a className="cp-btn" href={`https://www.coupang.com/vp/products/${group.productId}`} target="_blank" rel="noreferrer">쿠팡에서 보기 ↗</a>
          )}
          <button type="button" className="cp-btn cp-btn-primary" disabled={busy} onClick={() => onRefetch(group.itemId)}>이 상품 다시 받기</button>
        </footer>
      </aside>
    </>
  )
}

export default CoupangProductDetailPanel
