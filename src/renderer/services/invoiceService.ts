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

    // ── 좌표 + 패턴 기반 추출 ──────────────────────────────────────
    // y좌표 범위 + 패턴 매칭 조합 → 텍스트 줄바꿈/인덱스 변화에 영향받지 않음
    // 좌표는 쿠팡 송장 PDF 기준으로 검증됨 (운송장 y=579, 주문번호 y=336)

    // 운송장번호: 상단 고정 영역(y ≥ 570) + 숫자/하이픈 패턴
    //   - 예시: "6975-3574-7623"
    const trackingNo =
      items.find(
        (it) => it.y >= 570 && /^[\d-]+$/.test(it.text) && /\d{4,}/.test(it.text),
      )?.text ?? ''

    // 주문번호: 고정 영역(y 330~340) + 12자리 이상 순수 숫자
    //   - 예시: "19100184293909"
    const orderId =
      items.find(
        (it) => it.y >= 330 && it.y <= 340 && /^\d{12,}$/.test(it.text),
      )?.text ?? ''

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
// 내부 헬퍼 — 단일 페이지 PDF를 콘텐츠 영역만 크롭해서 반환
// ══════════════════════════════════════════════════════════════════

/**
 * 단일 페이지 PDF의 콘텐츠 영역을 자동 감지하여 CropBox/MediaBox 조정.
 * - 벡터 데이터는 그대로 유지 (래스터 변환 없음)
 * - 반환된 PDF는 pdf-lib PDFDocument에서 병합 가능하도록 PDFDocument 인스턴스 반환
 */
async function cropPdfToContent(arrayBuffer: ArrayBuffer): Promise<PDFDocument> {
  // ── 1) 콘텐츠 영역 감지 (저해상도 픽셀 스캔) ───────────────────
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise
  const page = await pdf.getPage(1)

  const detectScale = 2
  const detectVp = page.getViewport({ scale: detectScale })
  const canvas = document.createElement('canvas')
  canvas.width = detectVp.width
  canvas.height = detectVp.height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport: detectVp }).promise

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
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

  // ── 2) CropBox/MediaBox 변경 (벡터 품질 유지) ─────────────────
  const origPageH_pt = detectVp.height / detectScale
  const pdfLeft = minX / detectScale
  const pdfRight = (maxX + 1) / detectScale
  const pdfBottom = origPageH_pt - (maxY + 1) / detectScale
  const pdfTop = origPageH_pt - minY / detectScale

  const pdfDoc = await PDFDocument.load(arrayBuffer)
  const pdfPage = pdfDoc.getPage(0)
  pdfPage.setCropBox(pdfLeft, pdfBottom, pdfRight - pdfLeft, pdfTop - pdfBottom)
  pdfPage.setMediaBox(pdfLeft, pdfBottom, pdfRight - pdfLeft, pdfTop - pdfBottom)

  return pdfDoc
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
