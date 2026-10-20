/* ================================================================
   상품관리 (CoupangManagement) — /coupang
   - 쿠팡 Open API 동기화 기반 (2026-10-20 전면 재작성). 엑셀 업로드는 보조
   - 상태·동작은 useCoupangManagement, 데이터는 services/coupangProductService
   - 화면: 머리(제목 · 엑셀 보조) → 동기화 3단계 카드 → 필터 → 선택 작업 막대 → 목록 → 페이지
   - 목록은 상품 단위 페이지(50개 · 이전/다음), 상품은 기본 접힘 · 옵션은 옵션명 순 (2026-10-20)
   ================================================================ */

import React from 'react'
import { useCoupangManagement } from './useCoupangManagement'
import CoupangSyncCards from '../components/coupang/CoupangSyncCards'
import CoupangFilterBar from '../components/coupang/CoupangFilterBar'
import CoupangSelectionBar from '../components/coupang/CoupangSelectionBar'
import CoupangProductTable from '../components/coupang/CoupangProductTable'
import CoupangProductDetailPanel from '../components/coupang/CoupangProductDetailPanel'
import CoupangSyncModal from '../components/coupang/CoupangSyncModal'
import CoupangDetailScopeModal from '../components/coupang/CoupangDetailScopeModal'
import CoupangChangeModal from '../components/coupang/CoupangChangeModal'
import CoupangClassifyModal from '../components/coupang/CoupangClassifyModal'
import CoupangExcelResultModal from '../components/coupang/CoupangExcelResultModal'
import LabelPrintModal from '../components/label/LabelPrintModal'
import UploadProgressModal from '../components/UploadProgressModal'
import './CoupangManagement.css'

const CoupangManagement: React.FC = () => {
  const s = useCoupangManagement()

  // 파일 입력 — 같은 파일을 다시 올릴 수 있게 value 를 비운다
  const onFile = (handler: (file: File) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) handler(file)
  }

  if (!s.userId) {
    return <div className="cp-page"><div className="cp-list-empty">로그인 정보가 없습니다. 다시 로그인해 주세요.</div></div>
  }

  return (
    <div className="cp-page">
      {/* ── 머리 ── */}
      <header className="cp-header">
        <div>
          <h1 className="cp-title">일반판매자 상품</h1>
          <div className="cp-subtitle">쿠팡 상품을 한 목록에서 — 상품마다 전체(로켓 + 일반) · 일반 · 로켓그로스로 구분 · Open API 동기화 · 엑셀은 보조</div>
        </div>
        <div className="cp-header-actions">
          <label className="cp-btn cp-btn-file" title="WING 가격/재고 엑셀 (가격 · 재고 · 판매상태 · 승인상태를 한 번에 반영)">
            가격/재고 엑셀 업로드
            <input type="file" accept=".xlsx,.xls" disabled={s.busy} onChange={onFile(s.uploadPriceExcel)} />
          </label>
          <label className="cp-btn cp-btn-file" title="A 바코드 · B 분류 · C 비고 (1행 머리글)">
            분류 엑셀 업로드
            <input type="file" accept=".xlsx,.xls" disabled={s.busy} onChange={onFile(s.uploadClassify)} />
          </label>
          <button type="button" className="cp-btn" disabled={s.busy} onClick={s.exportExcel}>엑셀 내보내기</button>
        </div>
      </header>

      {/* ── 동기화 3단계 ── */}
      <CoupangSyncCards
        summary={s.syncSummary}
        busy={s.busy}
        onListSync={s.runListSync}
        onDetailSync={s.openDetailSync}
        onStatusCheck={() => s.runStatusCheck('stale')}
      />

      {/* ── 필터 ── */}
      <CoupangFilterBar
        filters={s.filters}
        counts={s.salesCounts}
        searchInput={s.searchInput}
        onChannel={s.setChannel}
        onSales={s.setSales}
        onApproval={s.setApproval}
        onSearchField={s.setSearchField}
        onSearchInput={s.setSearchInput}
        onSubmitSearch={s.submitSearch}
        onClearSearch={s.clearSearch}
      />

      {/* ── 선택 작업 ── */}
      {s.selected.size > 0 && (
        <CoupangSelectionBar
          count={s.selected.size}
          busy={s.busy}
          onChange={s.openChange}
          onStatusCheck={() => s.runStatusCheck('selected')}
          onClassify={() => s.setClassifyOpen(true)}
          onLabel={s.printLabels}
          onClear={s.clearSelection}
        />
      )}

      {/* ── 목록 ── */}
      <CoupangProductTable
        groups={s.groups}
        loading={s.loading}
        error={s.loadError}
        selected={s.selected}
        noteEditing={s.noteEditing}
        page={s.page}
        productsPerPage={s.productsPerPage}
        optionCount={s.salesCounts ? s.salesCounts[s.filters.sales] : null}
        hasPrev={s.hasPrevPage}
        hasNext={s.hasNextPage}
        onPrev={s.goPrevPage}
        onNext={s.goNextPage}
        onFirst={s.goFirstPage}
        expanded={s.expanded}
        onToggleExpand={s.toggleExpanded}
        onExpandAll={s.expandAll}
        onCollapseAll={s.collapseAll}
        onToggleOption={s.toggleOption}
        onToggleRows={s.toggleRows}
        onOpenDetail={s.setDetailItemId}
        onFetchDetail={s.runDetailForProduct}
        onPackageType={s.changePackageType}
        onStartNote={s.startNote}
        onNoteValue={s.setNoteValue}
        onCommitNote={s.commitNote}
        onDelete={s.deleteRow}
      />

      {/* ── 상세 패널 ── */}
      {s.detailGroup && (
        <CoupangProductDetailPanel
          group={s.detailGroup}
          busy={s.busy}
          onClose={() => s.setDetailItemId(null)}
          onRefetch={(itemId) => { s.setDetailItemId(null); void s.runDetailForProduct(itemId) }}
        />
      )}

      {/* ── 모달 ── */}
      {s.detailScope.open && (
        <CoupangDetailScopeModal counts={s.detailScope.counts} onConfirm={s.confirmDetailScope} onClose={s.closeDetailScope} />
      )}
      {s.progress && <CoupangSyncModal progress={s.progress} onAbort={s.abortSync} onClose={s.closeProgress} />}
      {s.changeKind && (
        <CoupangChangeModal kind={s.changeKind} rows={s.selectedRows} onApply={s.applyChange} onClose={s.closeChange} />
      )}
      {s.classifyOpen && (
        <CoupangClassifyModal count={s.selected.size} onSubmit={s.submitClassify} onClose={() => s.setClassifyOpen(false)} />
      )}
      {s.excelClassifyResult && (
        <CoupangExcelResultModal result={s.excelClassifyResult} onClose={() => s.setExcelClassifyResult(null)} />
      )}
      <LabelPrintModal open={s.labelItems !== null} items={s.labelItems ?? []} onClose={() => s.setLabelItems(null)} />
      <UploadProgressModal
        isOpen={s.excelUpload !== null}
        progress={s.excelUpload?.percent ?? 0}
        status={s.excelUpload?.status ?? ''}
        title="가격/재고 엑셀 업로드 중"
      />
    </div>
  )
}

export default CoupangManagement
