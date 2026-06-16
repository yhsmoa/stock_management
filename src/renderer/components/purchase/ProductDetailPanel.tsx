import React, { useState, useEffect, useCallback } from 'react'
import { theme } from '../../styles/theme'
import {
  fetchRgProductDetail,
  fetchVendorItemInventory,
  updateVendorItemPrice,
  setVendorItemSale,
} from '../../services/purchaseService'
import type { RgItem, CoupangProductDetail } from '../../types/purchase'

// ── 가격 비율 제한 (쿠팡: 기존가 대비 최대 50% 인하 ~ 100% 인상) ──
const PRICE_MIN_RATIO = 0.5   // 하한 = 기존가 × 0.5
const PRICE_MAX_RATIO = 2     // 상한 = 기존가 × 2 (100% 인상)

/* ================================================================
   ProductDetailPanel — 상품 상세 슬라이드 패널
   - 상품정보 셀 클릭 시 오른쪽에서 슬라이드 인
   - sellerProductId로 쿠팡 상세 API 1건 호출
   - 이미지·상품명·ID 배지·바코드·가격 표시
   - API 실패 시 DB 데이터(item)로 폴백
   ================================================================ */

interface ProductDetailPanelProps {
  isOpen: boolean
  onClose: () => void
  item: RgItem | null
  itemWinner?: string | null   // '아이템위너 아님' 등 아이템위너 상태
}

