/* ================================================================
   송장(Invoice) PDF 서비스
   - PDF 파싱: 페이지별 주문번호 추출 (pdfjs-dist)
   - PDF 분리/업로드: 페이지별 분리 후 Supabase Storage 저장 (pdf-lib)
   - 송장 인쇄: Storage에서 다운로드 → 콘텐츠 크롭 → 브라우저 인쇄
   ================================================================ */

import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument } from 'pdf-lib'
import { supabase } from './supabase'

// ── pdf.js 워커 설정 ─────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString()

// ── 상수 ─────────────────────────────────────────────────────────
const STORAGE_BUCKET = 'personal-order-invoices'

// ── 타입 ─────────────────────────────────────────────────────────
export interface ParsedInvoicePage {
  pageIndex: number       // 0-based 페이지 번호
  trackingNo: string      // 운송장번호
  orderId: string         // 주문번호
}

export interface UploadResult {
  success: number
  failed: number
  errors: string[]
}

// ══════════════════════════════════════════════════════════════════
// PDF 파싱 — 페이지별 운송장번호/주문번호 추출
// ══════════════════════════════════════════════════════════════════

export async function parsePdfInvoices(file: File): Promise<ParsedInvoicePage[]> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const results: ParsedInvoicePage[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()

    // 텍스트 아이템을 y좌표(내림차순) → x좌표(오름차순) 정렬
    const items = textContent.items
      .filter((item: any) => item.str && item.str.trim())
      .map((item: any) => ({
        text: item.str.trim(),
        x: Math.round(item.transform[4]),
        y: Math.round(item.transform[5]),
      }))
      .sort((a, b) => b.y - a.y || a.x - b.x)

    // ── 패턴 기반 추출 ───────────────────────────────────────────
    // 좌표 기반 방식은 PDF 양식 변경 시 실패 → 패턴만으로 판정 (충돌 없음)
    //   운송장번호: "6972-9673-7162" 형태 (하이픈 포함 숫자)
    //   주문번호:   "19100184293909" 12자리 이상 순수 숫자
    //   두 패턴은 서로 매칭되지 않음 (하이픈 유무로 구분)

    const trackingNo =
      items.find(
        (it) => /^[\d-]+$/.test(it.text) && /-/.test(it.text) && /\d{4,}/.test(it.text),
      )?.text ?? ''

    const orderId =
      items.find((it) => /^\d{12,}$/.test(it.text))?.text ?? ''

    // 디버그 로그 — 추출 결과 + 전체 텍스트 아이템 (매칭 실패 시 확인용)
    console.log(`[invoiceService] 페이지 ${i}:`, {
      운송장번호: trackingNo,
      주문번호: orderId,
      전체아이템: items.map((it, idx) => `[${idx}] y=${it.y} "${it.text}"`),
    })

    if (orderId) {
      results.push({ pageIndex: i - 1, trackingNo, orderId })
    } else {
      console.warn(`[invoiceService] 페이지 ${i}: 주문번호 추출 실패`)
    }
  }

  return results
}

// ══════════════════════════════════════════════════════════════════
// PDF 분리 + Supabase Storage 업로드
// ══════════════════════════════════════════════════════════════════

export async function splitAndUploadPages(
  file: File,
  pages: ParsedInvoicePage[],
  userId: string,
): Promise<UploadResult> {
  const arrayBuffer = await file.arrayBuffer()
  const srcDoc = await PDFDocument.load(arrayBuffer)

  let success = 0
  let failed = 0
  const errors: string[] = []

  for (const page of pages) {
    try {
      // 원본에서 해당 페이지만 분리하여 새 PDF 생성
      const newDoc = await PDFDocument.create()
      const [copiedPage] = await newDoc.copyPages(srcDoc, [page.pageIndex])
      newDoc.addPage(copiedPage)
      const pdfBytes = await newDoc.save()

      // Storage 업로드 (동일 주문번호면 덮어쓰기)
      const filePath = `${userId}/${page.orderId}.pdf`
      const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, pdfBytes, {
          contentType: 'application/pdf',
          upsert: true,
        })

      if (error) {
        console.error(`[invoiceService] 업로드 실패 (${page.orderId}):`, error)
        errors.push(`${page.orderId}: ${error.message}`)
        failed++
      } else {
        success++
      }
    } catch (err: any) {
      console.error(`[invoiceService] 페이지 분리 실패 (${page.orderId}):`, err)
      errors.push(`${page.orderId}: ${err.message}`)
      failed++
    }
  }

  return { success, failed, errors }
}

// ══════════════════════════════════════════════════════════════════
// 송장 파일 목록 일괄 조회 — Set<orderId> 반환
// - 사용자의 Storage 폴더({userId}/)에 저장된 *.pdf 파일명에서 order_id 추출
// - Supabase Storage list() 최대 1000건/회 → offset 페이지네이션 루프
// ══════════════════════════════════════════════════════════════════

