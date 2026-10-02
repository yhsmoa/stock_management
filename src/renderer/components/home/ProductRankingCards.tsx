/* ================================================================
   홈 화면 — 상품 랭킹 카드 (표시 전용)
   - 상품 하나가 카드 한 장: 머리줄(순위 · 쿠팡 별점 · 기준 값) · 이미지 · 상품명 · 나머지 수량
   - 순위 기준 값은 머리줄에 크게 따로 보여 주고, 아래 수량 칸에서도 색을 넣어
     어느 값으로 줄을 세웠는지 보이게 한다.
   - 한 줄에 다섯 장, 두 줄이 한 화면에 꼭 맞는 높이. 이미지는 남는 높이만큼만(원본 230px 이내) 그린다.
   - 카드를 누르면 로켓그로스 사입이 그 상품명을 검색한 상태로 열린다.
   - 맨 아래 '합계'는 🛒 · 주문 · C.in · 창고 넷을 더한 값이다.
   - 값이 0 이면 '-' 로 흐리게, 음수(반품이 더 많은 경우)는 그대로 빨갛게 보여 준다.
   ================================================================ */

import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { theme } from '../../styles/theme'
import type { PurchaseManagementLocationState } from '../../types/purchase'
import {
  RANKING_BASES,
  type ProductRankingRow,
  type ProductRating,
  type RankingBasis,
} from '../../services/productRankingService'

// ── 수량 칸 정의 (윗줄 판매량 넷 · 아랫줄 수량 넷) ───────────────
//   basis 가 있는 넷이 순위 기준이 될 수 있는 판매량이다.
interface StatDef {
  key: keyof Pick<ProductRankingRow, 'personal' | 'period' | 'd7' | 'd30' | 'cart' | 'order' | 'cIn' | 'warehouse'>
  label: string
  title: string
  basis?: RankingBasis
}

const STATS: StatDef[] = [
  { key: 'personal',  label: '개인', title: '개인주문 결제완료·상품준비중 출고 예정 수량', basis: 'personal' },
  { key: 'period',    label: '기간', title: '기간판매량 (판매자배송 + 로켓그로스)',        basis: 'period' },
  { key: 'd7',        label: '7일',  title: '최근 7일 판매량',                             basis: 'd7' },
  { key: 'd30',       label: '30일', title: '최근 30일 판매량',                            basis: 'd30' },
  { key: 'cart',      label: '🛒',   title: '카트 수량' },
  { key: 'order',     label: '주문', title: '주문 수량' },
  { key: 'cIn',       label: 'C.in', title: '쿠팡 입고 예정 수량' },
  { key: 'warehouse', label: '창고', title: '창고 재고' },
]

/** 합계에 넣는 칸 — 확보했거나 확보 중인 수량 (아랫줄 넷) */
const SUPPLY_KEYS = ['cart', 'order', 'cIn', 'warehouse'] as const
const SUPPLY_TOTAL_TITLE = '카트 + 주문 + 쿠팡 입고 예정 + 창고 재고'

const STAT_COLUMNS = 4           // 수량 칸 한 줄에 넷 — 판매량 줄 / 수량 줄로 나뉜다
const CARDS_PER_ROW = 5           // 한 줄에 카드 다섯 장 (10위까지 두 줄)
const CARD_MIN_WIDTH = '180px'    // 화면이 좁아도 카드는 이보다 줄지 않는다 — 대신 가로로 스크롤
const CARD_GAP_PX = 14
const ROWS_PER_SCREEN = 2         // 두 줄이 한 화면에 꼭 맞게 — 줄 높이를 화면 높이에서 계산한다
const CARD_MIN_HEIGHT_PX = 330    // 창이 낮아도 줄 높이는 이보다 줄지 않는다 (이미지가 사라지지 않게) — 대신 세로로 스크롤
const IMAGE_SOURCE_PX = 230       // 쿠팡 썸네일 원본 한 변 (img_url 이 230x230) — 이보다 크게 그리면 흐려진다
const TOP_RANK = 3                // 1~3위만 배지에 색을 준다

// ── 카드 클릭 → 로켓그로스 사입 검색 ────────────────────────────
const PURCHASE_PATH = '/purchase-management'

/** 사입관리 검색창은 콤마·탭·줄바꿈을 '여러 검색어'로 나눈다 */
const SEARCH_SEPARATOR = /[\n\r,\t]/

/**
 * 카드를 눌렀을 때 사입관리에 넘길 검색어 — 상품명 그대로.
 * 상품명이 없거나, 이름에 구분 문자가 있어 여러 검색어로 쪼개질 상품은
 * 상품 ID(정확히 그 상품만 걸린다)로 대신한다.
 */
const purchaseSearchTerm = (row: ProductRankingRow): string => {
  const name = row.name.trim()
  return name && !SEARCH_SEPARATOR.test(name) ? name : (row.productId || name)
}