// ── 스타일 ──────────────────────────────────────────────────────────
const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.overlay,
    zIndex: 999,
  },
  panel: {
    position: 'fixed' as const,
    top: 0,
    right: 0,
    width: '30vw',
    minWidth: '420px',
    height: '100%',
    backgroundColor: theme.colors.bgCard,
    boxShadow: '-4px 0 20px rgba(0,0,0,0.08)',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column' as const,
    transition: 'transform 0.3s ease',
  },
  header: {
    padding: '16px 20px',
    borderBottom: `1px solid ${theme.colors.border}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    color: theme.colors.textSecondary,
    padding: '4px 8px',
  },
  body: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '24px 20px',
  },

  /* ── 이미지 ──────────────────────────────────────────────────── */
  imageWrapper: {
    width: '300px',
    height: '300px',
    alignSelf: 'center',
    margin: '0 auto',
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    border: `1px solid ${theme.colors.borderLight}`,
    backgroundColor: '#F9FAFB',
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
  },
  noImage: {
    color: theme.colors.textMuted,
    fontSize: theme.fontSize.sm,
  },

  /* ── 상품명 ──────────────────────────────────────────────────── */
  productName: {
    fontSize: theme.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginBottom: '4px',
    lineHeight: '1.4',
  },
  itemName: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginBottom: '20px',
  },

  /* ── ID 배지 그룹 ────────────────────────────────────────────── */
  badgeGroup: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap' as const,
    marginBottom: '20px',
  },
  badge: {
    display: 'inline-flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '8px 12px',
    backgroundColor: theme.colors.primaryLight,
    borderRadius: theme.radius.md,
    minWidth: '90px',
  },
  badgeLabel: {
    fontSize: '11px',
    color: theme.colors.textSecondary,
    marginBottom: '4px',
    fontWeight: '500',
  },
  badgeValue: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textPrimary,
    fontWeight: '600',
    wordBreak: 'break-all' as const,
  },

  /* ── 정보 행 ─────────────────────────────────────────────────── */
  infoRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 0',
    borderBottom: `1px solid ${theme.colors.borderLight}`,
  },
  infoIcon: {
    fontSize: '18px',
    marginRight: '10px',
    width: '24px',
    textAlign: 'center' as const,
  },
  infoLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginRight: '8px',
    whiteSpace: 'nowrap' as const,
  },
  infoValue: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textPrimary,
    fontWeight: '500',
  },

  /* ── 로딩 ────────────────────────────────────────────────────── */
  loading: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 0',
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.sm,
    gap: '12px',
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: `3px solid ${theme.colors.borderLight}`,
    borderTop: `3px solid ${theme.colors.primary}`,
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },

  /* ── 클릭 복사 가능 요소 ─────────────────────────────────────── */
  copyable: {
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },

  /* ── 복사 툴팁 ─────────────────────────────────────────────── */
  copyTooltip: {
    position: 'fixed' as const,
    padding: '4px 10px',
    backgroundColor: '#1F2937',
    color: '#fff',
    fontSize: '12px',
    fontWeight: '500',
    borderRadius: '6px',
    pointerEvents: 'none' as const,
    zIndex: 9999,
    whiteSpace: 'nowrap' as const,
    animation: 'fadeOut 1s ease forwards',
  },

  /* ── 에러 ────────────────────────────────────────────────────── */
  errorMsg: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.warning,
    textAlign: 'center' as const,
    marginBottom: '16px',
  },

  /* ── 가격 수정 입력폼 ────────────────────────────────────────── */
  priceInputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '8px',
  },
  priceInput: {
    flex: 1,
    minWidth: 0,
    padding: '8px 10px',
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radius.md,
    fontSize: theme.fontSize.base,
    textAlign: 'right' as const,
    outline: 'none',
  },
  priceSaveBtn: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: theme.radius.md,
    background: theme.colors.primary,
    color: '#fff',
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  priceHint: {
    fontSize: '11px',
    color: theme.colors.textMuted,
    marginTop: '4px',
  },
  priceError: {
    fontSize: '12px',
    color: '#EF4444',
    fontWeight: 500,
    marginTop: '4px',
  },

  /* ── 판매상태 버튼 그룹 ──────────────────────────────────────── */
  saleRow: {
    display: 'flex',
    gap: '8px',
    padding: '16px 0 4px',
  },
  saleBtn: {
    flex: 1,
    padding: '10px 0',
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radius.md,
    background: '#fff',
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  saleBtnOnActive: {
    background: '#4A8CF7',
    borderColor: '#4A8CF7',
    color: '#fff',
  },
  saleBtnStopActive: {
    background: '#EF4444',
    borderColor: '#EF4444',
    color: '#fff',
  },
}

// ── 스피너 키프레임 (인라인 삽입) ────────────────────────────────────
const PANEL_KEYFRAMES = `
@keyframes spin {
  0%   { transform: rotate(0deg);   }
  100% { transform: rotate(360deg); }
}
@keyframes fadeOut {
  0%   { opacity: 1; }
  70%  { opacity: 1; }
  100% { opacity: 0; }
}
`

const ProductDetailPanel: React.FC<ProductDetailPanelProps> = ({
  isOpen,
  onClose,
  item,
  itemWinner,
}) => {
  /* ── 상태 ─────────────────────────────────────────────────────── */
  const [detailLoading, setDetailLoading] = useState(false)
  const [detail, setDetail] = useState<CoupangProductDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)
  const [copyTooltip, setCopyTooltip] = useState<{ x: number; y: number; key: number } | null>(null)

  /* ── 가격/판매상태 (inventories 조회 + 변경) ─────────────────── */
  const [baselinePrice, setBaselinePrice] = useState<number | null>(null)  // 비율 기준 = 현재 판매가
  const [priceInput, setPriceInput] = useState('')
  const [priceError, setPriceError] = useState<string | null>(null)
  const [savingPrice, setSavingPrice] = useState(false)
  const [onSale, setOnSale] = useState<boolean | null>(null)                // null = 조회 중/실패
  const [savingSale, setSavingSale] = useState(false)

  /* ── 클릭 복사 핸들러 (마우스 위치에 "copy" 툴팁 표시) ──────── */
  const handleCopy = useCallback((value: string | null | undefined, e: React.MouseEvent) => {
    if (!value) return
    navigator.clipboard.writeText(value)
    setCopyTooltip({ x: e.clientX + 12, y: e.clientY - 8, key: Date.now() })
    setTimeout(() => setCopyTooltip(null), 1000)
  }, [])

  /* ── 가격 변경 (10원 단위 + 비율 제한 사전 검증) ─────────────
     위반 시: 빨간 안내 + 원래 금액 복원 → 재수정 가능 */
  const handleSavePrice = useCallback(async () => {
    const vid = item?.vendor_item_id
    if (!vid) return

    const revert = () => setPriceInput(baselinePrice != null ? String(baselinePrice) : '')
    const newPrice = Number(priceInput)

    if (!Number.isFinite(newPrice) || newPrice <= 0) {
      setPriceError('유효한 금액을 입력하세요.')
      revert()
      return
    }
    if (newPrice % 10 !== 0) {
      setPriceError('가격은 10원 단위로 입력 가능합니다.')
      revert()
      return
    }
    if (baselinePrice != null && baselinePrice > 0) {
      const min = baselinePrice * PRICE_MIN_RATIO
      const max = baselinePrice * PRICE_MAX_RATIO
      if (newPrice < min || newPrice > max) {
        setPriceError('가격 비율 제한(기존가 대비 50%↓ ~ 100%↑)을 벗어날 수 없습니다.')
        revert()
        return
      }
    }
    if (newPrice === baselinePrice) {
      setPriceError(null)
      return
    }

    setSavingPrice(true)
    setPriceError(null)
    try {
      await updateVendorItemPrice(vid, newPrice, false)
      setBaselinePrice(newPrice)
      setPriceInput(String(newPrice))
    } catch (err: any) {
      setPriceError(err?.message || '가격 변경에 실패했습니다.')
      revert()
    } finally {
      setSavingPrice(false)
    }
  }, [item?.vendor_item_id, priceInput, baselinePrice])

  /* ── 판매 재개/중지 ─────────────────────────────────────────── */
  const handleSetSale = useCallback(async (action: 'resume' | 'stop') => {
    const vid = item?.vendor_item_id
    if (!vid) return
    setSavingSale(true)
    try {
      await setVendorItemSale(vid, action)
      setOnSale(action === 'resume')
    } catch (err: any) {
      alert((action === 'resume' ? '판매 재개 실패: ' : '판매 중지 실패: ') + (err?.message || ''))
    } finally {
      setSavingSale(false)
    }
  }, [item?.vendor_item_id])

  /* ── 패널 열릴 때 상세 API 호출 ──────────────────────────────── */
  useEffect(() => {
    if (!isOpen || !item) {
      setDetail(null)
      setError(null)
      setImgError(false)
      return
    }
    setImgError(false)

    const loadDetail = async () => {
      setDetailLoading(true)
      setError(null)
      try {
        const data = await fetchRgProductDetail(Number(item.seller_product_id))
        setDetail(data)
      } catch (err: any) {
        console.error('[ProductDetailPanel] 상세 조회 실패:', err)
        setError('상세 정보를 불러올 수 없어 저장된 데이터를 표시합니다.')
      } finally {
        setDetailLoading(false)
      }
    }

    loadDetail()
  }, [isOpen, item?.seller_product_id])

  /* ── 패널 열릴 때 inventories 조회 (현재 가격·판매상태) ──────────
     - 비율 기준가(baselinePrice) 와 판매상태(onSale) 의 정본 소스.
     - vendor_item_id 없으면 조회 불가 → 입력/버튼 비활성. */
  useEffect(() => {
    const vid = item?.vendor_item_id
    if (!isOpen || !vid) {
      setBaselinePrice(null)
      setPriceInput('')
      setPriceError(null)
      setOnSale(null)
      return
    }

    let cancelled = false
    const loadInventory = async () => {
      try {
        const inv = await fetchVendorItemInventory(vid)
        if (cancelled) return
        const base = inv.salePrice ?? item?.sale_price ?? null
        setBaselinePrice(base)
        setPriceInput(base != null ? String(base) : '')
        setOnSale(inv.onSale)
      } catch (err: any) {
        if (cancelled) return
        console.error('[ProductDetailPanel] inventories 조회 실패:', err)
        // 폴백: DB 판매가로 입력폼만 채우고 판매상태는 미상(null)
        const base = item?.sale_price ?? null
        setBaselinePrice(base)
        setPriceInput(base != null ? String(base) : '')
        setOnSale(null)
      }
      if (!cancelled) setPriceError(null)
    }

    loadInventory()
    return () => { cancelled = true }
  }, [isOpen, item?.vendor_item_id])

  // ── 패널이 닫혀 있으면 렌더링하지 않음 ────────────────────────────
  if (!isOpen || !item) return null

  // ══════════════════════════════════════════════════════════════════
  // 표시 데이터 결정 (상세 API 우선, 실패 시 DB 폴백)
  // ══════════════════════════════════════════════════════════════════

  // 상세 API에서 해당 아이템 매칭 (seller_product_item_id 기준)
  // - 로켓그로스 상품은 ID가 직접 또는 rocketGrowthItemData에 위치
  const getItemId = (di: NonNullable<typeof detail>['items'][0]) =>
    di.sellerProductItemId ?? di.rocketGrowthItemData?.sellerProductItemId

  const detailItem = detail?.items?.find(
    (di) => item.seller_product_item_id != null
      && String(getItemId(di)) === item.seller_product_item_id,
  ) ?? detail?.items?.[0]

  // 이미지 URL: 상세 API cdnPath → DB 폴백
  const repImage = detailItem?.images?.find(
    (img) => img.imageType === 'REPRESENTATION' || img.imageOrder === 0,
  )
  const imageUrl = repImage?.cdnPath
    ? `https://thumbnail6.coupangcdn.com/thumbnails/remote/230x230ex/image/${repImage.cdnPath}`
    : item.img_url

  // 각 필드: 직접 → rocketGrowthItemData → DB 폴백
  const productName = detail?.sellerProductName ?? item.seller_product_name
  const itemName = detailItem?.itemName ?? item.option_name
  const rgData = detailItem?.rocketGrowthItemData
  const barcode = detailItem?.barcode ?? rgData?.barcode ?? item.barcode
  const salePrice = detailItem?.salePrice ?? rgData?.priceData?.salePrice ?? item.sale_price
  const sellerProductId = detail
    ? String(detail.sellerProductId)
    : item.seller_product_id

  // ID 추출: 직접 → rocketGrowthItemData → DB 폴백
  const rawSpItemId = detailItem
    ? (detailItem.sellerProductItemId ?? detailItem.rocketGrowthItemData?.sellerProductItemId)
    : null
  const sellerProductItemId = rawSpItemId != null
    ? String(rawSpItemId)
    : item.seller_product_item_id

  const rawVendorItemId = detailItem
    ? (detailItem.vendorItemId ?? detailItem.rocketGrowthItemData?.vendorItemId)
    : null
  const vendorItemId = rawVendorItemId != null
    ? String(rawVendorItemId)
    : item.vendor_item_id

  // ══════════════════════════════════════════════════════════════════
  // 렌더링
  // ══════════════════════════════════════════════════════════════════
  return (
    <>
      {/* ── 스피너 키프레임 ──────────────────────────────────────── */}
      <style>{PANEL_KEYFRAMES}</style>

      {/* ── 오버레이 ─────────────────────────────────────────────── */}
      <div style={styles.overlay} onClick={onClose} />

      {/* ── 패널 본체 ────────────────────────────────────────────── */}
      <div style={styles.panel}>
        {/* ── 헤더 ─────────────────────────────────────────────── */}
        <div style={styles.header}>
          <span style={styles.headerTitle}>상품 상세</span>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* ── 바디 ─────────────────────────────────────────────── */}
        <div style={styles.body}>
          {detailLoading ? (
            /* ── 로딩 상태 ─────────────────────────────────────── */
            <div style={styles.loading}>
              <div style={styles.spinner} />
              <span>상세 정보를 불러오는 중...</span>
            </div>
          ) : (
            <>
              {/* ── API 실패 안내 ───────────────────────────────── */}
              {error && <div style={styles.errorMsg}>{error}</div>}

              {/* ── 상품 이미지 ─────────────────────────────────── */}
              <div style={styles.imageWrapper}>
                {imageUrl && !imgError ? (
                  <img
                    src={imageUrl}
                    alt={productName || '상품 이미지'}
                    style={styles.image}
                    onError={() => setImgError(true)}
                  />
                ) : (
                  <span style={styles.noImage}>이미지 없음</span>
                )}
              </div>

              {/* ── 상품명 + 옵션명 + 아이템위너 상태 ────────────── */}
              <div style={styles.productName}>
                {productName || '-'}
              </div>
              <div style={styles.itemName}>
                {itemName ? `옵션: ${itemName}` : ''}
                {itemWinner === '아이템위너 아님' && (
                  <span style={{ color: '#EF4444', fontWeight: '600', marginLeft: '8px' }}>
                    아이템위너 아님
                  </span>
                )}
              </div>

              {/* ── ID 배지 3개 (클릭 → 클립보드 복사) ──────────── */}
              <div style={styles.badgeGroup}>
                {[
                  { label: '노출상품 ID', value: sellerProductId },
                  { label: '등록상품 ID', value: sellerProductItemId },
                  { label: '옵션 ID', value: vendorItemId },
                ].map((b) => (
                  <div
                    key={b.label}
                    style={{ ...styles.badge, ...styles.copyable }}
                    onClick={(e) => handleCopy(b.value, e)}
                    title="클릭하여 복사"
                  >
                    <span style={styles.badgeLabel}>{b.label}</span>
                    <span style={styles.badgeValue}>{b.value || '-'}</span>
                  </div>
                ))}
              </div>

              {/* ── 바코드 (클릭 → 클립보드 복사) ────────────────── */}
              <div
                style={{ ...styles.infoRow, ...styles.copyable }}
                onClick={(e) => handleCopy(barcode, e)}
                title="클릭하여 복사"
              >
                <span style={styles.infoIcon}>𝄃𝄂𝄀𝄁𝄃</span>
                <span style={styles.infoLabel}>바코드</span>
                <span style={styles.infoValue}>{barcode || '-'}</span>
              </div>

              {/* ── 가격 수정 (입력폼 → 쿠팡 가격 변경 API) ───────── */}
              <div style={{ padding: '12px 0', borderBottom: `1px solid ${theme.colors.borderLight}` }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={styles.infoIcon}>🏷️</span>
                  <span style={styles.infoLabel}>가격</span>
                </div>
                {vendorItemId ? (
                  <>
                    <div style={styles.priceInputRow}>
                      <input
                        style={styles.priceInput}
                        type="text"
                        inputMode="numeric"
                        value={priceInput}
                        disabled={savingPrice}
                        onChange={(e) => {
                          setPriceInput(e.target.value.replace(/[^\d]/g, ''))
                          if (priceError) setPriceError(null)
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSavePrice() }}
                      />
                      <span style={{ color: theme.colors.textSecondary }}>원</span>
                      <button
                        style={styles.priceSaveBtn}
                        onClick={handleSavePrice}
                        disabled={savingPrice}
                      >
                        {savingPrice ? '변경 중...' : '가격 변경'}
                      </button>
                    </div>
                    {priceError ? (
                      <div style={styles.priceError}>{priceError}</div>
                    ) : (
                      baselinePrice != null && (
                        <div style={styles.priceHint}>
                          현재 {baselinePrice.toLocaleString()}원 · 변경 가능 범위{' '}
                          {Math.ceil(baselinePrice * PRICE_MIN_RATIO).toLocaleString()} ~{' '}
                          {(baselinePrice * PRICE_MAX_RATIO).toLocaleString()}원 (10원 단위)
                        </div>
                      )
                    )}
                  </>
                ) : (
                  <div style={{ ...styles.infoValue, paddingLeft: '34px' }}>
                    {salePrice != null ? `${salePrice.toLocaleString()}원` : '-'}
                    <span style={styles.priceHint}> (옵션ID 없음 — 변경 불가)</span>
                  </div>
                )}
              </div>

              {/* ── 판매상태 (판매중 / 판매중지) ────────────────── */}
              {vendorItemId && (
                <div>
                  <div style={styles.saleRow}>
                    <button
                      style={{ ...styles.saleBtn, ...(onSale === true ? styles.saleBtnOnActive : {}) }}
                      onClick={() => handleSetSale('resume')}
                      disabled={savingSale || onSale === true}
                    >
                      판매중
                    </button>
                    <button
                      style={{ ...styles.saleBtn, ...(onSale === false ? styles.saleBtnStopActive : {}) }}
                      onClick={() => handleSetSale('stop')}
                      disabled={savingSale || onSale === false}
                    >
                      판매중지
                    </button>
                  </div>
                  {onSale === null && (
                    <div style={styles.priceHint}>판매상태를 불러오는 중이거나 조회에 실패했습니다.</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── 복사 툴팁 (마우스 위치에 1초 표시) ──────────────── */}
      {copyTooltip && (
        <div
          key={copyTooltip.key}
          style={{
            ...styles.copyTooltip,
            left: copyTooltip.x,
            top: copyTooltip.y,
          }}
        >
          copy
        </div>
      )}
    </>
  )
}

export default ProductDetailPanel