export async function fetchInvoiceOrderIds(userId: string): Promise<Set<string>> {
  const result = new Set<string>()
  if (!userId) return result

  const limit = 1000
  let offset = 0

  while (true) {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .list(userId, { limit, offset })

    if (error) {
      console.error('[fetchInvoiceOrderIds] 조회 오류:', error)
      break
    }
    if (!data || data.length === 0) break

    for (const file of data) {
      const m = file.name.match(/^(.+)\.pdf$/i)
      if (m) result.add(m[1])
    }

    if (data.length < limit) break
    offset += limit
  }

  console.log(`[fetchInvoiceOrderIds] ${result.size}건의 송장 파일 확인`)
  return result
}

// ══════════════════════════════════════════════════════════════════
// 송장 일괄 삭제 — order_id 배열 기반
// - Supabase Storage remove() 은 paths 배열 한 번에 최대 1000건 권장
// - 존재하지 않는 파일은 Supabase 가 무시 (error 아님)
// ══════════════════════════════════════════════════════════════════

const REMOVE_BATCH_SIZE = 1000

export async function deleteInvoicesByOrderIds(
  userId: string,
  orderIds: string[],
): Promise<{ deleted: number; errors: string[] }> {
  if (!userId || orderIds.length === 0) return { deleted: 0, errors: [] }

  const paths = orderIds.map((id) => `${userId}/${id}.pdf`)
  let deleted = 0
  const errors: string[] = []

  for (let i = 0; i < paths.length; i += REMOVE_BATCH_SIZE) {
    const batch = paths.slice(i, i + REMOVE_BATCH_SIZE)
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).remove(batch)
    if (error) {
      console.error(`[deleteInvoicesByOrderIds] 삭제 오류 (batch ${i / REMOVE_BATCH_SIZE + 1}):`, error)
      errors.push(error.message)
      continue
    }
    deleted += data?.length ?? 0
  }

  console.log(`[deleteInvoicesByOrderIds] ${deleted}/${orderIds.length}건 삭제 완료`)
  return { deleted, errors }
}

// ══════════════════════════════════════════════════════════════════
// 송장 존재 여부 확인 (단일)
// ══════════════════════════════════════════════════════════════════

export async function checkInvoiceExists(
  userId: string,
  orderId: string,
): Promise<boolean> {
  const filePath = `${userId}/${orderId}.pdf`
  const { data } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list(userId, { search: `${orderId}.pdf` })

  return (data ?? []).some((f) => f.name === `${orderId}.pdf`)
}

// ══════════════════════════════════════════════════════════════════
// 송장 PDF 다운로드
// ══════════════════════════════════════════════════════════════════

async function downloadInvoicePdf(
  userId: string,
  orderId: string,
): Promise<ArrayBuffer | null> {
  const filePath = `${userId}/${orderId}.pdf`
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(filePath)

  if (error || !data) {
    console.error(`[invoiceService] 다운로드 실패 (${orderId}):`, error)
    return null
  }

  return data.arrayBuffer()
}

// ══════════════════════════════════════════════════════════════════
// 내부 헬퍼 — PDF 콘텐츠 영역을 100x150mm 라벨 페이지로 재구성
// ══════════════════════════════════════════════════════════════════

// mm → pt 변환 (1mm = 2.834645669pt)
const MM_TO_PT = 2.834645669
const LABEL_W_PT = 100 * MM_TO_PT  // 283.46pt
const LABEL_H_PT = 150 * MM_TO_PT  // 425.20pt

/**
 * 입력 PDF의 콘텐츠 영역만 남도록 **원본 PDF에 회전-인지 CropBox 설정**하여 반환.
 *
 * 핵심:
 *   - 벡터 원본 그대로 유지 (래스터 변환 없음 → 선명도 완벽 보존)
 *   - /Rotate 메타데이터 그대로 보존 → 브라우저 PDF 뷰어가 알아서 회전 적용
 *   - pdf.js 캔버스 픽셀 스캔은 표시 좌표계이므로 저장 좌표계로 역변환하여 CropBox 설정
 *
 * /Rotate → display 변환 공식:
 *   0:   stored = display
 *   90:  stored.x = W - display.y,    stored.y = display.x
 *   180: stored.x = W - display.x,    stored.y = H - display.y
 *   270: stored.x = display.y,        stored.y = H - display.x
 *   (W = 저장 페이지 너비, H = 저장 페이지 높이)
 *
 * 출력 PDF 크기는 콘텐츠 크기 그대로. 프린터에서 "용지에 맞춤"으로 100x150mm 라벨에 꽉 차게 인쇄됨.
 */
