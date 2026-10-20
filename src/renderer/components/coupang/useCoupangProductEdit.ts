/* ================================================================
   상품관리 — 상세 패널 [수정] 탭 상태 훅
   - 열 때 쿠팡 최신 상세를 받아 폼 기준값으로 쓴다 (DB 값이 아니라)
   - 바꾼 칸만 edits 에 모은다 (원래 값으로 되돌리면 edits 에서 빠진다)
   - 배송·반품: [즉시 적용] (승인불필요) / 상품 정보·옵션: [쿠팡에 수정 요청] (재승인)
   ================================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  applyShippingEdits,
  editLockReason,
  fetchLiveProductDetail,
  hasProductEdits,
  submitProductEdits,
  toEditableView,
  validateProductEdits,
  validateShippingEdits,
} from '../../services/coupangProductEditService'
import type {
  ChannelKey,
  ChannelValues,
  EditableProductView,
  ItemEdits,
  ProductEdits,
  ProductInfoValues,
  ShippingEdits,
  ShippingValues,
} from '../../types/coupangProductEdit'

const EMPTY_EDITS: ProductEdits = { info: {}, items: {} }

const INFO_LABELS: Record<keyof ProductInfoValues, string> = {
  displayProductName: '노출상품명',
  sellerProductName: '등록상품명',
  brand: '브랜드',
  manufacture: '제조사',
  saleStartedAt: '판매 시작',
  saleEndedAt: '판매 종료',
}
const CHANNEL_FIELD_LABELS: Record<keyof ChannelValues, string> = {
  barcode: '바코드',
  modelNo: '모델번호',
  externalVendorSku: '업체상품코드',
}

/** 아이템 수정에서 빈 묶음을 정리 */
function pruneItem(it: ItemEdits): ItemEdits | null {
  const channels = Object.fromEntries(
    Object.entries(it.channels ?? {}).filter(([, v]) => v && Object.keys(v).length > 0),
  ) as ItemEdits['channels']
  const next: ItemEdits = { ...it, channels }
  if (!channels || Object.keys(channels).length === 0) delete next.channels
  return Object.keys(next).length > 0 ? next : null
}