/** 값 색 — 양수는 기본(기준이면 강조), 0 은 흐리게, 음수는 빨갛게 */
const valueColor = (value: number, isBasis: boolean): string =>
  value > 0
    ? (isBasis ? theme.colors.primary : theme.colors.textPrimary)
    : value < 0 ? theme.colors.danger : theme.colors.textMuted

const formatValue = (value: number): string => (value !== 0 ? value.toLocaleString() : '-')

// ── 상품 이미지 ─────────────────────────────────────────────────
//   url: undefined = 아직 찾는 중 · null = 이미지 없음 · 문자열 = 주소
//   주소가 있어도 불러오기에 실패하면(삭제된 이미지 등) '이미지 없음'으로 바꾼다.
const ProductImage: React.FC<{ url: string | null | undefined; alt: string }> = ({ url, alt }) => {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const showImage = !!url && failedUrl !== url

  return (
    // 카드에서 글자·수량 칸이 쓰고 남은 높이를 이미지가 차지한다 (원본 크기까지만 — 그 이상 키우면 흐려진다)
    <div
      style={{
        position: 'relative',
        flex: '1 1 0',
        minHeight: 0,
        maxHeight: `${IMAGE_SOURCE_PX}px`,
        margin: '0 14px',
        borderRadius: theme.radius.md,
        overflow: 'hidden',
        backgroundColor: theme.colors.bgCard,   // 이미지 양옆 남는 자리는 카드와 같은 흰색
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {showImage ? (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          onError={() => setFailedUrl(url)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : (
        <span style={{ fontSize: theme.fontSize.sm, color: theme.colors.textMuted }}>
          {url === undefined ? '이미지 불러오는 중…' : '이미지 없음'}
        </span>
      )}
    </div>
  )
}

// ── 순위 배지 (이미지 위쪽 머리줄에 둔다 — 이미지를 가리지 않게) ──
const RankBadge: React.FC<{ rank: number }> = ({ rank }) => {
  const top = rank <= TOP_RANK
  return (
    <span
      style={{
        minWidth: '28px',
        height: '28px',
        padding: '0 6px',
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radius.md,
        fontSize: theme.fontSize.md,
        fontWeight: 700,
        backgroundColor: top ? theme.colors.primary : theme.colors.borderLight,
        color: top ? theme.colors.textWhite : theme.colors.textSecondary,
      }}
    >
      {rank}
    </span>
  )
}

// ── 쿠팡 별점 (순위 바로 옆 — ⭐ 4.5 (338)) ──────────────────────
const RatingStar: React.FC<{ rating: ProductRating }> = ({ rating }) => (
  <span
    title={`쿠팡 별점 ${rating.rating.toFixed(1)}${rating.reviewCount > 0 ? ` · 리뷰 ${rating.reviewCount.toLocaleString()}개` : ''}`}
    style={{ display: 'inline-flex', alignItems: 'baseline', gap: '3px', fontSize: theme.fontSize.xs, whiteSpace: 'nowrap' }}
  >
    ⭐
    <b style={{ fontSize: theme.fontSize.sm, color: theme.colors.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
      {rating.rating.toFixed(1)}
    </b>
    {rating.reviewCount > 0 && (
      <span style={{ color: theme.colors.textMuted, fontVariantNumeric: 'tabular-nums' }}>
        ({rating.reviewCount.toLocaleString()})
      </span>
    )}
  </span>
)

// ── 카드 한 장 ──────────────────────────────────────────────────
interface CardProps {
  row: ProductRankingRow
  basis: RankingBasis
  imageUrl: string | null | undefined
  /** 쿠팡 별점 — 없거나 아직 찾는 중이면 표시하지 않는다 */
  rating: ProductRating | null | undefined
}

const RankingCard: React.FC<CardProps> = ({ row, basis, imageUrl, rating }) => {
  const basisLabel = RANKING_BASES.find((b) => b.key === basis)?.label ?? ''
  const displayName = row.name || '(상품명 없음)'
  const supplyTotal = SUPPLY_KEYS.reduce((sum, key) => sum + row[key], 0)

  const search = purchaseSearchTerm(row)
  const linkState: PurchaseManagementLocationState = { search }

  return (
    // 카드 전체가 링크 — 누르면 로켓그로스 사입 화면이 이 상품을 검색한 상태로 열린다
    <Link
      to={PURCHASE_PATH}
      state={linkState}
      title={`로켓그로스 사입에서 '${search}' 검색`}
      style={{
        ...theme.card,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        color: 'inherit',
        textDecoration: 'none',
      }}
    >
      {/* ── 머리줄: 순위(왼쪽) · 순위 기준 값(오른쪽) ── */}
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px 8px',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <RankBadge rank={row.rank} />
          {rating && <RatingStar rating={rating} />}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '6px' }}>
          <span style={{ fontSize: theme.fontSize.sm, color: theme.colors.textSecondary }}>{basisLabel}</span>
          <span
            style={{
              fontSize: theme.fontSize['2xl'],
              fontWeight: 700,
              lineHeight: 1.1,
              fontVariantNumeric: 'tabular-nums',
              color: theme.colors.primary,
            }}
          >
            {row[basis].toLocaleString()}
          </span>
        </span>
      </div>

      {/* ── 이미지 ── */}
      <ProductImage url={imageUrl} alt={displayName} />

      <div style={{ flex: 'none', padding: '8px 14px 10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* ── 상품명 (두 줄까지) · 옵션 수 · 상품 ID ── */}
        <div>
          <div
            title={row.name}
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              fontSize: theme.fontSize.base,
              fontWeight: 600,
              lineHeight: 1.4,
              color: theme.colors.textPrimary,
              wordBreak: 'break-all',
            }}
          >
            {displayName}
          </div>
          <div
            style={{
              fontSize: theme.fontSize.xs,
              color: theme.colors.textMuted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            옵션 {row.optionCount.toLocaleString()}개{row.productId ? ` · ${row.productId}` : ''}
          </div>
        </div>

        {/* ── 수량 칸 (판매량 넷 / 수량 넷) ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${STAT_COLUMNS}, 1fr)`,
            borderTop: `1px solid ${theme.colors.border}`,
          }}
        >
          {STATS.map((s, i) => {
            const value = row[s.key]
            const isBasis = s.basis === basis
            return (
              <div
                key={s.key}
                title={s.title}
                style={{
                  padding: '5px 2px',
                  textAlign: 'center',
                  borderTop: i >= STAT_COLUMNS ? `1px solid ${theme.colors.borderLight}` : undefined,
                  backgroundColor: isBasis ? theme.colors.primaryLight : undefined,
                }}
              >
                <div
                  style={{
                    fontSize: theme.fontSize.xs,
                    color: isBasis ? theme.colors.primary : theme.colors.textSecondary,
                  }}
                >
                  {s.label}
                </div>
                <div
                  style={{
                    marginTop: '2px',
                    fontSize: theme.fontSize.base,
                    fontWeight: isBasis ? 700 : 500,
                    fontVariantNumeric: 'tabular-nums',
                    color: valueColor(value, isBasis),
                  }}
                >
                  {formatValue(value)}
                </div>
              </div>
            )
          })}

          {/* ── 합계: 아랫줄 넷(🛒 · 주문 · C.in · 창고)을 더한 값 ── */}
          <div
            title={SUPPLY_TOTAL_TITLE}
            style={{
              gridColumn: '1 / -1',
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              padding: '6px 6px 0',
              borderTop: `1px solid ${theme.colors.border}`,
            }}
          >
            <span style={{ fontSize: theme.fontSize.xs, color: theme.colors.textSecondary }}>
              합계 <span style={{ color: theme.colors.textMuted }}>🛒+주문+C.in+창고</span>
            </span>
            <span
              style={{
                fontSize: theme.fontSize.lg,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: valueColor(supplyTotal, false),
              }}
            >
              {formatValue(supplyTotal)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}

// ══════════════════════════════════════════════════════════════════
// 카드 목록
// ══════════════════════════════════════════════════════════════════

interface Props {
  rows: ProductRankingRow[]
  basis: RankingBasis
  /** 상품 ID → 이미지 주소. 키가 없으면 아직 찾는 중, null 이면 이미지 없음 */
  imageUrls: Record<string, string | null>
  /** 상품 ID → 쿠팡 별점. 키가 없거나 null 이면 표시하지 않는다 */
  ratings: Record<string, ProductRating | null>
}

const ProductRankingCards: React.FC<Props> = ({ rows, basis, imageUrls, ratings }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${CARDS_PER_ROW}, minmax(${CARD_MIN_WIDTH}, 1fr))`,
      // 줄 높이 = (감싼 영역 높이 − 줄 사이 간격) ÷ 2. 감싼 쪽(Index)이 container-type: size 라
      // 100cqh 가 '제목 줄을 뺀 화면 높이'다. [더보기] 로 늘어난 줄도 같은 높이를 쓴다.
      gridAutoRows: `max(calc((100cqh - ${CARD_GAP_PX * (ROWS_PER_SCREEN - 1)}px) / ${ROWS_PER_SCREEN}), ${CARD_MIN_HEIGHT_PX}px)`,
      gap: `${CARD_GAP_PX}px`,
    }}
  >
    {rows.map((row) => (
      <RankingCard
        key={`${row.rank}-${row.productId}`}
        row={row}
        basis={basis}
        // 상품 ID 가 없는 행은 이미지를 찾을 방법이 없다
        imageUrl={row.productId ? imageUrls[row.productId] : null}
        rating={row.productId ? ratings[row.productId] : null}
      />
    ))}
  </div>
)

export default ProductRankingCards