async function cropPdfToContent(arrayBuffer: ArrayBuffer): Promise<PDFDocument> {
  // ── 1) 콘텐츠 영역 감지 (저해상도 픽셀 스캔) ───────────────────
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise
  const page = await pdf.getPage(1)
  const rotation = (page.rotate ?? 0) as 0 | 90 | 180 | 270

  const detectScale = 2
  const detectVp = page.getViewport({ scale: detectScale })
  const detectCanvas = document.createElement('canvas')
  detectCanvas.width = detectVp.width
  detectCanvas.height = detectVp.height
  const detectCtx = detectCanvas.getContext('2d')!
  detectCtx.fillStyle = '#ffffff'
  detectCtx.fillRect(0, 0, detectCanvas.width, detectCanvas.height)
  await page.render({ canvasContext: detectCtx, viewport: detectVp }).promise

  const imageData = detectCtx.getImageData(0, 0, detectCanvas.width, detectCanvas.height)
  const { data, width, height } = imageData
  let minX = width, minY = height, maxX = 0, maxY = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      if (data[idx] < 245 || data[idx + 1] < 245 || data[idx + 2] < 245) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  // 여백 추가
  const pad = 5
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(width - 1, maxX + pad)
  maxY = Math.min(height - 1, maxY + pad)

  // ── 2) 캔버스 좌표 → 표시(display) PDF 좌표 (Y up) ────────────
  const dispH_pt = detectVp.height / detectScale
  const dispLeft = minX / detectScale
  const dispRight = (maxX + 1) / detectScale
  const dispPdfTop = dispH_pt - minY / detectScale
  const dispPdfBottom = dispH_pt - (maxY + 1) / detectScale
  const cropW_disp = dispRight - dispLeft
  const cropH_disp = dispPdfTop - dispPdfBottom

  // ── 3) 저장(stored) 좌표계로 역변환 (/Rotate 적용) ────────────
  const srcDoc = await PDFDocument.load(arrayBuffer)
  const srcPage = srcDoc.getPage(0)
  const mb = srcPage.getMediaBox()
  const storedPageW = mb.width
  const storedPageH = mb.height

  let storedX: number, storedY: number, storedW: number, storedH: number
  switch (rotation) {
    case 90:
      storedX = storedPageW - dispPdfTop
      storedY = dispLeft
      storedW = cropH_disp
      storedH = cropW_disp
      break
    case 180:
      storedX = storedPageW - dispRight
      storedY = storedPageH - dispPdfTop
      storedW = cropW_disp
      storedH = cropH_disp
      break
    case 270:
      storedX = dispPdfBottom
      storedY = storedPageH - dispRight
      storedW = cropH_disp
      storedH = cropW_disp
      break
    case 0:
    default:
      storedX = dispLeft
      storedY = dispPdfBottom
      storedW = cropW_disp
      storedH = cropH_disp
      break
  }

  // ── 4) CropBox + MediaBox 설정 (원본 /Rotate 그대로 보존) ─────
  srcPage.setCropBox(storedX, storedY, storedW, storedH)
  srcPage.setMediaBox(storedX, storedY, storedW, storedH)
  return srcDoc
}

// ══════════════════════════════════════════════════════════════════
// 송장 인쇄 — 단일 주문
// ══════════════════════════════════════════════════════════════════

export async function printInvoice(
  userId: string,
  orderId: string,
): Promise<void> {
  const arrayBuffer = await downloadInvoicePdf(userId, orderId)
  if (!arrayBuffer) {
    alert('송장 PDF를 찾을 수 없습니다.')
    return
  }

  const croppedDoc = await cropPdfToContent(arrayBuffer)
  const bytes = await croppedDoc.save()
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const blobUrl = URL.createObjectURL(blob)
  window.open(blobUrl, '_blank')
}

// ══════════════════════════════════════════════════════════════════
// 송장 일괄 인쇄 — 다중 주문을 하나의 PDF로 병합
// ══════════════════════════════════════════════════════════════════

export interface PrintMultipleResult {
  success: number       // 인쇄 PDF에 포함된 건수
  missing: string[]     // Storage에 송장이 없는 주문번호
  failed: string[]      // 크롭/병합 중 오류난 주문번호
}

export async function printMultipleInvoices(
  userId: string,
  orderIds: string[],
): Promise<PrintMultipleResult> {
  const missing: string[] = []
  const failed: string[] = []

  // ── 1) 병합용 빈 PDFDocument 생성 ───────────────────────────
  const mergedDoc = await PDFDocument.create()

  // ── 2) 주문별로 다운로드 → 크롭 → 병합 ────────────────────
  for (const orderId of orderIds) {
    const arrayBuffer = await downloadInvoicePdf(userId, orderId)
    if (!arrayBuffer) {
      missing.push(orderId)
      continue
    }

    try {
      const croppedDoc = await cropPdfToContent(arrayBuffer)
      const [copiedPage] = await mergedDoc.copyPages(croppedDoc, [0])
      mergedDoc.addPage(copiedPage)
    } catch (err: any) {
      console.error(`[invoiceService] 송장 처리 실패 (${orderId}):`, err)
      failed.push(orderId)
    }
  }

  const success = mergedDoc.getPageCount()

  // ── 3) 병합된 PDF가 없으면 창 열지 않음 ─────────────────────
  if (success === 0) {
    return { success: 0, missing, failed }
  }

  // ── 4) 새 창에서 열기 (브라우저 PDF 뷰어 → 인쇄) ────────────
  const mergedBytes = await mergedDoc.save()
  const blob = new Blob([mergedBytes], { type: 'application/pdf' })
  const blobUrl = URL.createObjectURL(blob)
  window.open(blobUrl, '_blank')

  return { success, missing, failed }
}