export function useCoupangProductEdit(userId: string, sellerProductId: string, onChanged: () => void) {
  const [view, setView] = useState<EditableProductView | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [edits, setEdits] = useState<ProductEdits>(EMPTY_EDITS)
  const [shipping, setShippingEdits] = useState<ShippingEdits>({})
  const [saving, setSaving] = useState<'shipping' | 'product' | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  // ── 최신 상세 받기 ──
  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const raw = await fetchLiveProductDetail(sellerProductId)
      setView(toEditableView(raw))
      setEdits(EMPTY_EDITS)
      setShippingEdits({})
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '상세를 받지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [sellerProductId])

  useEffect(() => { void load() }, [load])

  const lockReason = editLockReason(view?.statusName ?? null)

  // ══════════════════════════════════════════════════════════════
  // 값 바꾸기 — 원래 값과 같아지면 edits 에서 뺀다
  // ══════════════════════════════════════════════════════════════

  const setInfo = useCallback((field: keyof ProductInfoValues, value: string) => {
    setEdits((prev) => {
      const info = { ...prev.info }
      if (view && value === view.info[field]) delete info[field]
      else info[field] = value
      return { ...prev, info }
    })
  }, [view])

  const setSearchTags = useCallback((tags: string[]) => {
    setEdits((prev) => {
      const same = view && tags.length === view.searchTags.length && tags.every((t, i) => t === view.searchTags[i])
      const next = { ...prev }
      if (same) delete next.searchTags
      else next.searchTags = tags
      return next
    })
  }, [view])

  const setItemField = useCallback((key: string, field: 'itemName' | 'maximumBuyForPerson' | 'maximumBuyForPersonPeriod', value: string | number) => {
    const original = view?.items.find((it) => it.key === key)
    setEdits((prev) => {
      const items = { ...prev.items }
      const it: ItemEdits = { ...(items[key] ?? {}) }
      if (original && original[field] === value) delete it[field]
      else (it as Record<string, unknown>)[field] = value
      const pruned = pruneItem(it)
      if (pruned) items[key] = pruned
      else delete items[key]
      return { ...prev, items }
    })
  }, [view])

  const setChannelField = useCallback((key: string, channel: ChannelKey, field: keyof ChannelValues, value: string) => {
    const original = view?.items.find((it) => it.key === key)?.channels.find((c) => c.key === channel)
    setEdits((prev) => {
      const items = { ...prev.items }
      const it: ItemEdits = { ...(items[key] ?? {}), channels: { ...(items[key]?.channels ?? {}) } }
      const ch = { ...(it.channels![channel] ?? {}) }
      if (original && original[field] === value) delete ch[field]
      else ch[field] = value
      it.channels![channel] = ch
      const pruned = pruneItem(it)
      if (pruned) items[key] = pruned
      else delete items[key]
      return { ...prev, items }
    })
  }, [view])

  const setShipping = useCallback(<K extends keyof ShippingValues>(field: K, value: ShippingValues[K]) => {
    setShippingEdits((prev) => {
      const next = { ...prev }
      if (view?.shipping && view.shipping[field] === value) delete next[field]
      else next[field] = value
      return next
    })
  }, [view])

  /** 폼에 보일 값 (바꾼 값 우선) */
  const infoValue = (field: keyof ProductInfoValues) => edits.info[field] ?? view?.info[field] ?? ''
  const searchTagsValue = edits.searchTags ?? view?.searchTags ?? []
  const shippingValue = <K extends keyof ShippingValues>(field: K): ShippingValues[K] | null =>
    (field in shipping ? shipping[field] : view?.shipping?.[field]) ?? null

  // ══════════════════════════════════════════════════════════════
  // 바뀐 칸 목록 (확인 창 · 버튼 표시용)
  // ══════════════════════════════════════════════════════════════

  const productChanges = useMemo<string[]>(() => {
    if (!view) return []
    const out: string[] = []
    for (const [k, v] of Object.entries(edits.info) as [keyof ProductInfoValues, string][]) {
      out.push(`${INFO_LABELS[k]}: ${view.info[k] || '(없음)'} → ${v || '(없음)'}`)
    }
    if (edits.searchTags) out.push(`검색태그: ${edits.searchTags.join(', ') || '(없음)'}`)
    for (const [key, it] of Object.entries(edits.items)) {
      const orig = view.items.find((x) => x.key === key)
      const name = orig?.itemName || key
      if (it.itemName !== undefined) out.push(`옵션명: ${name} → ${it.itemName}`)
      if (it.maximumBuyForPerson !== undefined) out.push(`[${name}] 인당 최대구매수량 → ${it.maximumBuyForPerson}`)
      if (it.maximumBuyForPersonPeriod !== undefined) out.push(`[${name}] 최대구매 기간(일) → ${it.maximumBuyForPersonPeriod}`)
      for (const [ch, values] of Object.entries(it.channels ?? {}) as [ChannelKey, Partial<ChannelValues>][]) {
        const chLabel = orig?.channels.find((c) => c.key === ch)?.label ?? ch
        for (const [f, v] of Object.entries(values) as [keyof ChannelValues, string][]) {
          out.push(`[${name} · ${chLabel}] ${CHANNEL_FIELD_LABELS[f]} → ${v}`)
        }
      }
    }
    return out
  }, [edits, view])

  const productProblems = useMemo(() => validateProductEdits(edits), [edits])
  const shippingProblems = useMemo(() => validateShippingEdits(shipping), [shipping])

  // ══════════════════════════════════════════════════════════════
  // 저장
  // ══════════════════════════════════════════════════════════════

  const submitShipping = useCallback(async () => {
    if (!view || saving || Object.keys(shipping).length === 0) return
    if (!confirm('배송·반품 정보를 쿠팡에 바로 반영합니다 (승인 없이 즉시). 진행할까요?')) return
    setSaving('shipping')
    setMessage(null)
    try {
      await applyShippingEdits(userId, view.sellerProductId, shipping)
      setMessage({ kind: 'ok', text: '배송·반품 정보를 쿠팡에 반영했습니다.' })
      onChanged()
      await load()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : '배송·반품 수정 실패' })
    } finally {
      setSaving(null)
    }
  }, [view, saving, shipping, userId, onChanged, load])

  const submitProduct = useCallback(async () => {
    if (!view || saving || !hasProductEdits(edits)) return
    const ok = confirm(
      `쿠팡에 상품 수정을 요청합니다 (승인요청 포함).\n\n${productChanges.join('\n')}\n\n`
      + '· 쿠팡 승인 뒤에 반영됩니다.\n· 승인대기 중에는 배송·반품을 포함해 이 상품을 수정할 수 없습니다.\n진행할까요?',
    )
    if (!ok) return
    setSaving('product')
    setMessage(null)
    try {
      const r = await submitProductEdits(userId, view.sellerProductId, edits)
      const head = r.statusName === '승인완료'
        ? '쿠팡이 바로 승인해 반영됐습니다.'
        : `쿠팡에 수정 요청을 보냈습니다 (지금 상태: ${r.statusName ?? '확인 못 함'}). 승인 뒤에 반영됩니다.`
      setMessage({
        kind: 'ok',
        text: head + (r.resynced ? '' : ' (이 앱의 값은 다음 [상세 받기] 때 맞춰집니다)'),
      })
      onChanged()
      await load()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : '상품 수정 요청 실패' })
    } finally {
      setSaving(null)
    }
  }, [view, saving, edits, productChanges, userId, onChanged, load])

  const resetEdits = useCallback(() => { setEdits(EMPTY_EDITS); setShippingEdits({}); setMessage(null) }, [])

  return {
    view, loading, loadError, reload: load, lockReason,
    edits, infoValue, searchTagsValue, shippingValue,
    setInfo, setSearchTags, setItemField, setChannelField, setShipping,
    productChanges, productProblems, shippingChanged: Object.keys(shipping).length > 0, shippingProblems,
    saving, message, submitShipping, submitProduct, resetEdits,
  }
}

export type CoupangProductEditState = ReturnType<typeof useCoupangProductEdit>
