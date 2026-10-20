/* ================================================================
   상품관리 — 상세 패널 [수정] 탭 폼
   - ① 배송·반품 (승인 없이 즉시) ② 상품 정보 · 검색태그 ③ 옵션 값 (②③은 쿠팡 재승인 후 반영)
   - 바꾼 칸은 파란 테두리로 표시. 상태가 임시저장·승인대기면 전부 잠근다
   - 상태·저장은 useCoupangProductEdit, 쿠팡 호출은 services/coupangProductEditService
   ================================================================ */

import React, { useEffect, useMemo, useState } from 'react'
import type { CoupangProductEditState } from './useCoupangProductEdit'
import type { ChannelValues, ShippingValues } from '../../types/coupangProductEdit'
import { SEARCH_TAG_MAX_COUNT, SEARCH_TAG_MAX_LENGTH } from '../../services/coupangProductEditService'
import { compareOptionNames } from './optionSort'

// ── 쿠팡 코드값 (상품 생성/수정 문서) ─────────────────────────────
const DELIVERY_CHARGE_TYPES: [string, string][] = [
  ['FREE', '무료배송'],
  ['NOT_FREE', '유료배송'],
  ['CHARGE_RECEIVED', '착불'],
  ['CONDITIONAL_FREE', '조건부 무료'],
]
const DELIVERY_METHODS: [string, string][] = [
  ['SEQUENCIAL', '일반배송'],
  ['COLD_FRESH', '신선냉동'],
  ['MAKE_ORDER', '주문제작'],
  ['AGENT_BUY', '구매대행'],
  ['VENDOR_DIRECT', '설치배송·직접전달'],
]
const UNION_DELIVERY: [string, string][] = [
  ['UNION_DELIVERY', '묶음배송 가능'],
  ['NOT_UNION_DELIVERY', '묶음배송 불가'],
]
/** 자주 쓰는 택배사 코드 — 제안 목록일 뿐, 다른 코드도 직접 입력할 수 있다 */
const COMMON_COURIERS: [string, string][] = [
  ['CJGLS', 'CJ대한통운'],
  ['HANJIN', '한진택배'],
  ['HYUNDAI', '롯데택배'],
  ['EPOST', '우체국택배'],
  ['LOGEN', '로젠택배'],
  ['KDEXP', '경동택배'],
]
const OFFER_CONDITION_LABELS: Record<string, string> = {
  NEW: '새상품', REFURBISHED: '리퍼', USED_BEST: '중고(최상)', USED_GOOD: '중고(상)', USED_NORMAL: '중고(중)',
}

/** 'yyyy-MM-ddTHH:mm:ss' ↔ datetime-local('yyyy-MM-ddTHH:mm') */
const toLocalInput = (v: string) => (v ? v.slice(0, 16) : '')
const fromLocalInput = (v: string) => (v ? `${v}:00` : '')

