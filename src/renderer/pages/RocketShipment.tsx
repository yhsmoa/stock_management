/* ================================================================
   로켓그로스 출고 (RocketShipment) — 렌더링 컴포넌트
   - 상단(우측): [xlsx 등록] [그로스 입고 xlsx 생성]
   - 테이블 좌상단: Small/Medium/Large 사이즈 탭 (쿠팡사이즈 필터)
   - 체크박스로 선택 → 현재 탭 체크 행만 그로스 입고 xlsx 생성
   - 위치(박스번호)-쿠팡사이즈 불일치 행은 빨간 폰트
   - 로직은 useRocketShipment 훅에서 관리
   ================================================================ */

import React from 'react'
import './RocketShipment.css'
import { useRocketShipment, COLUMNS } from './useRocketShipment'
import { SIZES, isSizeMismatch } from '../services/rocketShipmentService'

const RocketShipment: React.FC = () => {
  const {
    rows,
    filtered,
    loading,
    error,
    fileName,
    fileInputRef,
    handleXlsxUpload,
    tab,
    changeTab,
    tabCounts,
    selected,
    isAllSelected,
    handleSelectAll,
    handleSelectRow,
    generating,
    handleGenerate,
  } = useRocketShipment()

  const hasData = rows.length > 0

  return (
    <div className="rs-container">
      {/* ── 상단(우측): xlsx 등록 · 그로스 입고 xlsx 생성 ──────── */}
      <div className="rs-top-actions">
        <label className={`rs-btn${loading ? ' rs-btn-disabled' : ''}`}>
          {loading ? '등록 중...' : 'xlsx 등록'}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            disabled={loading}
            onChange={handleXlsxUpload}
          />
        </label>
        <button
          className="rs-btn rs-btn-primary"
          onClick={handleGenerate}
          disabled={!hasData || generating}
          title="현재 탭에서 체크된 행만 그로스 입고 양식으로 생성"
        >
          {generating ? '생성 중...' : '그로스 입고 xlsx 생성'}
        </button>
      </div>

      {/* ── 타이틀 ────────────────────────────────────────────── */}
      <div className="rs-header">
        <h2 className="rs-title">로켓그로스 출고</h2>
      </div>

      {/* ── 툴바: 좌 사이즈 탭 | 우 카운트/에러 ─────────────────── */}
      <div className="rs-table-toolbar">
        <div className="rs-tabs">
          {SIZES.map((sz) => (
            <button
              key={sz}
              className={`rs-tab${tab === sz ? ' active' : ''}`}
              onClick={() => changeTab(sz)}
            >
              {sz} ({tabCounts[sz]})
            </button>
          ))}
        </div>
        <div className="rs-toolbar-right">
          {error && <span className="rs-error">{error}</span>}
          <span className="rs-filter-count">
            {fileName ? `${fileName} · ` : ''}선택 {selected.size} / 표시 {filtered.length}건
          </span>
        </div>
      </div>

      {/* ── 테이블 ────────────────────────────────────────────── */}
      <div className="rs-table-section">
        <div className="rs-table-wrapper">
          <table className="rs-table">
            <colgroup>
              <col style={{ width: '30px' }} />
              {COLUMNS.map((col) => (
                <col key={col.key} style={{ width: col.width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="col-checkbox">
                  <input
                    type="checkbox"
                    className="rs-checkbox"
                    checked={isAllSelected}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                  />
                </th>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={col.key === 'itemName' ? 'col-product' : ''}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="rs-loading">
                    엑셀을 읽는 중...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="rs-table-empty">
                    {hasData
                      ? `${tab} 사이즈 데이터가 없습니다.`
                      : '[xlsx 등록] 버튼으로 출고준비 파일을 등록하세요.'}
                  </td>
                </tr>
              ) : (
                filtered.map(({ row, idx }) => {
                  const mismatch = isSizeMismatch(row)
                  return (
                    <tr key={`${idx}`} className={mismatch ? 'rs-row-mismatch' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          className="rs-checkbox"
                          checked={selected.has(idx)}
                          onChange={(e) => handleSelectRow(idx, e.target.checked)}
                        />
                      </td>
                      {COLUMNS.map((col) => {
                        const value = row[col.key]
                        const display =
                          col.key === 'quantity'
                            ? (value ? Number(value).toLocaleString() : '')
                            : String(value ?? '')
                        return (
                          <td
                            key={col.key}
                            className={col.key === 'itemName' ? 'col-product' : ''}
                            title={display}
                          >
                            {display}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default RocketShipment
