/* ================================================================
   상품관리 (CoupangManagement) 화면 상태 훅
   - 조회(필터 · 페이지 · 상품 요약 · 건수) · 선택 · 동기화 진행 · 변경 작업 · 분류/비고 · 엑셀 · 라벨
   - Supabase · 쿠팡 호출은 전부 services/coupangProductService 에 있다
   ================================================================ */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  getCurrentUserId,
  fetchProductPage,
  fetchSalesCounts,
  fetchProductSummaries,
  fetchSyncSummary,
  updatePackageType,
  updateNote,
  bulkClassify,
  deleteProductRow,
  syncProductList,
  syncProductDetails,
  fetchDetailMissingProductIds,
  fetchNoticesMissingProductIds,
  checkSalesStatus,
  fetchStaleStatusOptionIds,
  applyChanges,
  uploadPriceInventoryExcel,
  uploadClassifyExcel,
  exportProductsToExcel,
  CHANGE_KIND_LABELS,
  type ChangeKind,
  type ChangeTarget,
  type ClassifyExcelResult,
  type DetailMissingIds,
} from '../services/coupangProductService'
import { toLabelPrintItems, applyManualComposition } from '../services/labelService'
import { compareOptionNames } from '../components/coupang/optionSort'
import { isAbortError } from '../utils/rateLimitQueue'
import { inlineEditBlock, type InlineField } from '../components/coupang/editRules'
import { priceInputProblem, priceLimitViolation } from '../components/coupang/priceRules'
import {
  startSyncRun,
  updateSyncRun,
  finishSyncRun,
  fetchLatestSyncRuns,
  runViewStatus,
  RUN_WRITE_INTERVAL_MS,
  type SyncRun,
  type SyncRunKind,
} from '../services/coupangSyncRunService'
import type { LabelPrintItem } from '../services/labelPrintService'
import type {
  CoupangProductRow,
  CoupangProductFilters,
  CoupangProductGroup,
  CoupangProductSummary,
  CoupangSyncSummary,
  SalesCounts,
  SyncProgress,
  ChannelFilter,
  SalesFilter,
  ApprovalFilter,
  SearchField,
} from '../types/coupangProduct'

// ── 상수 ──────────────────────────────────────────────────────────
export const PRODUCTS_PER_PAGE = 50        // 한 페이지 상품 수 (옵션은 그 상품들 것 전부)
const STATUS_CHECK_STALE_BATCH = 500       // [오래된 순 확인] 한 번에 확인할 옵션 수 (≈ 100초)

/** 다른 곳에서 동기화가 도는 동안 카드 진행률을 다시 읽는 간격 */
const REMOTE_RUN_POLL_MS = 5000
/** 실행 기록을 남기는 진행 종류 (가격 변경 · 엑셀은 기록하지 않는다) */
const RECORDED_KINDS: ReadonlySet<SyncProgress['kind']> = new Set<SyncProgress['kind']>(['list', 'detail', 'status'])

/** 옵션을 겨냥한 검색이면 결과 상품을 펼쳐서 보여 준다 (찾는 옵션이 바로 보이게) */
const OPTION_TARGET_SEARCH: ReadonlySet<SearchField> = new Set<SearchField>(['optionId', 'barcode', 'itemCode'])

const DEFAULT_FILTERS: CoupangProductFilters = {
  channel: 'all',
  sales: 'on',
  approval: 'all',
  searchField: 'name',
  search: '',
}

/** 상세 동기화 범위 — 상세 미수신 / 고시정보 미수신(고시정보 저장 전에 상세를 받은 상품) */
export type DetailSyncScope = 'missingOnSale' | 'missingAll' | 'noticesOnSale' | 'noticesAll'

/** 범위 선택 모달의 대상 수 */
export interface DetailScopeCounts {
  missing: DetailMissingIds
  notices: DetailMissingIds
}

