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
import { toLabelPrintItems } from '../services/labelService'
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
export const PAGE_SIZE = 100               // 한 페이지 옵션 행 수
const STATUS_CHECK_STALE_BATCH = 500       // [오래된 순 확인] 한 번에 확인할 옵션 수 (≈ 100초)

const DEFAULT_FILTERS: CoupangProductFilters = {
  channel: 'all',
  sales: 'on',
  approval: 'all',
  searchField: 'name',
  search: '',
}

/** 상세 동기화 범위 */
export type DetailSyncScope = 'missingOnSale' | 'missingAll'

export function useCoupangManagement() {
  const userId = useMemo(() => getCurrentUserId(), [])

  // ── 조회 상태 ──
  const [filters, setFilters] = useState<CoupangProductFilters>(DEFAULT_FILTERS)
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<CoupangProductRow[]>([])
  const [total, setTotal] = useState(0)
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
  const [detailScope, setDetailScope] = useState<{ open: boolean; counts: DetailMissingIds | null }>({ open: false, counts: null })

  // ── 모달 · 패널 ──
  const [detailItemId, setDetailItemId] = useState<string | null>(null)
  const [changeKind, setChangeKind] = useState<ChangeKind | null>(null)
  const [classifyOpen, setClassifyOpen] = useState(false)
  const [excelClassifyResult, setExcelClassifyResult] = useState<ClassifyExcelResult | null>(null)
  const [labelItems, setLabelItems] = useState<LabelPrintItem[] | null>(null)
  const [excelUpload, setExcelUpload] = useState<{ percent: number; status: string } | null>(null)
  const [noteEditing, setNoteEditing] = useState<{ optionId: string; value: string } | null>(null)

  const busy = !!progress?.running || !!excelUpload

  // ══════════════════════════════════════════════════════════════
  // 조회
  // ══════════════════════════════════════════════════════════════

  // 페이지 → 상품 요약 → 판매상태 건수 → 머리 카드 요약, 순서대로.
  //   큰 계정(7.8만 행)에서 count 쿼리를 한꺼번에 보내면 Supabase statement timeout 이 난다 (2026-10-20 실측)
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    ;(async () => {
      try {
        const pageResult = await fetchProductPage(userId, filters, page, PAGE_SIZE)
        if (cancelled) return
        setRows(pageResult.rows)
        setTotal(pageResult.total)
        setLoading(false)

        const itemIds = [...new Set(pageResult.rows.map((r) => r.item_id).filter((v): v is string => !!v))]
        const sums = await fetchProductSummaries(userId, itemIds)
        if (cancelled) return
        setSummaries(sums)

        const counts = await fetchSalesCounts(userId, filters)
        if (cancelled) return
        setSalesCounts(counts)

        const summary = await fetchSyncSummary(userId)
        if (!cancelled) setSyncSummary(summary)
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : '조회 실패')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [userId, filters, page, reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  // ── 상품 묶음 (행 순서 유지) ──
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
    return out
  }, [rows, summaries])

  // ── 필터 ──
  const setChannel = useCallback((channel: ChannelFilter) => { setFilters((f) => ({ ...f, channel })); setPage(1) }, [])
  const setSales = useCallback((sales: SalesFilter) => { setFilters((f) => ({ ...f, sales })); setPage(1) }, [])
  const setApproval = useCallback((approval: ApprovalFilter) => { setFilters((f) => ({ ...f, approval })); setPage(1) }, [])
  const setSearchField = useCallback((searchField: SearchField) => setFilters((f) => ({ ...f, searchField })), [])
  const submitSearch = useCallback(() => { setFilters((f) => ({ ...f, search: searchInput.trim() })); setPage(1) }, [searchInput])
  const clearSearch = useCallback(() => { setSearchInput(''); setFilters((f) => ({ ...f, search: '' })); setPage(1) }, [])

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

  const startProgress = useCallback((kind: SyncProgress['kind'], title: string, message: string): AbortController => {
    const controller = new AbortController()
    abortRef.current = controller
    setProgress({ kind, title, running: true, done: 0, total: 0, message, errors: [], result: null })
    return controller
  }, [])

  const updateProgress = useCallback((patch: Partial<SyncProgress>) => {
    setProgress((p) => (p ? { ...p, ...patch } : p))
  }, [])

  const finishProgress = useCallback((result: string, errors: string[] = []) => {
    abortRef.current = null
    setProgress((p) => (p ? { ...p, running: false, result, errors: [...p.errors, ...errors] } : p))
    reload()
  }, [reload])

  const abortSync = useCallback(() => {
    abortRef.current?.abort()
    updateProgress({ message: '중단하는 중… (진행 중인 요청은 끝까지 기다립니다)' })
  }, [updateProgress])

  const closeProgress = useCallback(() => { if (!progress?.running) setProgress(null) }, [progress])

  // ── 1) 목록 동기화 → 새 상품은 바로 상세까지 ──
  const runListSync = useCallback(async () => {
    if (!userId || busy) return
    const controller = startProgress('list', '상품 목록 동기화', '시작…')
    try {
      const result = await syncProductList(userId, (message) => updateProgress({ message }))
      const newProducts = [...new Set([...result.needDetail, ...result.newRgProducts])]
      let detailLine = ''
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
      finishProgress('실패', [err instanceof Error ? err.message : String(err)])
    }
  }, [userId, busy, startProgress, updateProgress, finishProgress])

  // ── 2) 상세 동기화 — 범위 선택 모달 → 실행 ──
  const openDetailSync = useCallback(async () => {
    if (!userId || busy) return
    setDetailScope({ open: true, counts: null })
    try {
      const counts = await fetchDetailMissingProductIds(userId)
      setDetailScope((s) => (s.open ? { open: true, counts } : s))
    } catch (err) {
      console.error('[openDetailSync] 대상 조회 실패:', err)
      setDetailScope({ open: false, counts: null })
    }
  }, [userId, busy])

  const closeDetailScope = useCallback(() => setDetailScope({ open: false, counts: null }), [])

  const runDetailSync = useCallback(async (ids: string[], title = '상세 받기') => {
    if (!userId || busy || ids.length === 0) return
    const controller = startProgress('detail', title, `상품 ${ids.length.toLocaleString()}개의 옵션·가격·재고·이미지를 받습니다`)
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
  }, [userId, busy, startProgress, updateProgress, finishProgress])

  const confirmDetailScope = useCallback((scope: DetailSyncScope) => {
    const counts = detailScope.counts
    setDetailScope({ open: false, counts: null })
    if (!counts) return
    void runDetailSync(scope === 'missingOnSale' ? counts.onSale : counts.all)
  }, [detailScope.counts, runDetailSync])

  const runDetailForProduct = useCallback((itemId: string) => runDetailSync([itemId], '이 상품 다시 받기'), [runDetailSync])

  // ── 3) 판매상태 확인 ──
  const runStatusCheck = useCallback(async (target: 'selected' | 'page' | 'stale') => {
    if (!userId || busy) return
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
  }, [userId, busy, selectedRows, rows, startProgress, updateProgress, finishProgress])

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

  // ══════════════════════════════════════════════════════════════
  // 분류 · 비고 · 삭제
  // ══════════════════════════════════════════════════════════════

  const patchRow = useCallback((optionId: string, patch: Partial<CoupangProductRow>) => {
    setRows((prev) => prev.map((r) => (r.option_id === optionId ? { ...r, ...patch } : r)))
  }, [])

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

  const printLabels = useCallback(() => {
    const { items, skipped } = toLabelPrintItems(selectedRows)
    if (items.length === 0) { alert('선택한 항목에 바코드가 없어 라벨을 출력할 수 없습니다.'); return }
    if (skipped > 0) alert(`바코드가 없는 ${skipped}개 항목은 제외하고 ${items.length}개만 출력합니다.`)
    setLabelItems(items)
  }, [selectedRows])

  // ══════════════════════════════════════════════════════════════
  // 상세 패널
  // ══════════════════════════════════════════════════════════════

  const detailGroup = useMemo(() => groups.find((g) => g.itemId === detailItemId) ?? null, [groups, detailItemId])

  return {
    userId,
    // 조회
    filters, searchInput, setSearchInput, setChannel, setSales, setApproval, setSearchField, submitSearch, clearSearch,
    page, setPage, pageSize: PAGE_SIZE, total, rows, groups, loading, loadError, salesCounts, syncSummary, reload,
    // 선택
    selected, selectedRows, toggleOption, toggleRows, clearSelection,
    // 동기화
    busy, progress, abortSync, closeProgress,
    runListSync, openDetailSync, detailScope, closeDetailScope, confirmDetailScope, runDetailForProduct, runStatusCheck,
    // 변경
    changeKind, openChange, closeChange, applyChange,
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
