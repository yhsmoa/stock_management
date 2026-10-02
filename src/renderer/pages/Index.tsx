/* ================================================================
   홈 — 상품 랭킹 (1~10위, [더보기] 로 20위까지)
   - 예전 '공지사항' 자리. 로켓그로스 사입(사입관리)의 상품 단위 합계로 순위를 매긴다.
   - 로직은 useProductRanking / productRankingService, 카드는 components/home 이 맡는다.
   ================================================================ */

import React from 'react'
import { Link } from 'react-router-dom'
import { theme } from '../styles/theme'
import ProductRankingCards from '../components/home/ProductRankingCards'
import { useProductRanking } from './useProductRanking'
import { RANKING_BASES, RANKING_MAX_SIZE, RANKING_SIZE } from '../services/productRankingService'

const PAGE_PADDING_PX = 20

/** 순위를 계산한 시각 — '10. 2. 오후 03:20' 꼴 */
const formatSavedAt = (savedAt: number): string =>
  new Date(savedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const Index: React.FC = () => {
  const { rows, imageUrls, basis, setBasis, loading, error, reload, hasMore, showMore, savedAt } = useProductRanking()
  const basisInfo = RANKING_BASES.find((b) => b.key === basis)

  // ── 안내 문구 (카드 대신 보여 줄 것: 첫 로딩 / 오류 / 결과 없음) ──
  //   보여 줄 순위가 이미 있으면(보관본을 띄운 채 새로고침 중) 카드를 그대로 둔다.
  const hasRows = rows.length > 0
  const notice = hasRows
    ? null
    : loading
      ? '상품 랭킹을 불러오는 중…'
      : error ?? `'${basisInfo?.label}' 값이 있는 상품이 없습니다.`

  return (
    // Layout 의 <main> 은 스크롤하지 않으므로(overflow: hidden) 이 화면이 직접 스크롤 영역이 된다
    <div
      style={{
        height: '100vh',
        boxSizing: 'border-box',
        padding: `${PAGE_PADDING_PX}px`,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ── 제목 줄: 제목 · 기준 선택 · 새로고침 ─────────────── */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
        <h1 style={{ margin: 0, fontSize: theme.fontSize['4xl'], color: theme.colors.textPrimary }}>
          상품 랭킹
        </h1>
        <span style={{ fontSize: theme.fontSize.base, color: theme.colors.textSecondary }}>
          1~{rows.length > RANKING_SIZE ? rows.length : RANKING_SIZE}위 · 상품 단위 합계
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* 보관해 둔 순위를 보여 주는 화면이라, 언제 계산한 값인지 밝힌다 */}
          {savedAt != null && (
            <span
              title="하루가 지나면 자동으로 새로 불러옵니다. 바로 갱신하려면 [새로고침]."
              style={{ marginRight: '8px', fontSize: theme.fontSize.sm, color: error ? theme.colors.danger : theme.colors.textMuted }}
            >
              {error ? `${error} · ` : ''}{formatSavedAt(savedAt)} 기준
            </span>
          )}
          <span style={{ fontSize: theme.fontSize.sm, color: theme.colors.textSecondary }}>순위 기준</span>
          <div
            role="group"
            aria-label="순위 기준"
            style={{
              display: 'inline-flex',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radius.md,
              overflow: 'hidden',
              backgroundColor: theme.colors.bgCard,
            }}
          >
            {RANKING_BASES.map((b, i) => {
              const active = b.key === basis
              return (
                <button
                  key={b.key}
                  type="button"
                  title={b.hint}
                  aria-pressed={active}
                  onClick={() => setBasis(b.key)}
                  style={{
                    padding: '7px 14px',
                    border: 'none',
                    borderLeft: i === 0 ? 'none' : `1px solid ${theme.colors.border}`,
                    backgroundColor: active ? theme.colors.primary : 'transparent',
                    color: active ? theme.colors.textWhite : theme.colors.textPrimary,
                    fontSize: theme.fontSize.sm,
                    fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {b.label}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={() => reload()}
            disabled={loading}
            style={{
              padding: '7px 14px',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.bgCard,
              color: theme.colors.textPrimary,
              fontSize: theme.fontSize.sm,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? '불러오는 중…' : '새로고침'}
          </button>
        </div>
      </div>

      {/* ── 본문 ─────────────────────────────────────────────
          제목 줄을 뺀 나머지 높이를 차지하고(container-type: size), 카드 줄 높이가 이 높이를 기준으로 잡혀
          카드 두 줄이 한 화면에 꼭 맞는다. [더보기]·출처 안내는 그 아래로 넘쳐 스크롤로 내려가서 본다. */}
      <div style={{ flex: '1 0 0', minHeight: 0, containerType: 'size' }}>
      {notice ? (
        <div style={{ ...theme.card, padding: '32px 20px', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: theme.fontSize.md, color: error ? theme.colors.danger : theme.colors.textSecondary }}>
            {notice}
          </p>
        </div>
      ) : (
        <ProductRankingCards rows={rows} basis={basis} imageUrls={imageUrls} />
      )}

      {/* ── [더보기]: 11위부터 이어서 보여 준다 ───────────────── */}
      {!notice && hasMore && (
        <div style={{ marginTop: '16px', textAlign: 'center' }}>
          <button
            type="button"
            onClick={showMore}
            style={{
              padding: '10px 32px',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.bgCard,
              color: theme.colors.textPrimary,
              fontSize: theme.fontSize.base,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            더보기 ({RANKING_SIZE + 1}~{RANKING_MAX_SIZE}위)
          </button>
        </div>
      )}

      {/* ── 출처 안내 ───────────────────────────────────────── */}
      <p style={{ margin: 0, padding: `12px 0 ${PAGE_PADDING_PX}px`, fontSize: theme.fontSize.sm, color: theme.colors.textMuted, lineHeight: 1.6 }}>
        <Link to="/purchase-management" style={{ color: theme.colors.primary }}>로켓그로스 사입</Link>
        {' '}화면과 같은 값입니다 — 옵션별 값을 상품으로 합쳤고, 비활성 옵션과 기준 값이 0 인 상품은 뺐습니다.
        {basisInfo ? ` 지금 기준: ${basisInfo.hint}.` : ''}
      </p>
      </div>
    </div>
  )
}

export default Index
