// ═══════════════════════════════════════════════════════════════════
// ExcelDropZone — 엑셀 파일 고르기 (클릭 · 키보드 · 끌어놓기)
//   - label 안의 input 이라 영역 어디를 눌러도 파일 창이 열린다
//   - 확장자 확인 · 읽기 오류 표시는 부모(useStockExcelImport)가 한다
// ═══════════════════════════════════════════════════════════════════

import React, { useState } from 'react'

// ── 상수 ──────────────────────────────────────────────────────────
const ACCEPT = '.xlsx,.xls'
const BYTES_PER_KB = 1024

/** 파일 크기 → 12.3 KB / 1.2 MB */
const formatSize = (bytes: number) => {
  const kb = bytes / BYTES_PER_KB
  if (kb < BYTES_PER_KB) return `${Math.max(kb, 0.1).toFixed(1)} KB`
  return `${(kb / BYTES_PER_KB).toFixed(1)} MB`
}

interface ExcelDropZoneProps {
  fileName: string | null
  fileSize: number | null
  reading: boolean
  disabled: boolean
  onFile: (file: File) => void
}

const ExcelDropZone: React.FC<ExcelDropZoneProps> = ({ fileName, fileSize, reading, disabled, onFile }) => {
  const [dragOver, setDragOver] = useState(false)
  const blocked = disabled || reading

  const pick = (files: FileList | null) => {
    const file = files?.[0]
    if (file) onFile(file)
  }

  const className = [
    'sxi-drop',
    dragOver ? 'is-over' : '',
    fileName ? 'has-file' : '',
    blocked ? 'is-disabled' : '',
  ].filter(Boolean).join(' ')

  return (
    <label
      className={className}
      onDragOver={e => { e.preventDefault(); if (!blocked) setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault()
        setDragOver(false)
        if (!blocked) pick(e.dataTransfer.files)
      }}
    >
      {/* 화면에서는 숨기되 키보드 포커스는 받도록 (display:none 이 아님) */}
      <input
        className="sxi-drop-input"
        type="file"
        accept={ACCEPT}
        disabled={blocked}
        onChange={e => {
          pick(e.target.files)
          e.target.value = ''   // 같은 파일 다시 고르기 허용
        }}
      />
      {reading ? (
        <div className="sxi-drop-title">엑셀 읽는 중…</div>
      ) : fileName ? (
        <>
          <div className="sxi-drop-title">
            {fileName}
            {fileSize !== null && <span className="sxi-drop-size">{formatSize(fileSize)}</span>}
          </div>
          <div className="sxi-drop-hint">다른 파일을 고르려면 클릭하거나 끌어놓으세요</div>
        </>
      ) : (
        <>
          <div className="sxi-drop-title">엑셀 파일을 끌어놓거나 클릭해서 고르세요</div>
          <div className="sxi-drop-hint">.xlsx · .xls — 위치 · 바코드 · 수량 열이 있으면 됩니다 (열 순서 무관)</div>
        </>
      )}
    </label>
  )
}

export default ExcelDropZone