export function useCoupangManagement() {
  const userId = useMemo(() => getCurrentUserId(), [])

  // ── 조회 상태 ──
  const [filters, setFilters] = useState<CoupangProductFilters>(DEFAULT_FILTERS)
  const [searchInput, setSearchInput] = useState('')
  // 페이지 = 커서 목록. cursors[i] 는 i+1 페이지를 여는 커서 (첫 페이지는 null) — 이전으로 갈 때 되짚는다
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [rows, setRows] = useState<CoupangProductRow[]>([])
  // 펼친 상품 (등록상품 ID). 기본은 모두 접힘
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [summaries, setSummaries] = useState<Map<string, CoupangProductSummary>>(new Map())
  const [salesCounts, setSalesCounts] = useState<SalesCounts | null>(null)
  const [syncSummary, setSyncSummary] = useState<CoupangSyncSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // ── 선택 (페이지를 넘겨도 유지 — 행 데이터를 같이 들고 있는다) ──
  const [selected, setSelected] = useState<Map<string, CoupangProductRow>>(new Map())

  // ── 동기화 · 변경 진행 ──
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [detailScope, setDetailScope] = useState<{ open: boolean; counts: DetailScopeCounts | null }>({ open: false, counts: null })

  // ── 모달 · 패널 ──
  const [detailItemId, setDetailItemId] = useState<string | null>(null)
  const [changeKind, setChangeKind] = useState<ChangeKind | null>(null)
  const [classifyOpen, setClassifyOpen] = useState(false)
  const [excelClassifyResult, setExcelClassifyResult] = useState<ClassifyExcelResult | null>(null)
  const [labelItems, setLabelItems] = useState<LabelPrintItem[] | null>(null)
  const [excelUpload, setExcelUpload] = useState<{ percent: number; status: string } | null>(null)
  const [noteEditing, setNoteEditing] = useState<{ optionId: string; value: string } | null>(null)

  // ── 동기화 실행 기록 (카드 맨 아래 · 다른 창 진행 감지) ──
  const [latestRuns, setLatestRuns] = useState<Partial<Record<SyncRunKind, SyncRun>>>({})
  /** 이 화면이 지금 기록 중인 실행 — id 는 insert 가 끝나야 나와서 Promise 로 든다 */
  const runRef = useRef<{ idPromise: Promise<string | null>; done: number; total: number; message: string; title: string; lastWrite: number } | null>(null)

  const busy = !!progress?.running || !!excelUpload
  /** 다른 창 · 다른 화면에서 같은 계정의 동기화가 돌고 있음 (기록이 최근에 갱신된 running) */
  const remoteRunning = !progress?.running && Object.values(latestRuns).some((r) => r && runViewStatus(r) === 'running')
  /** 동기화 버튼 잠금 — 이 화면에서 진행 중이거나, 다른 곳에서 진행 중 (같은 동기화를 두 번 돌리지 않도록) */
  const syncLocked = busy || remoteRunning

  // ══════════════════════════════════════════════════════════════
  // 조회
  // ══════════════════════════════════════════════════════════════

  const pageCursor = cursors[cursors.length - 1]
  const page = cursors.length                       // 1부터
  const autoExpand = !!filters.search && OPTION_TARGET_SEARCH.has(filters.searchField)
  // 펼침 상태는 "다른 페이지·조건"으로 갈 때만 초기화한다 — 같은 페이지 다시 읽기(가격 변경·비고 저장 뒤)는 유지
  const lastPageKeyRef = useRef<string>('')

  // 페이지 → 상품 요약 → 판매상태 건수 → 머리 카드 요약, 순서대로.
  //   큰 계정(7.8만 행)에서 count 쿼리를 한꺼번에 보내면 Supabase statement timeout 이 난다 (2026-10-20 실측)
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    ;(async () => {
      try {
        const pageResult = await fetchProductPage(userId, filters, pageCursor, PRODUCTS_PER_PAGE)
        if (cancelled) return
        setRows(pageResult.rows)
        setNextCursor(pageResult.nextCursor)
        // 새 페이지·새 조건은 접어서 시작 (옵션을 겨냥한 검색이면 펼쳐서), 같은 페이지 다시 읽기는 그대로
        const pageKey = JSON.stringify([filters, pageCursor])
        if (pageKey !== lastPageKeyRef.current) {
          lastPageKeyRef.current = pageKey
          setExpanded(autoExpand ? new Set(pageResult.itemIds) : new Set())
        }
        setLoading(false)

        const itemIds = pageResult.itemIds
        const sums = await fetchProductSummaries(userId, itemIds)
        if (cancelled) return
        setSummaries(sums)

        const counts = await fetchSalesCounts(userId, filters)
        if (cancelled) return
        setSalesCounts(counts)

        const summary = await fetchSyncSummary(userId)
        if (cancelled) return
        setSyncSummary(summary)

        const runs = await fetchLatestSyncRuns(userId)
        if (!cancelled) setLatestRuns(runs)
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : '조회 실패')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [userId, filters, pageCursor, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  // ── 동기화 중 창 닫기 경고 — 닫으면 진행 중인 호출이 끊긴다 (받은 것은 남고, 다시 누르면 이어서 받는다) ──
  const syncRunning = !!progress?.running
  useEffect(() => {
    if (!syncRunning) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [syncRunning])

  // ── 다른 곳에서 동기화가 도는 동안: 기록을 몇 초마다 다시 읽어 카드 진행률을 갱신, 끝나면 목록 다시 읽기 ──
  useEffect(() => {
    if (!userId || !remoteRunning) return
    const timer = window.setInterval(async () => {
      const runs = await fetchLatestSyncRuns(userId)
      setLatestRuns(runs)
      const stillRunning = Object.values(runs).some((r) => r && runViewStatus(r) === 'running')
      if (!stillRunning) reload()
    }, REMOTE_RUN_POLL_MS)
    return () => window.clearInterval(timer)
  }, [userId, remoteRunning, reload])

  // ── 페이지 이동 (커서) ──
  const resetPages = useCallback(() => setCursors([null]), [])
  const goNextPage = useCallback(() => {
    if (nextCursor) setCursors((c) => [...c, nextCursor])
  }, [nextCursor])
  const goPrevPage = useCallback(() => setCursors((c) => (c.length > 1 ? c.slice(0, -1) : c)), [])
  const goFirstPage = resetPages

  // ── 펼치기 / 접기 ──
  const toggleExpanded = useCallback((itemId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }, [])

  // ── 상품 묶음 (상품 순서 유지 · 옵션은 옵션명 순) ──
  const groups = useMemo<CoupangProductGroup[]>(() => {
    const out: CoupangProductGroup[] = []
    const byItem = new Map<string, CoupangProductGroup>()
    for (const r of rows) {
      const key = r.item_id ?? `(없음)-${r.option_id}`
      let g = byItem.get(key)
      if (!g) {
        const summary = r.item_id ? summaries.get(r.item_id) ?? null : null
        g = {
          itemId: key,
          rows: [],
          itemName: r.item_name || r.product_name || '(상품명 없음)',
          productId: r.product_id ?? summary?.productId ?? null,
          approval: r.coupang_approval,
          imgUrl: r.img_url ?? summary?.imgUrl ?? null,
          summary,
        }
        byItem.set(key, g)
        out.push(g)
      }
      g.rows.push(r)
      if (!g.imgUrl && r.img_url) g.imgUrl = r.img_url
      if (!g.productId && r.product_id) g.productId = r.product_id
    }
    // 옵션은 옵션명 순 (색상끼리 · 사이즈는 S → M → L …), 이름이 같으면 옵션 ID 순
    for (const g of out) {
      g.rows.sort((a, b) => compareOptionNames(a.option_name, b.option_name) || a.option_id.localeCompare(b.option_id))
    }
    return out
  }, [rows, summaries])

  const expandAll = useCallback(() => setExpanded(new Set(groups.map((g) => g.itemId))), [groups])
  const collapseAll = useCallback(() => setExpanded(new Set()), [])

  // ── 필터 (바뀌면 첫 페이지로) ──
  const setChannel = useCallback((channel: ChannelFilter) => { setFilters((f) => ({ ...f, channel })); resetPages() }, [resetPages])
  const setSales = useCallback((sales: SalesFilter) => { setFilters((f) => ({ ...f, sales })); resetPages() }, [resetPages])
  const setApproval = useCallback((approval: ApprovalFilter) => { setFilters((f) => ({ ...f, approval })); resetPages() }, [resetPages])
  const setSearchField = useCallback((searchField: SearchField) => setFilters((f) => ({ ...f, searchField })), [])
  const submitSearch = useCallback(() => { setFilters((f) => ({ ...f, search: searchInput.trim() })); resetPages() }, [searchInput, resetPages])
  const clearSearch = useCallback(() => { setSearchInput(''); setFilters((f) => ({ ...f, search: '' })); resetPages() }, [resetPages])

  // ══════════════════════════════════════════════════════════════
  // 선택
  // ══════════════════════════════════════════════════════════════

  const toggleOption = useCallback((row: CoupangProductRow, checked: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (checked) next.set(row.option_id, row)
      else next.delete(row.option_id)
      return next
    })
  }, [])

  const toggleRows = useCallback((targets: CoupangProductRow[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev)
      for (const r of targets) {
        if (checked) next.set(r.option_id, r)
        else next.delete(r.option_id)
      }
      return next
    })
  }, [])

  const clearSelection = useCallback(() => setSelected(new Map()), [])
  const selectedRows = useMemo(() => [...selected.values()], [selected])

  // 화면의 행이 새로 조회되면 선택된 행 데이터도 최신 값으로 바꿔 둔다 (가격 변경 미리보기용)
  useEffect(() => {
    if (selected.size === 0) return
    setSelected((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const r of rows) {
        if (next.has(r.option_id) && next.get(r.option_id) !== r) { next.set(r.option_id, r); changed = true }
      }
      return changed ? next : prev
    })
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  // ══════════════════════════════════════════════════════════════
  // 동기화 진행 공통
  // ══════════════════════════════════════════════════════════════

  const startProgress = useCallback((kind: SyncProgress['kind'], title: string, message: string, record = true): AbortController => {
    const controller = new AbortController()
    abortRef.current = controller
    setProgress({ kind, title, running: true, done: 0, total: 0, message, errors: [], result: null })
    // 실행 기록 시작 (목록 · 상세 · 판매상태만) — 기록 실패는 동기화를 막지 않는다
    runRef.current = userId && record && RECORDED_KINDS.has(kind)
      ? { idPromise: startSyncRun(userId, kind as SyncRunKind, title), done: 0, total: 0, message, title, lastWrite: Date.now() }
      : null
    return controller
  }, [userId])

  const updateProgress = useCallback((patch: Partial<SyncProgress>) => {
    setProgress((p) => (p ? { ...p, ...patch } : p))
    // 실행 기록 갱신 — RUN_WRITE_INTERVAL_MS 마다 한 번만 (매건 쓰면 DB 호출이 쿠팡 호출만큼 늘어난다)
    const run = runRef.current
    if (!run) return
    if (patch.done !== undefined) run.done = patch.done
    if (patch.total !== undefined) run.total = patch.total
    if (patch.message !== undefined) run.message = patch.message
    if (patch.title !== undefined) run.title = patch.title
    const now = Date.now()
    if (now - run.lastWrite < RUN_WRITE_INTERVAL_MS) return
    run.lastWrite = now
    const snapshot = { done: run.done, total: run.total, message: run.message, title: run.title }
    void run.idPromise.then((id) => updateSyncRun(id, snapshot))
  }, [])

  const finishProgress = useCallback((result: string, errors: string[] = []) => {
    const aborted = !!abortRef.current?.signal.aborted
    abortRef.current = null
    setProgress((p) => (p ? { ...p, running: false, result, errors: [...p.errors, ...errors] } : p))
    // 실행 기록 끝 — 중단 / 실패 / 완료 (기록이 끝난 뒤 목록을 다시 읽어야 카드에 최신 상태가 뜬다)
    const run = runRef.current
    runRef.current = null
    if (run) {
      const status = aborted ? 'aborted' : result === '실패' ? 'failed' : 'done'
      const message = errors.length ? `${result} · 실패 ${errors.length}건` : result
      void run.idPromise
        .then((id) => finishSyncRun(id, status, { done: run.done, total: run.total, message }))
        .finally(() => reload())
    } else {
      reload()
    }
  }, [reload])

  const abortSync = useCallback(() => {
    abortRef.current?.abort()
    updateProgress({ message: '중단하는 중… (목록은 바로 멈추고, 상세는 보내 둔 몇 건만 끝까지 기다립니다)' })
  }, [updateProgress])

  const closeProgress = useCallback(() => { if (!progress?.running) setProgress(null) }, [progress])

  // ── 1) 목록 동기화 → 새 상품은 바로 상세까지 ──
  const runListSync = useCallback(async () => {
    if (!userId || syncLocked) return
    const controller = startProgress('list', '상품 목록 동기화', '시작…')
    try {
      const result = await syncProductList(userId, (message) => updateProgress({ message }), controller.signal)
      const newProducts = [...new Set([...result.needDetail, ...result.newRgProducts])]
      let detailLine = result.aborted ? ' · 저장 도중 중단됨 (앞부분만 저장)' : ''
      if (newProducts.length > 0 && !controller.signal.aborted) {
        updateProgress({ title: '새 상품 상세 받기', message: `새로 들어온 상품 ${newProducts.length.toLocaleString()}개의 옵션·가격·재고를 받습니다`, done: 0, total: newProducts.length })
        const d = await syncProductDetails(userId, newProducts, (done, total) => updateProgress({ done, total }), controller.signal)
        detailLine = ` · 새 상품 상세 ${d.products.toLocaleString()}개 (옵션 ${d.options.toLocaleString()})${d.aborted ? ' · 중단됨' : ''}`
        result.errors.push(...d.failed)
      }
      finishProgress(
        `일반 ${result.mpProducts.toLocaleString()} · 로켓그로스 ${result.rgProducts.toLocaleString()} (하이브리드 ${result.hybridProducts.toLocaleString()}) 상품 · `
        + `옵션 행 저장 ${result.upserted.toLocaleString()} · 그대로 ${result.unchanged.toLocaleString()}`
        + (result.notInCoupang ? ` · 쿠팡 목록에 없는 상품 ${result.notInCoupang.toLocaleString()}개 (지우지 않음)` : '')
        + detailLine,
        result.errors,
      )
    } catch (err) {
      // 목록을 받는 중 [중단] — 저장 전이라 남는 것이 없다
      if (isAbortError(err)) finishProgress('중단됨 — 쿠팡 목록을 받는 중에 멈춰 저장한 것이 없습니다. 다음 [목록 받기] 는 목록부터 다시 받습니다.')
      else finishProgress('실패', [err instanceof Error ? err.message : String(err)])
    }
  }, [userId, syncLocked, startProgress, updateProgress, finishProgress])

  // ── 2) 상세 동기화 — 범위 선택 모달 → 실행 ──
  const openDetailSync = useCallback(async () => {
    if (!userId || syncLocked) return
    setDetailScope({ open: true, counts: null })
    try {
      // 순서대로 — 큰 계정에서 동시에 세면 statement timeout (CLAUDE.md 규모 주의)
      const missing = await fetchDetailMissingProductIds(userId)
      const notices = await fetchNoticesMissingProductIds(userId)
      setDetailScope((s) => (s.open ? { open: true, counts: { missing, notices } } : s))
    } catch (err) {
      console.error('[openDetailSync] 대상 조회 실패:', err)
      setDetailScope({ open: false, counts: null })
    }
  }, [userId, syncLocked])

  const closeDetailScope = useCallback(() => setDetailScope({ open: false, counts: null }), [])

  /** @param record 실행 기록을 남길지 — 상품 1개 다시 받기는 남기지 않는다 (카드의 대량 실행 기록을 가리지 않게) */
  const runDetailSync = useCallback(async (ids: string[], title = '상세 받기', record = true) => {
    if (!userId || syncLocked || ids.length === 0) return
    const controller = startProgress('detail', title, `상품 ${ids.length.toLocaleString()}개의 옵션·가격·재고·이미지·고시정보를 받습니다`, record)
    updateProgress({ total: ids.length })
    try {
      const d = await syncProductDetails(userId, ids, (done, total) => updateProgress({ done, total }), controller.signal)
      finishProgress(
        `상품 ${d.products.toLocaleString()}개 · 옵션 ${d.options.toLocaleString()}개 저장${d.aborted ? ' · 중단됨' : ''}${d.failed.length ? ` · 실패 ${d.failed.length}` : ''}`,
        d.failed,
      )
    } catch (err) {
      finishProgress('실패', [err instanceof Error ? err.message : String(err)])
    }
  }, [userId, syncLocked, startProgress, updateProgress, finishProgress])

  const confirmDetailScope = useCallback((scope: DetailSyncScope) => {
    const counts = detailScope.counts
    setDetailScope({ open: false, counts: null })
    if (!counts) return
    switch (scope) {
      case 'missingOnSale': void runDetailSync(counts.missing.onSale); break
      case 'missingAll': void runDetailSync(counts.missing.all); break
      case 'noticesOnSale': void runDetailSync(counts.notices.onSale, '고시정보 받기'); break
      case 'noticesAll': void runDetailSync(counts.notices.all, '고시정보 받기'); break
    }
  }, [detailScope.counts, runDetailSync])

  const runDetailForProduct = useCallback((itemId: string) => runDetailSync([itemId], '이 상품 다시 받기', false), [runDetailSync])

  // ── 3) 판매상태 확인 ──
  const runStatusCheck = useCallback(async (target: 'selected' | 'page' | 'stale') => {
    if (!userId || syncLocked) return
    let ids: string[]
    if (target === 'selected') ids = selectedRows.map((r) => r.option_id)
    else if (target === 'page') ids = rows.map((r) => r.option_id)
    else ids = await fetchStaleStatusOptionIds(userId, STATUS_CHECK_STALE_BATCH)
    if (ids.length === 0) return
    const controller = startProgress('status', '판매상태 확인', `옵션 ${ids.length.toLocaleString()}개를 쿠팡에서 확인합니다 (옵션당 1회 호출)`)
    updateProgress({ total: ids.length })
    try {
      const r = await checkSalesStatus(userId, ids, (done, total) => updateProgress({ done, total }), controller.signal)
      finishProgress(`옵션 ${r.checked.toLocaleString()}개 확인${r.aborted ? ' · 중단됨' : ''}${r.failed.length ? ` · 실패 ${r.failed.length}` : ''}`, r.failed)
    } catch (err) {
      finishProgress('실패', [err instanceof Error ? err.message : String(err)])
    }
  }, [userId, syncLocked, selectedRows, rows, startProgress, updateProgress, finishProgress])

  // ══════════════════════════════════════════════════════════════
  // 변경 작업 (가격 · 재고 · 할인율 기준가 · 판매 재개/중지)
  // ══════════════════════════════════════════════════════════════

  const openChange = useCallback((kind: ChangeKind) => { if (selectedRows.length > 0) setChangeKind(kind) }, [selectedRows.length])
  const closeChange = useCallback(() => setChangeKind(null), [])

  const applyChange = useCallback(async (targets: ChangeTarget[], force: boolean) => {
    if (!userId || !changeKind || targets.length === 0) return
    const kind = changeKind
    setChangeKind(null)
    const controller = startProgress('change', CHANGE_KIND_LABELS[kind], `옵션 ${targets.length.toLocaleString()}개를 쿠팡에 적용합니다`)
    updateProgress({ total: targets.length })
    try {
      const r = await applyChanges(userId, kind, targets, { force, signal: controller.signal, onProgress: (done, total) => updateProgress({ done, total }) })
      finishProgress(
        `적용 ${r.ok.toLocaleString()}개${r.failed.length ? ` · 실패 ${r.failed.length}개` : ''}${r.aborted ? ' · 중단됨' : ''}`,
        r.failed.map((f) => `${f.optionId}: ${f.error}`),
      )
      if (r.failed.length === 0 && !r.aborted) clearSelection()
    } catch (err) {
      finishProgress('실패', [err instanceof Error ? err.message : String(err)])
    }
  }, [userId, changeKind, startProgress, updateProgress, finishProgress, clearSelection])

  const patchRow = useCallback((optionId: string, patch: Partial<CoupangProductRow>) => {
    setRows((prev) => prev.map((r) => (r.option_id === optionId ? { ...r, ...patch } : r)))
  }, [])

  // ══════════════════════════════════════════════════════════════
  // 칸 바로 수정 (옵션 1개 · 즉시 반영 묶음) — 판매가 · 기준가 · 재고 · 판매상태
  //   쿠팡이 성공해야 DB·화면을 고친다 (applyChanges). 실패하면 Error 를 던져 칸에 사유를 띄운다.
  //   목록 전체를 다시 읽지 않고 그 행만 고친다 (펼침·스크롤 유지)
  // ══════════════════════════════════════════════════════════════

  const applyInline = useCallback(async (row: CoupangProductRow, field: InlineField, value?: number): Promise<void> => {
    if (!userId) throw new Error('로그인 정보가 없습니다.')
    if (busy) throw new Error('다른 작업이 진행 중입니다. 끝난 뒤 다시 시도하세요.')
    const blocked = inlineEditBlock(row, field)
    if (blocked) throw new Error(blocked)

    let kind: ChangeKind
    let force = false
    switch (field) {
      case 'price': {
        if (value == null) throw new Error('값 없음')
        const problem = priceInputProblem(value, { allowZero: false })
        if (problem) throw new Error(problem)
        const violation = priceLimitViolation(row.price, value)
        if (violation) {
          const msg = violation === 'down'
            ? `현재가 ${row.price?.toLocaleString()}원에서 50% 넘게 내립니다.`
            : `현재가 ${row.price?.toLocaleString()}원에서 100% 넘게 올립니다.`
          if (!confirm(`${msg}\n쿠팡 한도를 넘는 변경이라 강제 적용으로 보냅니다. 진행할까요?`)) throw new Error('취소했습니다.')
          force = true
        }
        kind = 'price'
        break
      }
      case 'originalPrice': {
        if (value == null) throw new Error('값 없음')
        const problem = priceInputProblem(value, { allowZero: true })
        if (problem) throw new Error(problem)
        kind = 'originalPrice'
        break
      }
      case 'quantity':
        if (value == null || !Number.isInteger(value) || value < 0) throw new Error('0 이상의 정수로 입력하세요.')
        kind = 'quantity'
        break
      case 'status':
        kind = row.sales_status === '판매중' ? 'stop' : 'resume'
        break
    }

    const r = await applyChanges(userId, kind, [{ optionId: row.option_id, value }], { force })
    if (r.failed.length > 0) throw new Error(r.failed[0].error)

    const now = new Date().toISOString()
    const patch: Partial<CoupangProductRow> = { app_changed_at: now }
    if (kind === 'price') patch.price = value!
    else if (kind === 'originalPrice') patch.regular_price = value!
    else if (kind === 'quantity') patch.stock = value!
    else { patch.sales_status = kind === 'resume' ? '판매중' : '판매중지'; patch.status_checked_at = now }
    patchRow(row.option_id, patch)
  }, [userId, busy, patchRow])

  // ══════════════════════════════════════════════════════════════
  // 분류 · 비고 · 삭제
  // ══════════════════════════════════════════════════════════════

  const changePackageType = useCallback(async (optionId: string, packageType: string) => {
    if (!userId) return
    patchRow(optionId, { package_type: packageType })       // 낙관적 반영
    try { await updatePackageType(userId, optionId, packageType) }
    catch (err) { console.error('분류 저장 오류:', err); reload() }
  }, [userId, patchRow, reload])

  const startNote = useCallback((row: CoupangProductRow) => setNoteEditing({ optionId: row.option_id, value: row.note ?? '' }), [])
  const setNoteValue = useCallback((value: string) => setNoteEditing((n) => (n ? { ...n, value } : n)), [])
  const commitNote = useCallback(async () => {
    const editing = noteEditing
    setNoteEditing(null)
    if (!editing || !userId) return
    const original = rows.find((r) => r.option_id === editing.optionId)?.note ?? ''
    const next = editing.value.trim()
    if (next === original.trim()) return
    patchRow(editing.optionId, { note: next || null })
    try { await updateNote(userId, editing.optionId, next) }
    catch (err) { console.error('비고 저장 오류:', err); reload() }
  }, [noteEditing, userId, rows, patchRow, reload])

  const submitClassify = useCallback(async (packageType: string, note: string) => {
    if (!userId || selectedRows.length === 0) return
    setClassifyOpen(false)
    try {
      await bulkClassify(userId, selectedRows.map((r) => r.option_id), packageType, note)
      reload()
    } catch (err) {
      alert(`분류 변경 실패: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [userId, selectedRows, reload])

  const deleteRow = useCallback(async (optionId: string) => {
    if (!userId) return
    if (!confirm('이 옵션 행을 삭제할까요? (쿠팡에는 영향 없음 · 다음 동기화 때 다시 들어옵니다)')) return
    try { await deleteProductRow(userId, optionId); reload() }
    catch (err) { alert(`삭제 실패: ${err instanceof Error ? err.message : String(err)}`) }
  }, [userId, reload])

  // ══════════════════════════════════════════════════════════════
  // 엑셀 · 라벨
  // ══════════════════════════════════════════════════════════════

  const uploadPriceExcel = useCallback(async (file: File) => {
    if (!userId || busy) return
    setExcelUpload({ percent: 0, status: '파일을 읽는 중…' })
    try {
      const r = await uploadPriceInventoryExcel(file, userId, (percent, status) => setExcelUpload({ percent, status }))
      setExcelUpload({ percent: 100, status: `완료 — ${r.success.toLocaleString()} / ${r.total.toLocaleString()}건${r.failedBatches ? ` (실패 배치 ${r.failedBatches})` : ''}` })
      setTimeout(() => { setExcelUpload(null); reload() }, 1500)
    } catch (err) {
      setExcelUpload({ percent: 0, status: `업로드 실패: ${err instanceof Error ? err.message : String(err)}` })
      setTimeout(() => setExcelUpload(null), 3000)
    }
  }, [userId, busy, reload])

  const uploadClassify = useCallback(async (file: File) => {
    if (!userId) return
    try {
      const r = await uploadClassifyExcel(file, userId)
      setExcelClassifyResult(r)
      reload()
    } catch (err) {
      alert(`분류 엑셀 업로드 실패: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [userId, reload])

  const exportExcel = useCallback(async () => {
    if (!userId || busy) return
    startProgress('excel', '엑셀 내보내기', '전체 행을 읽는 중…')
    try {
      const n = await exportProductsToExcel(userId, (done, total) => updateProgress({ done, total }))
      finishProgress(n ? `${n.toLocaleString()}행을 내보냈습니다` : '내보낼 데이터가 없습니다')
    } catch (err) {
      finishProgress('실패', [err instanceof Error ? err.message : String(err)])
    }
  }, [userId, busy, startProgress, updateProgress, finishProgress])

  const printLabels = useCallback(async () => {
    const { items, skipped } = toLabelPrintItems(selectedRows)
    if (items.length === 0) { alert('선택한 항목에 바코드가 없어 라벨을 출력할 수 없습니다.'); return }
    if (skipped > 0) alert(`바코드가 없는 ${skipped}개 항목은 제외하고 ${items.length}개만 출력합니다.`)
    // 혼용률: 쿠팡 고시정보 값(행의 composition) → 상품정보 화면 직접 입력값이 있으면 그쪽으로
    if (userId) {
      try { await applyManualComposition(items, userId) }
      catch (err) { console.error('[printLabels] 직접 입력 혼용률 조회 실패 — 쿠팡 값으로 인쇄:', err) }
    }
    setLabelItems(items)
  }, [selectedRows, userId])

  // ══════════════════════════════════════════════════════════════
  // 상세 패널
  // ══════════════════════════════════════════════════════════════

  const detailGroup = useMemo(() => groups.find((g) => g.itemId === detailItemId) ?? null, [groups, detailItemId])

  return {
    userId,
    // 조회
    filters, searchInput, setSearchInput, setChannel, setSales, setApproval, setSearchField, submitSearch, clearSearch,
    rows, groups, loading, loadError, salesCounts, syncSummary, reload,
    // 페이지 (상품 단위 · 이전/다음)
    page, productsPerPage: PRODUCTS_PER_PAGE, hasNextPage: !!nextCursor, hasPrevPage: page > 1,
    goNextPage, goPrevPage, goFirstPage,
    // 펼치기
    expanded, toggleExpanded, expandAll, collapseAll,
    // 선택
    selected, selectedRows, toggleOption, toggleRows, clearSelection,
    // 동기화
    busy, syncLocked, latestRuns, progress, abortSync, closeProgress,
    runListSync, openDetailSync, detailScope, closeDetailScope, confirmDetailScope, runDetailForProduct, runStatusCheck,
    // 변경
    changeKind, openChange, closeChange, applyChange, applyInline,
    // 분류 · 비고 · 삭제
    changePackageType, noteEditing, startNote, setNoteValue, commitNote,
    classifyOpen, setClassifyOpen, submitClassify, deleteRow,
    // 엑셀 · 라벨
    excelUpload, uploadPriceExcel, uploadClassify, excelClassifyResult, setExcelClassifyResult, exportExcel,
    labelItems, setLabelItems, printLabels,
    // 상세 패널
    detailItemId, setDetailItemId, detailGroup,
  }
}

export type CoupangManagementState = ReturnType<typeof useCoupangManagement>
