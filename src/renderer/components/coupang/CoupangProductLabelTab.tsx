/* ================================================================
   상품관리 — 상세 패널 [라벨] 탭 (2026-11-26)
   - 이 상품의 바코드 있는 옵션(= 라벨을 찍는 옵션)마다 라벨 정보를 보고 고친다
       혼용률  : 직접 입력값. 비우면 쿠팡 고시정보 값을 쓴다 (입력 칸 아래에 쿠팡 값 표시)
       권장연령: 직접 입력값. 키즈 상품은 [사이즈로 채우기] 로 빈칸을 한 번에 넣을 수 있다
   - 줄마다 지금 입력값 기준으로 성인/키즈 · 출력 가능 여부를 바로 보여 준다 (labelInfoRules.resolveLabelInfo —
     목록의 🖨 잠금 · 인쇄 직전 확인과 같은 함수)
   - 저장은 si_item_info (아이템관리 › 상품정보와 같은 표, 바코드 기준). 바뀐 줄만 보낸다
   ================================================================ */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchProductLabelRows,
  saveProductLabelInfo,
  type ProductLabelRow,
} from '../../services/productLabelInfoService'
import { ageFromOptionName, isKidsCategory, resolveLabelInfo, KIDS_NOTICE_CATEGORY } from '../../services/labelInfoRules'
import { compareOptionNames } from './optionSort'

interface Props {
  userId: string
  itemId: string
  /** 저장한 뒤 — 목록 다시 읽기 (🖨 잠금 · 키즈 표시 갱신) */
  onChanged: () => void
}

/** 입력 중인 값 (바코드 → 혼용률 · 권장연령) */
type Drafts = Record<string, { composition: string; age: string }>

function draftsOf(rows: ProductLabelRow[]): Drafts {
  const out: Drafts = {}
  for (const r of rows) out[r.barcode] = { composition: r.manualComposition, age: r.recommendedAge }
  return out
}

