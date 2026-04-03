import React, { useState, useEffect } from 'react'
import { theme } from '../../styles/theme'
import { fetchRgProductDetail } from '../../services/purchaseService'
import type { RgItem, CoupangProductDetail } from '../../types/purchase'

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
    width: '25vw',
    minWidth: '360px',
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
    width: '100%',
    aspectRatio: '1',
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

  /* ── 에러 ────────────────────────────────────────────────────── */
  errorMsg: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.warning,
    textAlign: 'center' as const,
    marginBottom: '16px',
  },
}

// ── 스피너 키프레임 (인라인 삽입) ────────────────────────────────────
const SPINNER_KEYFRAMES = `
@keyframes spin {
  0%   { transform: rotate(0deg);   }
  100% { transform: rotate(360deg); }
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
  const itemName = detailItem?.itemName ?? item.item_name
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
      <style>{SPINNER_KEYFRAMES}</style>

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

              {/* ── ID 배지 3개 ─────────────────────────────────── */}
              <div style={styles.badgeGroup}>
                <div style={styles.badge}>
                  <span style={styles.badgeLabel}>노출상품 ID</span>
                  <span style={styles.badgeValue}>{sellerProductId || '-'}</span>
                </div>
                <div style={styles.badge}>
                  <span style={styles.badgeLabel}>등록상품 ID</span>
                  <span style={styles.badgeValue}>{sellerProductItemId || '-'}</span>
                </div>
                <div style={styles.badge}>
                  <span style={styles.badgeLabel}>옵션 ID</span>
                  <span style={styles.badgeValue}>{vendorItemId || '-'}</span>
                </div>
              </div>

              {/* ── 바코드 ─────────────────────────────────────── */}
              <div style={styles.infoRow}>
                <span style={styles.infoIcon}>📦</span>
                <span style={styles.infoLabel}>바코드</span>
                <span style={styles.infoValue}>{barcode || '-'}</span>
              </div>

              {/* ── 가격 ───────────────────────────────────────── */}
              <div style={styles.infoRow}>
                <span style={styles.infoIcon}>💰</span>
                <span style={styles.infoLabel}>가격</span>
                <span style={styles.infoValue}>
                  {salePrice != null ? `${salePrice.toLocaleString()}원` : '-'}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

export default ProductDetailPanel