/** 숫자 입력 → number | null (빈 칸은 null) */
const toIntOrNull = (v: string): number | null => {
  const s = v.replace(/,/g, '').trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

interface Props {
  edit: CoupangProductEditState
}

const CoupangProductEditForm: React.FC<Props> = ({ edit }) => {
  const { view, loading, loadError, lockReason, saving, message } = edit

  // ── 검색태그: 입력 중 쉼표를 자유롭게 쓰도록 글자 상태를 따로 둔다 ──
  const [tagText, setTagText] = useState('')
  useEffect(() => { setTagText((view?.searchTags ?? []).join(', ')) }, [view])

  const items = useMemo(
    () => (view ? [...view.items].sort((a, b) => compareOptionNames(a.itemName, b.itemName)) : []),
    [view],
  )

  if (loading && !view) return <div className="cp-edit-empty">쿠팡에서 최신 정보를 받는 중…</div>
  if (loadError) {
    return (
      <div className="cp-edit-empty">
        <div style={{ color: '#B91C1C' }}>{loadError}</div>
        <button type="button" className="cp-btn cp-btn-xs" onClick={() => void edit.reload()}>다시 받기</button>
      </div>
    )
  }
  if (!view) return null

  const locked = !!lockReason || !!saving
  const productChanged = edit.productChanges.length > 0

  // ── 칸 헬퍼 ──
  const changedCls = (changed: boolean) => (changed ? ' is-changed' : '')

  const shipInput = (field: keyof ShippingValues, label: string, unit: string) => {
    const value = edit.shippingValue(field)
    const isChanged = value !== (view.shipping?.[field] ?? null)
    return (
      <div className="cp-edit-field">
        <label>{label}</label>
        <div className="cp-edit-inline">
          <input
            className={`cp-input cp-input-num cp-edit-input${changedCls(isChanged)}`}
            inputMode="numeric"
            disabled={locked}
            value={value == null ? '' : String(value)}
            onChange={(e) => edit.setShipping(field, toIntOrNull(e.target.value) as never)}
          />
          <span className="cp-inline-unit">{unit}</span>
        </div>
      </div>
    )
  }

  const shipSelect = (field: keyof ShippingValues, label: string, options: [string, string][]) => {
    const value = (edit.shippingValue(field) as string | null) ?? ''
    const isChanged = value !== ((view.shipping?.[field] as string | null) ?? '')
    const known = options.some(([code]) => code === value)
    return (
      <div className="cp-edit-field">
        <label>{label}</label>
        <select
          className={`cp-input cp-edit-input${changedCls(isChanged)}`}
          disabled={locked}
          value={value}
          onChange={(e) => edit.setShipping(field, e.target.value as never)}
        >
          {!value && <option value="">—</option>}
          {value && !known && <option value={value}>{value}</option>}
          {options.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </div>
    )
  }

  const chargeType = edit.shippingValue('deliveryChargeType')

  return (
    <div className="cp-edit">
      {lockReason && <div className="cp-callout">{lockReason}</div>}
      {message && (
        <div className={message.kind === 'ok' ? 'cp-edit-msg-ok' : 'cp-edit-msg-error'} role="status" style={{ whiteSpace: 'pre-wrap' }}>
          {message.text}
        </div>
      )}

      {/* ══ ① 배송·반품 — 승인 없이 즉시 ══ */}
      <section className="cp-panel-section">
        <div className="cp-edit-section-head">
          <h3>배송·반품</h3>
          <span className="cp-edit-tag cp-edit-tag-now">즉시 반영</span>
        </div>
        {view.shipping ? (
          <>
            {view.kind === 'hybrid' && <div className="cp-edit-hint">하이브리드 상품 — 일반(판매자배송) 옵션에만 적용됩니다.</div>}
            <div className="cp-edit-grid">
              {shipSelect('deliveryChargeType', '배송비 종류', DELIVERY_CHARGE_TYPES)}
              {chargeType !== 'FREE' && shipInput('deliveryCharge', '기본 배송비', '원')}
              {chargeType === 'CONDITIONAL_FREE' && shipInput('freeShipOverAmount', '무료배송 기준 금액', '원 이상')}
              {shipInput('deliveryChargeOnReturn', '초도반품배송비 (편도)', '원')}
              {shipInput('returnCharge', '반품배송비 (편도)', '원')}
              {shipSelect('deliveryMethod', '배송방법', DELIVERY_METHODS)}
              <div className="cp-edit-field">
                <label>택배사 코드</label>
                <input
                  className={`cp-input cp-edit-input${changedCls((edit.shippingValue('deliveryCompanyCode') ?? '') !== (view.shipping.deliveryCompanyCode ?? ''))}`}
                  list="cp-courier-codes"
                  disabled={locked}
                  value={(edit.shippingValue('deliveryCompanyCode') as string | null) ?? ''}
                  onChange={(e) => edit.setShipping('deliveryCompanyCode', e.target.value.trim().toUpperCase())}
                />
                <datalist id="cp-courier-codes">
                  {COMMON_COURIERS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </datalist>
              </div>
              {shipInput('outboundShippingTimeDay', '출고 소요일', '일')}
              {shipSelect('remoteAreaDeliverable', '도서산간 배송', [['Y', '가능'], ['N', '불가']])}
              {shipSelect('unionDeliveryType', '묶음배송', UNION_DELIVERY)}
            </div>
            {edit.shippingProblems.length > 0 && <div className="cp-inline-error">{edit.shippingProblems.join(' · ')}</div>}
            <div className="cp-edit-actions">
              <button
                type="button"
                className="cp-btn cp-btn-primary"
                disabled={locked || !edit.shippingChanged || edit.shippingProblems.length > 0}
                onClick={() => void edit.submitShipping()}
              >
                {saving === 'shipping' ? '적용 중…' : '배송·반품 즉시 적용'}
              </button>
            </div>
            <div className="cp-edit-hint">출고지 · 반품지 주소는 쿠팡 주소록 코드로 바꿔야 해서 여기서는 바꾸지 않습니다 (WING 에서 변경).</div>
          </>
        ) : (
          <div className="cp-edit-hint">로켓그로스 전용 상품은 배송·반품 정보가 없습니다 (쿠팡 물류가 배송).</div>
        )}
      </section>

      {/* ══ ② 상품 정보 — 재승인 ══ */}
      <section className="cp-panel-section">
        <div className="cp-edit-section-head">
          <h3>상품 정보</h3>
          <span className="cp-edit-tag cp-edit-tag-approval">쿠팡 승인 뒤 반영</span>
        </div>
        <div className="cp-edit-grid cp-edit-grid-wide">
          {(['displayProductName', 'sellerProductName', 'brand', 'manufacture'] as const).map((f) => (
            <div key={f} className="cp-edit-field">
              <label>{{ displayProductName: '노출상품명', sellerProductName: '등록상품명', brand: '브랜드', manufacture: '제조사' }[f]}</label>
              <input
                className={`cp-input cp-edit-input${changedCls(f in edit.edits.info)}`}
                disabled={locked}
                value={edit.infoValue(f)}
                onChange={(e) => edit.setInfo(f, e.target.value)}
              />
            </div>
          ))}
          {(['saleStartedAt', 'saleEndedAt'] as const).map((f) => (
            <div key={f} className="cp-edit-field">
              <label>{f === 'saleStartedAt' ? '판매 시작' : '판매 종료'}</label>
              <input
                type="datetime-local"
                className={`cp-input cp-edit-input${changedCls(f in edit.edits.info)}`}
                disabled={locked}
                value={toLocalInput(edit.infoValue(f))}
                onChange={(e) => edit.setInfo(f, fromLocalInput(e.target.value))}
              />
            </div>
          ))}
        </div>
        {view.kind === 'hybrid' && <div className="cp-edit-hint">노출상품명 · 등록상품명 · 브랜드는 상품에 하나뿐이라 일반 · 로켓 양쪽에 같이 적용됩니다.</div>}

        <div className="cp-edit-field">
          <label>검색태그 (쉼표로 구분 · 최대 {SEARCH_TAG_MAX_COUNT}개 · 태그당 {SEARCH_TAG_MAX_LENGTH}자 · 모든 옵션에 같이 들어감)</label>
          <input
            className={`cp-input cp-edit-input${changedCls(edit.edits.searchTags !== undefined)}`}
            disabled={locked}
            value={tagText}
            onChange={(e) => {
              setTagText(e.target.value)
              edit.setSearchTags(e.target.value.split(',').map((t) => t.trim()).filter(Boolean))
            }}
          />
        </div>
      </section>

      {/* ══ ③ 옵션 — 재승인 ══ */}
      <section className="cp-panel-section">
        <div className="cp-edit-section-head">
          <h3>옵션 {items.length}개</h3>
          <span className="cp-edit-tag cp-edit-tag-approval">쿠팡 승인 뒤 반영</span>
        </div>
        <div className="cp-edit-hint">
          판매가 · 재고 · 판매상태는 목록의 칸을 눌러 바로 바꿉니다.
          {view.kind !== 'mp' && ' 로켓 바코드는 입고가 생긴 뒤에는 쿠팡이 바꾸지 않습니다.'}
        </div>
        <div className="cp-edit-options">
          {items.map((it) => {
            const itEdits = edit.edits.items[it.key]
            return (
              <div key={it.key} className="cp-edit-option">
                <div className="cp-edit-option-head">
                  <input
                    className={`cp-input cp-edit-input cp-edit-option-name${changedCls(itEdits?.itemName !== undefined)}`}
                    aria-label="옵션명"
                    disabled={locked}
                    value={itEdits?.itemName ?? it.itemName}
                    onChange={(e) => edit.setItemField(it.key, 'itemName', e.target.value)}
                  />
                  <span className="cp-mono" style={{ color: '#6B7280' }}>등록옵션 {it.key}</span>
                </div>
                {it.channels.map((ch) => (
                  <div key={ch.key} className="cp-edit-channel">
                    <span className={`cp-badge cp-badge-sm ${ch.key === 'rg' ? 'cp-badge-rg' : 'cp-badge-mp'}`}>{ch.label}</span>
                    <span className="cp-mono cp-edit-vid">{ch.vendorItemId ?? '옵션 ID 없음'}</span>
                    {(['barcode', 'modelNo', 'externalVendorSku'] as (keyof ChannelValues)[]).map((f) => {
                      const v = itEdits?.channels?.[ch.key]?.[f]
                      return (
                        <input
                          key={f}
                          className={`cp-input cp-edit-input cp-edit-small${changedCls(v !== undefined)}`}
                          placeholder={{ barcode: '바코드', modelNo: '모델번호', externalVendorSku: '업체상품코드' }[f]}
                          aria-label={{ barcode: '바코드', modelNo: '모델번호', externalVendorSku: '업체상품코드' }[f]}
                          title={{ barcode: '바코드', modelNo: '모델번호', externalVendorSku: '업체상품코드' }[f]}
                          disabled={locked}
                          value={v ?? ch[f]}
                          onChange={(e) => edit.setChannelField(it.key, ch.key, f, e.target.value)}
                        />
                      )
                    })}
                  </div>
                ))}
                <div className="cp-edit-channel">
                  <span className="cp-edit-small-label">인당 최대구매</span>
                  <input
                    className={`cp-input cp-input-num cp-edit-input cp-edit-small${changedCls(itEdits?.maximumBuyForPerson !== undefined)}`}
                    inputMode="numeric"
                    aria-label="인당 최대구매수량"
                    disabled={locked}
                    value={String(itEdits?.maximumBuyForPerson ?? it.maximumBuyForPerson ?? '')}
                    onChange={(e) => { const n = toIntOrNull(e.target.value); if (n != null) edit.setItemField(it.key, 'maximumBuyForPerson', n) }}
                  />
                  <span className="cp-inline-unit">개 /</span>
                  <input
                    className={`cp-input cp-input-num cp-edit-input cp-edit-small${changedCls(itEdits?.maximumBuyForPersonPeriod !== undefined)}`}
                    inputMode="numeric"
                    aria-label="최대구매 기간(일)"
                    disabled={locked}
                    value={String(itEdits?.maximumBuyForPersonPeriod ?? it.maximumBuyForPersonPeriod ?? '')}
                    onChange={(e) => { const n = toIntOrNull(e.target.value); if (n != null) edit.setItemField(it.key, 'maximumBuyForPersonPeriod', n) }}
                  />
                  <span className="cp-inline-unit">일 (0 = 제한 없음)</span>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ══ 바꿀 수 없는 값 ══ */}
      <section className="cp-panel-section">
        <h3>바꿀 수 없는 값</h3>
        <dl className="cp-dl">
          <dt>카테고리 코드</dt><dd>{view.readonly.displayCategoryCode ?? '—'} <span className="cp-edit-hint">(등록 후 변경 불가)</span></dd>
          <dt>상품상태</dt><dd>{OFFER_CONDITION_LABELS[view.readonly.offerCondition ?? ''] ?? view.readonly.offerCondition ?? '—'} <span className="cp-edit-hint">(등록 후 변경 불가)</span></dd>
          <dt>옵션 삭제</dt><dd><span className="cp-edit-hint">승인된 적 있는 옵션은 삭제 불가 — 판매 중지로 대신</span></dd>
        </dl>
      </section>

      {/* ══ 재승인 수정 보내기 ══ */}
      <div className="cp-edit-submit">
        {edit.productProblems.length > 0 && <div className="cp-inline-error">{edit.productProblems.join(' · ')}</div>}
        <div className="cp-edit-submit-row">
          <span className="cp-edit-hint">{productChanged ? `바꾼 칸 ${edit.productChanges.length}개` : '상품 정보 · 옵션에서 바꾼 칸이 없습니다'}</span>
          <button type="button" className="cp-btn" disabled={!!saving || (!productChanged && !edit.shippingChanged)} onClick={edit.resetEdits}>변경 취소</button>
          <button
            type="button"
            className="cp-btn cp-btn-primary"
            disabled={locked || !productChanged || edit.productProblems.length > 0}
            onClick={() => void edit.submitProduct()}
          >
            {saving === 'product' ? '요청 중…' : '쿠팡에 수정 요청 (승인요청 포함)'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CoupangProductEditForm