const CoupangProductLabelTab: React.FC<Props> = ({ userId, itemId, onChanged }) => {
  const [rows, setRows] = useState<ProductLabelRow[] | null>(null)
  const [drafts, setDrafts] = useState<Drafts>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [bulkComposition, setBulkComposition] = useState('')

  // ── 조회 — 탭을 열 때 · 저장한 뒤 ──
  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const list = await fetchProductLabelRows(userId, itemId)
      list.sort((a, b) => compareOptionNames(a.optionNames[0] ?? null, b.optionNames[0] ?? null) || a.barcode.localeCompare(b.barcode))
      setRows(list)
      setDrafts(draftsOf(list))
    } catch (err) {
      setLoadError((err as { message?: string } | null)?.message || '라벨 정보 조회 실패')
    }
  }, [userId, itemId])

  useEffect(() => {
    setRows(null)
    setMessage(null)
    setBulkComposition('')
    void load()
  }, [load])

  // ── 바뀐 줄 ──
  const changed = useMemo(
    () => (rows ?? []).filter((r) => {
      const d = drafts[r.barcode]
      return !!d && (d.composition.trim() !== r.manualComposition || d.age.trim() !== r.recommendedAge)
    }),
    [rows, drafts],
  )

  const setDraft = (barcode: string, patch: Partial<{ composition: string; age: string }>) => {
    setMessage(null)
    setDrafts((prev) => ({ ...prev, [barcode]: { ...prev[barcode], ...patch } }))
  }

  /** 혼용률 한 번에 — 모든 줄의 직접 입력 혼용률을 같은 값으로 */
  const applyBulkComposition = () => {
    const value = bulkComposition.trim()
    if (!value || !rows) return
    setMessage(null)
    setDrafts((prev) => {
      const next = { ...prev }
      for (const r of rows) next[r.barcode] = { ...next[r.barcode], composition: value }
      return next
    })
  }

  /** 키즈 — 빈 권장연령을 사이즈로 (자동 입력과 같은 규칙. 사이즈로 정할 수 없는 줄은 그대로 둔다) */
  const fillAgesBySize = () => {
    if (!rows) return
    let filled = 0
    setDrafts((prev) => {
      const next = { ...prev }
      for (const r of rows) {
        if (next[r.barcode].age.trim()) continue
        const ages = new Set(r.optionNames.map((name) => ageFromOptionName(name)))
        const age = ages.size === 1 ? [...ages][0] : null
        if (!age) continue
        next[r.barcode] = { ...next[r.barcode], age }
        filled++
      }
      return next
    })
    setMessage({ kind: 'ok', text: filled > 0 ? `${filled}개 줄에 권장연령을 넣었습니다 — [저장] 을 눌러야 반영됩니다.` : '사이즈로 정할 수 있는 빈 권장연령이 없습니다.' })
  }

  const save = async () => {
    if (changed.length === 0 || saving) return
    setSaving(true)
    setMessage(null)
    try {
      await saveProductLabelInfo(userId, changed.map((r) => ({
        barcode: r.barcode,
        infoId: r.infoId,
        manualComposition: drafts[r.barcode].composition,
        recommendedAge: drafts[r.barcode].age,
      })))
      const count = changed.length
      await load()
      setMessage({ kind: 'ok', text: `${count}개 줄을 저장했습니다.` })
      onChanged()
    } catch (err) {
      setMessage({ kind: 'err', text: `저장 실패: ${(err as { message?: string } | null)?.message || '알 수 없는 오류'}` })
    } finally {
      setSaving(false)
    }
  }

  if (loadError) return <div className="cp-label-tab-note is-err">{loadError}</div>
  if (rows === null) return <div className="cp-label-tab-note">불러오는 중…</div>
  if (rows.length === 0) {
    return <div className="cp-label-tab-note">이 상품에는 바코드가 있는 옵션이 없습니다 — 라벨은 바코드가 있는 옵션(로켓그로스)만 출력합니다.</div>
  }

  const category = rows.find((r) => r.noticeCategory)?.noticeCategory ?? null
  const kidsCategory = isKidsCategory(category)

  return (
    <div className="cp-label-tab">
      {/* ── 이 상품의 구분 ── */}
      <section className="cp-panel-section">
        <h3>라벨 구분</h3>
        <div className="cp-label-tab-kind">
          <span className={`cp-badge${kidsCategory ? ' cp-badge-kids' : ''}`}>{kidsCategory ? '키즈' : '성인'}</span>
          <span>
            쿠팡 고시정보 분류: <b>{category ?? '받은 적 없음'}</b>
            {kidsCategory
              ? ' — 키즈 양식으로 출력됩니다. 혼용률과 권장연령이 모두 있어야 합니다.'
              : ` — 성인 양식으로 출력됩니다 (혼용률 필요). 분류가 ${KIDS_NOTICE_CATEGORY}이 아니어도 권장연령을 넣은 옵션은 키즈 양식으로 나갑니다.`}
          </span>
        </div>
      </section>

      {/* ── 한 번에 넣기 ── */}
      <section className="cp-panel-section">
        <h3>한 번에 넣기</h3>
        <div className="cp-label-tab-bulk">
          <input
            type="text"
            className="cp-edit-input"
            value={bulkComposition}
            placeholder="혼용률 (예: 면 95%, 폴리우레탄 5%)"
            aria-label="모든 옵션에 넣을 혼용률"
            onChange={(e) => setBulkComposition(e.target.value)}
          />
          <button type="button" className="cp-btn cp-btn-sm" disabled={!bulkComposition.trim()} onClick={applyBulkComposition}>모든 옵션에 넣기</button>
          <button type="button" className="cp-btn cp-btn-sm" title="빈 권장연령을 옵션의 숫자 사이즈로 채웁니다 (120 5-7세 · 130 7-9세 · 140 9-11세 · 150 11-12세 · 160 12-14세, 범위는 큰 숫자)" onClick={fillAgesBySize}>
            사이즈로 권장연령 채우기
          </button>
        </div>
      </section>

      {/* ── 옵션별 ── */}
      <section className="cp-panel-section">
        <h3>옵션 {rows.length}개 (바코드 기준)</h3>
        <div className="cp-panel-table">
          <div className="cp-label-tab-row is-head">
            <div>옵션 · 바코드</div><div>혼용률 (직접 입력)</div><div>권장연령</div><div>출력</div>
          </div>
          {rows.map((r) => {
            const d = drafts[r.barcode]
            const resolved = resolveLabelInfo({
              noticeCategory: r.noticeCategory,
              coupangComposition: r.coupangComposition,
              manualComposition: d.composition,
              recommendedAge: d.age,
            })
            const dirtyComposition = d.composition.trim() !== r.manualComposition
            const dirtyAge = d.age.trim() !== r.recommendedAge
            return (
              <div key={r.barcode} className="cp-label-tab-row">
                <div style={{ minWidth: 0 }}>
                  <div className="cp-ellipsis" title={r.optionNames.join(' / ')}>{r.optionNames.join(' / ') || '—'}</div>
                  <div className="cp-mono cp-label-tab-sub">{r.barcode}</div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <input
                    type="text"
                    className={`cp-edit-input${dirtyComposition ? ' is-changed' : ''}`}
                    value={d.composition}
                    placeholder={r.coupangComposition ? '비우면 쿠팡 값 사용' : '혼용률 입력'}
                    aria-label={`${r.optionNames[0] ?? r.barcode} 혼용률`}
                    onChange={(e) => setDraft(r.barcode, { composition: e.target.value })}
                  />
                  <div className="cp-label-tab-sub cp-ellipsis" title={r.coupangComposition ?? ''}>쿠팡: {r.coupangComposition || '없음'}</div>
                </div>
                <div>
                  <input
                    type="text"
                    className={`cp-edit-input${dirtyAge ? ' is-changed' : ''}`}
                    value={d.age}
                    placeholder={resolved.audience === 'kids' ? '예: 7-9세' : '—'}
                    aria-label={`${r.optionNames[0] ?? r.barcode} 권장연령`}
                    onChange={(e) => setDraft(r.barcode, { age: e.target.value })}
                  />
                </div>
                <div className={`cp-label-tab-status${resolved.blockReason ? ' is-blocked' : ''}`} title={resolved.blockReason ?? ''}>
                  {resolved.audience === 'kids' ? '키즈' : '성인'} · {resolved.blockReason ? '출력 불가' : '출력 가능'}
                  {resolved.missing.length > 0 && <div className="cp-label-tab-sub">{resolved.missing.join(' · ')} 없음</div>}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── 저장 ── */}
      <div className="cp-label-tab-actions">
        {message && <span className={`cp-label-tab-msg${message.kind === 'err' ? ' is-err' : ''}`} role="status">{message.text}</span>}
        <button type="button" className="cp-btn" disabled={changed.length === 0 || saving} onClick={() => { setDrafts(draftsOf(rows)); setMessage(null) }}>되돌리기</button>
        <button type="button" className="cp-btn cp-btn-primary" disabled={changed.length === 0 || saving} onClick={save}>
          {saving ? '저장 중…' : changed.length > 0 ? `저장 (${changed.length}줄)` : '저장'}
        </button>
      </div>
    </div>
  )
}

export default CoupangProductLabelTab
