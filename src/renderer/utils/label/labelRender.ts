// ============================================================
// 라벨 래스터 엔진 — 요소 1개 → "프린터 도트 해상도" 캔버스
//
// 이 파일이 미리보기와 인쇄의 공통 진실이다.
//   · 미리보기(LabelCanvas)  : 여기서 만든 캔버스를 화면에 확대해 그린다
//   · 인쇄(utils/label/tspl.ts)      : 여기서 만든 캔버스를 1-bit 로 패킹해 BITMAP 으로 보낸다
//   → 화면에서 본 것이 곧 인쇄물이다.
//
// 좌표/크기는 전부 dots(프린터 좌표계). mm ↔ dots 변환은 이 파일의 헬퍼로만 한다.
//
// ⚠️ 브라우저 전용 (canvas 필요). SSR 에서는 전부 null 을 돌려준다.
// ============================================================

import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { careSymbolDataUrl } from './careSymbols';
import type {
  LabelElement,
  TextElement,
  BarcodeElement,
  QrElement,
  ImageElement,
  LabelData,
  LabelTemplate,
  Rotation,
  Symbology,
  TextAlign,
  TextVAlign,
} from './labelTypes';
import {
  resolveElementText,
  fontStack,
  isTextBox,
  DEFAULT_FONT,
  DEFAULT_MIN_PT,
  DEFAULT_LINE_GAP,
  SHRINK_STEP_PT,
} from './labelTypes';

// ============================================================
// 단위 변환
// ============================================================

/** mm → dots (프린터 해상도 기준) */
export function mmToDots(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / 25.4);
}

/** pt → dots (1pt = 1/72 inch) */
export function ptToDots(pt: number, dpi: number): number {
  return Math.round((pt / 72) * dpi);
}

/** dots → mm */
export function dotsToMm(dots: number, dpi: number): number {
  return (dots * 25.4) / dpi;
}

// ============================================================
// 캔버스 유틸
// ============================================================

function canBrowser(): boolean {
  return typeof document !== 'undefined';
}

function newCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (!canBrowser()) return null;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

let measureCanvas: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!canBrowser()) return null;
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas').getContext('2d');
  }
  return measureCanvas;
}

function fontOf(el: Pick<TextElement, 'bold' | 'italic' | 'font_family'>, fontPx: number): string {
  const style = el.italic ? 'italic ' : '';
  const weight = el.bold ? 'bold ' : '';
  return `${style}${weight}${fontPx}px ${fontStack(el.font_family || DEFAULT_FONT)}`;
}

/** 글꼴이 이 PC 에 실제로 설치돼 있는지 (편집기 경고용) */
export function isFontAvailable(family: string): boolean {
  if (!canBrowser() || typeof document.fonts?.check !== 'function') return true;
  try {
    return document.fonts.check(`12px "${family}"`);
  } catch {
    return true;
  }
}

/** 캔버스를 시계방향으로 회전한 새 캔버스 */
function rotateCanvas(src: HTMLCanvasElement, rotate: Rotation): HTMLCanvasElement {
  if (!rotate) return src;
  const swap = rotate === 90 || rotate === 270;
  const out = newCanvas(swap ? src.height : src.width, swap ? src.width : src.height);
  if (!out) return src;
  const ctx = out.getContext('2d');
  if (!ctx) return src;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.save();
  switch (rotate) {
    case 90:
      ctx.translate(out.width, 0);
      break;
    case 180:
      ctx.translate(out.width, out.height);
      break;
    case 270:
      ctx.translate(0, out.height);
      break;
  }
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(src, 0, 0);
  ctx.restore();
  return out;
}

// ============================================================
// 텍스트 측정 / 줄바꿈
//   letter-spacing 은 브라우저 canvas 표준 지원이 고르지 않아
//   글자 단위로 직접 그린다 → 측정도 같은 방식이어야 한다.
// ============================================================

function measureLine(ctx: CanvasRenderingContext2D, text: string, lsPx: number): number {
  if (!lsPx) return ctx.measureText(text).width;
  let w = 0;
  const chars = Array.from(text);
  for (const ch of chars) w += ctx.measureText(ch).width + lsPx;
  return Math.max(0, w - lsPx);
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  lsPx: number
): void {
  if (!lsPx) {
    ctx.fillText(text, x, y);
    return;
  }
  let cx = x;
  for (const ch of Array.from(text)) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + lsPx;
  }
}

/**
 * 자동 줄바꿈 — 인쇄와 미리보기가 "같은 줄 나눔"을 쓰도록 공용으로 노출한다.
 *
 * 단위는 dots(프린터 좌표계).
 * 한글은 어절 단위로 끊되, 한 어절이 폭을 넘으면 글자 단위로 쪼갠다.
 * 원문의 개행(\n)은 강제 줄바꿈으로 존중한다.
 */
export function wrapTextLines(
  text: string,
  font: string,
  maxWidthPx: number,
  maxLines?: number,
  letterSpacingPx = 0
): string[] {
  const ctx = getMeasureCtx();
  if (!ctx || !text) return text ? [text] : [];
  ctx.font = font;

  const width = (s: string) => measureLine(ctx, s, letterSpacingPx);
  const lines: string[] = [];

  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    let current = '';
    const flush = () => {
      if (current) lines.push(current);
      current = '';
    };

    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (width(candidate) <= maxWidthPx) {
        current = candidate;
        continue;
      }
      flush();
      if (width(word) <= maxWidthPx) {
        current = word;
        continue;
      }
      // 어절 하나가 폭을 넘으면 글자 단위로 분해
      let chunk = '';
      for (const ch of word) {
        if (width(chunk + ch) > maxWidthPx && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      current = chunk;
    }
    flush();
  }

  return maxLines && maxLines > 0 ? lines.slice(0, maxLines) : lines;
}

/**
 * 텍스트 요소의 기준 블록 폭 (dots).
 * max_w_mm 미지정 시 라벨 가장자리까지 — 회전 방향에 맞는 변을 쓴다.
 */
export function textBlockWidthDots(el: TextElement, tpl: LabelTemplate): number {
  if (el.max_w_mm) return Math.max(1, mmToDots(el.max_w_mm, tpl.dpi));
  const vertical = el.rotate === 90 || el.rotate === 270;
  const avail = vertical ? tpl.height_mm - el.y_mm : tpl.width_mm - el.x_mm;
  return Math.max(1, mmToDots(Math.max(1, avail), tpl.dpi));
}

// ============================================================
// 래스터 결과 + 캐시
//
// 드래그 중에도 매 프레임 재계산되므로 캐시가 없으면 QR/바코드에서 버벅인다.
// ============================================================

export interface Raster {
  canvas: HTMLCanvasElement;
  /** 회전까지 반영된 최종 크기 (dots) */
  wDots: number;
  hDots: number;
  /** 렌더 실패 사유 (바코드 규격 위반 등). 있으면 자리표시자를 그린 것 */
  error?: string;
  /** 텍스트 영역 모드의 결과 요약 — 속성 패널 안내와 경고에 쓴다 */
  text?: TextFitInfo;
}

export interface TextFitInfo {
  /** 실제 사용된 글자 크기 (자동 축소 반영) */
  usedPt: number;
  /** 줄바꿈 결과 총 줄 수 */
  totalLines: number;
  /** 영역 높이에 들어가는 줄 수 */
  fitLines: number;
  /** 잘려 나간 줄 수 (0 이면 전부 표시) */
  clippedLines: number;
}

const rasterCache = new Map<string, Raster>();
const CACHE_MAX = 400;

function cached(key: string, make: () => Raster | null): Raster | null {
  const hit = rasterCache.get(key);
  if (hit) return hit;
  const made = make();
  if (!made) return null;
  if (rasterCache.size >= CACHE_MAX) {
    // 가장 오래된 항목부터 정리 (Map 은 삽입 순서를 유지한다)
    const oldest = rasterCache.keys().next().value;
    if (oldest !== undefined) rasterCache.delete(oldest);
  }
  rasterCache.set(key, made);
  return made;
}

/** 템플릿/데이터가 바뀌면 캐시를 통째로 비운다 (편집기에서 dpi 변경 등) */
export function clearRasterCache(): void {
  rasterCache.clear();
}

// ============================================================
// 텍스트 래스터
// ============================================================

/** 줄 목록을 캔버스에 그린다 (가로/세로 정렬·반전·자간 반영) */
function paintLines(
  lines: string[],
  widthPx: number,
  heightPx: number,
  fontPx: number,
  lineH: number,
  font: string,
  lsPx: number,
  align: TextAlign,
  vAlign: TextVAlign,
  invert: boolean
): HTMLCanvasElement | null {
  const canvas = newCanvas(widthPx, heightPx);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = invert ? '#000' : '#fff';
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.font = font;
  ctx.fillStyle = invert ? '#fff' : '#000';
  ctx.textBaseline = 'top';

  const contentH = lineH * lines.length;
  const yOffset =
    vAlign === 'middle'
      ? Math.max(0, Math.floor((heightPx - contentH) / 2))
      : vAlign === 'bottom'
        ? Math.max(0, heightPx - contentH)
        : 0;

  lines.forEach((line, i) => {
    const lw = measureLine(ctx, line, lsPx);
    const x =
      align === 'center'
        ? Math.max(0, (widthPx - lw) / 2)
        : align === 'right'
          ? Math.max(0, widthPx - lw)
          : 0;
    // 베이스라인 top 기준에서 글꼴 위쪽 여백을 약간 보정
    drawLine(ctx, line, x, yOffset + i * lineH + Math.round(fontPx * 0.12), lsPx);
  });
  return canvas;
}

/**
 * 영역 모드에서 쓸 글자 크기 결정 (자동 축소).
 * size_pt 부터 SHRINK_STEP_PT 씩 내리며 "줄바꿈 결과가 높이에 들어가는" 첫 크기를 고른다.
 * min_pt 까지 내려도 안 들어가면 min_pt 를 돌려준다 (호출 측이 잘라내고 경고).
 */
function fitFontPt(
  el: TextElement,
  text: string,
  maxW: number,
  boxH: number,
  lsPx: number,
  lineGap: number,
  dpi: number
): number {
  const minPt = Math.max(1, el.min_pt ?? DEFAULT_MIN_PT);
  let pt = el.size_pt;
  while (pt > minPt) {
    const fontPx = Math.max(1, ptToDots(pt, dpi));
    const lineH = Math.max(1, Math.ceil(fontPx * lineGap));
    const lines = wrapTextLines(text, fontOf(el, fontPx), maxW, undefined, lsPx);
    if (lines.length * lineH <= boxH) return pt;
    pt = Math.round((pt - SHRINK_STEP_PT) * 100) / 100;
  }
  return Math.max(minPt, Math.min(pt, el.size_pt));
}

export function rasterText(
  el: TextElement,
  tpl: LabelTemplate,
  data: LabelData
): Raster | null {
  if (!canBrowser()) return null;
  const text = resolveElementText(el, data);
  if (!text) return null;

  const dpi = tpl.dpi;
  const lsPx = el.letter_spacing_mm ? mmToDots(el.letter_spacing_mm, dpi) : 0;
  const maxW = textBlockWidthDots(el, tpl);
  const lineGap = el.line_gap ?? DEFAULT_LINE_GAP;
  const align = el.align ?? 'left';
  const vAlign = el.v_align ?? 'top';
  const boxMode = isTextBox(el);
  const overflow = el.overflow ?? 'shrink';

  const key = [
    'txt',
    dpi,
    text,
    el.font_family ?? '',
    el.bold ? 1 : 0,
    el.italic ? 1 : 0,
    el.size_pt,
    lsPx,
    maxW,
    lineGap,
    align,
    vAlign,
    boxMode ? `box:${el.h_mm}:${overflow}:${el.min_pt ?? DEFAULT_MIN_PT}` : 'line',
    el.wrap ? 1 : 0,
    el.max_lines ?? 0,
    el.invert ? 1 : 0,
    el.rotate ?? 0,
  ].join('|');

  return cached(key, () => {
    const mctx = getMeasureCtx();
    if (!mctx) return null;

    // ── 영역 모드: 상자 크기 고정, 항상 줄바꿈, 넘치면 축소/잘라냄 ──
    if (boxMode) {
      const boxH = Math.max(1, mmToDots(el.h_mm as number, dpi));
      const usedPt =
        overflow === 'clip'
          ? el.size_pt
          : fitFontPt(el, text, maxW, boxH, lsPx, lineGap, dpi);
      const fontPx = Math.max(1, ptToDots(usedPt, dpi));
      const font = fontOf(el, fontPx);
      const lineH = Math.max(1, Math.ceil(fontPx * lineGap));

      const allLines = wrapTextLines(text, font, maxW, undefined, lsPx);
      const fitLines = Math.floor(boxH / lineH);
      const visible = allLines.slice(0, Math.max(0, fitLines));

      const canvas = paintLines(
        visible, maxW, boxH, fontPx, lineH, font, lsPx, align, vAlign, !!el.invert
      );
      if (!canvas) return null;
      const out = rotateCanvas(canvas, el.rotate ?? 0);
      return {
        canvas: out,
        wDots: out.width,
        hDots: out.height,
        text: {
          usedPt,
          totalLines: allLines.length,
          fitLines,
          clippedLines: Math.max(0, allLines.length - visible.length),
        },
      };
    }

    // ── 한 줄 모드 (옛 방식): 내용 크기에 맞춘 캔버스 ──
    const fontPx = Math.max(1, ptToDots(el.size_pt, dpi));
    const font = fontOf(el, fontPx);
    mctx.font = font;

    const lines = el.wrap
      ? wrapTextLines(text, font, maxW, el.max_lines, lsPx)
      : text.split(/\r?\n/).slice(0, el.max_lines && el.max_lines > 0 ? el.max_lines : undefined);
    if (lines.length === 0) return null;

    const widest = Math.ceil(Math.max(...lines.map((l) => measureLine(mctx, l, lsPx))));
    // 정렬이 걸려 있거나 폭을 명시했으면 블록 폭을 기준으로, 아니면 내용 폭에 맞춘다
    const useBlock = !!el.max_w_mm || align !== 'left';
    const widthPx = Math.max(1, useBlock ? maxW : Math.min(widest, maxW));
    const lineH = Math.max(1, Math.ceil(fontPx * lineGap));
    const heightPx = Math.max(1, lineH * lines.length);

    const canvas = paintLines(
      lines, widthPx, heightPx, fontPx, lineH, font, lsPx, align, 'top', !!el.invert
    );
    if (!canvas) return null;
    const out = rotateCanvas(canvas, el.rotate ?? 0);
    return {
      canvas: out,
      wDots: out.width,
      hDots: out.height,
      text: {
        usedPt: el.size_pt,
        totalLines: lines.length,
        fitLines: lines.length,
        clippedLines: 0,
      },
    };
  });
}

// ============================================================
// 바코드 래스터 (jsbarcode)
//
// 바코드도 이 래스터를 그대로 인쇄한다 (BITMAP). 프린터 내장 BARCODE 명령을
// 쓰지 않는 이유:
//   · 펌웨어마다 "아래 숫자(readable)" 를 무시하거나 폰트가 달라 화면과 어긋난다
//     (Deli 계열에서 실제로 숫자가 빠지는 문제가 있었다)
//   · 모듈 폭이 narrow(dots) 의 정수배로 그려지므로 도트 단위로 동일하다
//     → 스캔 품질은 같고, 화면 = 인쇄가 보장된다
// 막대는 jsbarcode 로, 아래 숫자는 우리 글꼴로 직접 그려 합성한다.
// ============================================================

/** 바코드 아래 숫자 기본 크기 (pt) */
const BARCODE_TEXT_PT = 7;

const JSBARCODE_FORMAT: Record<Symbology, string> = {
  '128': 'CODE128',
  '128M': 'CODE128',
  EAN13: 'EAN13',
  EAN8: 'EAN8',
  UPCA: 'UPC',
  '39': 'CODE39',
  '93': 'CODE128', // jsbarcode 는 CODE93 미지원 → 폭 근사치로 대체 표시
};

export const SYMBOLOGY_HINT: Record<Symbology, string> = {
  '128': '영문/숫자/기호 전부 가능',
  '128M': 'Code128 수동 모드 — 제어문자 직접 지정',
  EAN13: '숫자 12자리 (체크digit 자동) 또는 13자리',
  EAN8: '숫자 7자리 또는 8자리',
  UPCA: '숫자 11자리 또는 12자리',
  '39': '영문 대문자/숫자/일부 기호',
  '93': '영문 대문자/숫자 — 미리보기는 Code128 로 근사',
};

/**
 * 편집기 경고 — 문구가 아니라 i18n 키 + 치환값으로 돌려준다.
 * 화면(LabelSettings)이 현재 언어로 t(key, params) 해서 보여준다.
 */
export interface LabelWarning {
  key: string;
  params?: Record<string, string | number>;
}

const WARN = 'labelSettings.warn.';

/** 데이터가 이 심볼로지에 맞는지 검사 — 편집기 경고용 (맞으면 null) */
export function validateBarcode(symbology: Symbology, text: string): LabelWarning | null {
  if (!text) return { key: `${WARN}emptyContent` };
  switch (symbology) {
    case 'EAN13':
      return /^\d{12,13}$/.test(text) ? null : { key: `${WARN}ean13` };
    case 'EAN8':
      return /^\d{7,8}$/.test(text) ? null : { key: `${WARN}ean8` };
    case 'UPCA':
      return /^\d{11,12}$/.test(text) ? null : { key: `${WARN}upca` };
    case '39':
      return /^[0-9A-Z\-. $/+%]*$/.test(text) ? null : { key: `${WARN}code39` };
    case '93':
      return /^[0-9A-Z\-. $/+%]*$/.test(text) ? null : { key: `${WARN}code93` };
    default:
      // eslint-disable-next-line no-control-regex
      return /^[\x00-\x7F]*$/.test(text) ? null : { key: `${WARN}code128` };
  }
}

/**
 * 바코드/QR 정렬 — 내용 캔버스를 영역 폭 캔버스 안에 좌/중/우로 놓는다.
 * 영역 폭이 내용보다 좁으면 정렬 없이 내용 그대로 (잘라내지 않는다 — 스캔이 깨진다)
 */
function alignInBox(
  content: HTMLCanvasElement,
  boxW: number,
  align: TextAlign
): HTMLCanvasElement {
  if (align === 'left' || boxW <= content.width) return content;
  const out = newCanvas(boxW, content.height);
  if (!out) return content;
  const ctx = out.getContext('2d');
  if (!ctx) return content;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  const x = align === 'center' ? Math.floor((boxW - content.width) / 2) : boxW - content.width;
  ctx.drawImage(content, x, 0);
  return out;
}

/** 바코드/QR 의 정렬 기준 영역 폭 (dots). 미지정 시 라벨 오른쪽 끝까지 */
function codeBoxWidthDots(
  el: { x_mm: number; max_w_mm?: number; rotate?: Rotation },
  tpl: LabelTemplate
): number {
  if (el.max_w_mm) return Math.max(1, mmToDots(el.max_w_mm, tpl.dpi));
  return Math.max(1, mmToDots(Math.max(1, tpl.width_mm - el.x_mm), tpl.dpi));
}

/** 렌더 실패 시 자리에 그리는 회색 안내 박스 (레이아웃이 무너지지 않게) */
function placeholderRaster(w: number, h: number, msg: string): Raster | null {
  const canvas = newCanvas(w, h);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#999';
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  return { canvas, wDots: canvas.width, hDots: canvas.height, error: msg };
}

export function rasterBarcode(
  el: BarcodeElement,
  tpl: LabelTemplate,
  data: LabelData
): Raster | null {
  if (!canBrowser()) return null;
  const text = resolveElementText(el, data);
  if (!text) return null;

  const dpi = tpl.dpi;
  const hDots = Math.max(1, mmToDots(el.h_mm, dpi));
  const narrow = Math.max(1, Math.round(el.narrow));
  const readable = !!el.human_readable;
  const textPt = el.text_pt ?? BARCODE_TEXT_PT;
  const fontPx = Math.max(6, ptToDots(textPt, dpi));
  const align: TextAlign = el.align ?? 'left';
  const boxW = align === 'left' ? 0 : codeBoxWidthDots(el, tpl);

  const key = [
    'bc',
    dpi,
    el.symbology,
    text,
    hDots,
    narrow,
    readable ? `t${fontPx}` : 0,
    `${align}:${boxW}`,
    el.rotate ?? 0,
  ].join('|');

  return cached(key, () => {
    // 1) 막대만 (jsbarcode 는 정수 좌표 사각형만 그려서 도트 단위로 정확하다)
    const bars = newCanvas(10, hDots);
    if (!bars) return null;
    try {
      JsBarcode(bars, text, {
        format: JSBARCODE_FORMAT[el.symbology],
        width: narrow,
        height: hDots,
        displayValue: false,
        margin: 0,
        background: '#ffffff',
        lineColor: '#000000',
      });
    } catch (err) {
      // 규격 위반이면 i18n 키, 아니면 라이브러리 메시지 그대로 (elementWarning 이 구분한다)
      const msg =
        validateBarcode(el.symbology, text)?.key ??
        (err instanceof Error ? err.message : `${WARN}barcodeFailed`);
      return placeholderRaster(mmToDots(20, dpi), hDots, msg);
    }

    if (!readable) {
      const out = rotateCanvas(alignInBox(bars, boxW, align), el.rotate ?? 0);
      return { canvas: out, wDots: out.width, hDots: out.height };
    }

    // 2) 아래 숫자 — 우리 글꼴로 직접 그려 합성 (프린터 내장 폰트에 의존하지 않는다)
    const font = `${fontPx}px ${fontStack('Consolas')}`;
    const mctx = getMeasureCtx();
    if (!mctx) return null;
    mctx.font = font;
    const textW = Math.ceil(mctx.measureText(text).width);
    const gap = Math.max(1, Math.round(fontPx * 0.15));
    const lineH = Math.ceil(fontPx * 1.15);
    const totalW = Math.max(bars.width, textW);
    const totalH = bars.height + gap + lineH;

    const canvas = newCanvas(totalW, totalH);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, totalW, totalH);
    ctx.drawImage(bars, Math.floor((totalW - bars.width) / 2), 0);
    ctx.font = font;
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.fillText(text, Math.floor(totalW / 2), bars.height + gap);

    const out = rotateCanvas(alignInBox(canvas, boxW, align), el.rotate ?? 0);
    return { canvas: out, wDots: out.width, hDots: out.height };
  });
}

// ============================================================
// QR 래스터 (qrcode — 동기 API 로 모듈 행렬만 받아 직접 그린다)
// ============================================================

export function rasterQr(el: QrElement, tpl: LabelTemplate, data: LabelData): Raster | null {
  if (!canBrowser()) return null;
  const text = resolveElementText(el, data);
  if (!text) return null;

  const cell = Math.max(1, Math.min(10, Math.round(el.cell)));
  const align: TextAlign = el.align ?? 'left';
  const boxW = align === 'left' ? 0 : codeBoxWidthDots(el, tpl);
  const key = ['qr', tpl.dpi, text, el.ecc, cell, `${align}:${boxW}`, el.rotate ?? 0].join('|');

  return cached(key, () => {
    let size = 0;
    let modules: Uint8Array;
    try {
      const qr = QRCode.create(text, { errorCorrectionLevel: el.ecc });
      size = qr.modules.size;
      modules = qr.modules.data as unknown as Uint8Array;
    } catch (err) {
      return placeholderRaster(
        cell * 21,
        cell * 21,
        err instanceof Error ? err.message : `${WARN}qrFailed`
      );
    }

    const px = size * cell;
    const canvas = newCanvas(px, px);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#000';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (modules[r * size + c]) ctx.fillRect(c * cell, r * cell, cell, cell);
      }
    }

    // QR 은 정사각형이라 회전해도 크기는 같지만, 데이터 방향을 맞추기 위해 동일 처리
    const out = rotateCanvas(alignInBox(canvas, boxW, align), el.rotate ?? 0);
    return { canvas: out, wDots: out.width, hDots: out.height };
  });
}

// ============================================================
// 이미지 래스터 (세탁 기호 · 업로드 로고)
//
// 이미지 디코딩은 비동기다. 래스터 파이프라인은 동기이므로
//   · 아직 안 읽힌 이미지는 null 을 돌려주고 (자리만 비워 둠)
//   · 읽히는 순간 구독자(미리보기)에게 알려 다시 그리게 한다
//   · 인쇄 전에는 preloadTemplateAssets() 로 전부 읽어 둔다 — 기호 빠진 라벨 방지
// ============================================================

interface ImageEntry {
  img: HTMLImageElement;
  ready: boolean;
  failed: boolean;
}

const imageCache = new Map<string, ImageEntry>();
const rasterListeners = new Set<() => void>();

/** 이미지가 늦게 읽혀 화면을 다시 그려야 할 때 호출된다 */
export function subscribeRaster(listener: () => void): () => void {
  rasterListeners.add(listener);
  return () => {
    rasterListeners.delete(listener);
  };
}

function notifyRaster(): void {
  rasterListeners.forEach((fn) => fn());
}

/** 이미지 요소의 실제 소스 (내장 기호 우선) */
export function imageSource(el: ImageElement): string | null {
  if (el.symbol) return careSymbolDataUrl(el.symbol);
  return el.src || null;
}

function getImage(src: string): ImageEntry {
  const hit = imageCache.get(src);
  if (hit) return hit;
  const img = new Image();
  const entry: ImageEntry = { img, ready: false, failed: false };
  imageCache.set(src, entry);
  img.onload = () => {
    entry.ready = true;
    notifyRaster();
  };
  img.onerror = () => {
    entry.failed = true;
    notifyRaster();
  };
  img.src = src;
  return entry;
}

/** 이미지 로드 완료를 기다린다 (실패도 완료로 본다 — 자리표시자로 진행) */
function whenLoaded(src: string): Promise<void> {
  const entry = getImage(src);
  if (entry.ready || entry.failed) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      entry.img.removeEventListener('load', done);
      entry.img.removeEventListener('error', done);
      resolve();
    };
    entry.img.addEventListener('load', done);
    entry.img.addEventListener('error', done);
  });
}

// ============================================================
// 글꼴 준비 — 웹폰트는 처음 쓰는 순간 받아오므로, 래스터 전에 기다려야
// 폴백 글꼴로 찍히는 일이 없다. 굵게/기울임 변형도 같이 받아 둔다.
// 받아온 뒤 notifyRaster 로 미리보기를 다시 그리게 한다.
// ============================================================
const fontsLoaded = new Set<string>();

export async function ensureFontsLoaded(families: string[]): Promise<void> {
  if (!canBrowser() || typeof document.fonts?.load !== 'function') return;
  const todo = Array.from(new Set(families.filter((f) => f && !fontsLoaded.has(f))));
  if (todo.length === 0) return;
  const variants = ['', 'bold ', 'italic ', 'italic bold '];
  await Promise.all(
    todo.flatMap((family) =>
      variants.map((v) => document.fonts.load(`${v}12px "${family}"`).catch(() => undefined))
    )
  );
  todo.forEach((f) => fontsLoaded.add(f));
  notifyRaster();
}

/** 템플릿의 텍스트 요소가 쓰는 글꼴 목록 */
export function templateFonts(tpl: LabelTemplate): string[] {
  const set = new Set<string>();
  for (const el of tpl.layout || []) {
    if (el.type === 'text' && !el.hidden) set.add(el.font_family || DEFAULT_FONT);
  }
  return Array.from(set);
}

/** 템플릿의 이미지·글꼴을 전부 읽어 둔다 — 인쇄 직전에 반드시 호출 */
export async function preloadTemplateAssets(tpl: LabelTemplate): Promise<void> {
  if (!canBrowser()) return;
  const jobs: Promise<void>[] = [ensureFontsLoaded(templateFonts(tpl))];
  for (const el of tpl.layout || []) {
    if (el.type !== 'image' || el.hidden) continue;
    const src = imageSource(el);
    if (src) jobs.push(whenLoaded(src));
  }
  await Promise.all(jobs);
}

/** 문자열 → 짧은 해시 (data URL 을 캐시 키에 통째로 넣지 않기 위해) */
function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ':' + s.length;
}

export function rasterImage(el: ImageElement, tpl: LabelTemplate): Raster | null {
  if (!canBrowser()) return null;
  const src = imageSource(el);
  const dpi = tpl.dpi;
  const w = Math.max(1, mmToDots(el.w_mm, dpi));
  const h = Math.max(1, mmToDots(el.h_mm, dpi));
  const threshold = Math.min(255, Math.max(0, el.threshold ?? 128));

  // 이미지 오류는 i18n 키로 남긴다 (elementWarning 이 키인지 보고 그대로 넘긴다)
  if (!src) return placeholderRaster(w, h, `${WARN}imageMissing`);

  const entry = getImage(src);
  if (entry.failed) return placeholderRaster(w, h, `${WARN}imageFailed`);
  if (!entry.ready) return null;

  const key = ['img', dpi, shortHash(src), w, h, threshold, el.rotate ?? 0].join('|');
  return cached(key, () => {
    const canvas = newCanvas(w, h);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(entry.img, 0, 0, w, h);

    // 1비트로 확정 — 미리보기와 인쇄가 같은 점을 찍도록
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const black = d[i + 3] > 128 && lum < threshold;
      d[i] = d[i + 1] = d[i + 2] = black ? 0 : 255;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);

    const out = rotateCanvas(canvas, el.rotate ?? 0);
    return { canvas: out, wDots: out.width, hDots: out.height };
  });
}

// ============================================================
// 요소 공통 — 래스터 / 크기
// ============================================================

/** 텍스트·바코드·QR·이미지는 래스터가 있다 (박스·선은 도형으로 직접 그린다) */
export function rasterElement(
  el: LabelElement,
  tpl: LabelTemplate,
  data: LabelData
): Raster | null {
  switch (el.type) {
    case 'text':
      return rasterText(el, tpl, data);
    case 'barcode':
      return rasterBarcode(el, tpl, data);
    case 'qr':
      return rasterQr(el, tpl, data);
    case 'image':
      return rasterImage(el, tpl);
    default:
      return null;
  }
}

export interface ElementBox {
  x_mm: number;
  y_mm: number;
  w_mm: number;
  h_mm: number;
}

/**
 * 라벨 위에서 요소가 실제로 차지하는 영역 (mm, 회전 반영).
 * 캔버스의 클릭 판정·선택 테두리·크기 핸들이 전부 이 값을 쓴다.
 */
export function measureElement(
  el: LabelElement,
  tpl: LabelTemplate,
  data: LabelData
): ElementBox {
  const swap = el.rotate === 90 || el.rotate === 270;

  // 치수가 요소에 그대로 있는 것들 (이미지는 아직 안 읽혔어도 자리는 정해져 있다)
  if (el.type === 'box' || el.type === 'line' || el.type === 'image') {
    return {
      x_mm: el.x_mm,
      y_mm: el.y_mm,
      w_mm: swap ? el.h_mm : el.w_mm,
      h_mm: swap ? el.w_mm : el.h_mm,
    };
  }

  const raster = rasterElement(el, tpl, data);
  if (!raster) {
    // 영역 모드 텍스트는 내용이 비어도 상자 자체가 영역이다
    if (el.type === 'text' && isTextBox(el)) {
      const wMm = dotsToMm(textBlockWidthDots(el, tpl), tpl.dpi);
      const hMm = el.h_mm as number;
      return {
        x_mm: el.x_mm,
        y_mm: el.y_mm,
        w_mm: swap ? hMm : wMm,
        h_mm: swap ? wMm : hMm,
      };
    }
    // 내용이 비었을 때도 클릭은 되어야 한다 — 최소 크기 상자
    const fallback =
      el.type === 'text' ? Math.max(2, (el as TextElement).size_pt * 0.36) : 6;
    return { x_mm: el.x_mm, y_mm: el.y_mm, w_mm: 8, h_mm: fallback };
  }

  return {
    x_mm: el.x_mm,
    y_mm: el.y_mm,
    w_mm: dotsToMm(raster.wDots, tpl.dpi),
    h_mm: dotsToMm(raster.hDots, tpl.dpi),
  };
}

/**
 * 요소의 렌더 경고 (바코드 규격 위반 등) — 없으면 null.
 * i18n 키로 돌려주므로 화면에서 t(key, params) 로 번역한다.
 *   clipped 의 {{shrunk}} 는 중첩 문구라 호출 측이 먼저 clippedShrunk 를 번역해 넣어야 한다
 *   → params.shrunkPt 를 같이 준다 (없으면 축소 없이 잘린 것).
 */
export function elementWarning(
  el: LabelElement,
  tpl: LabelTemplate,
  data: LabelData
): LabelWarning | null {
  if (el.type === 'barcode') {
    const text = resolveElementText(el, data);
    const invalid = validateBarcode(el.symbology, text);
    if (invalid) return invalid;
  }
  if (el.type === 'text' && el.font_family && !isFontAvailable(el.font_family)) {
    return { key: `${WARN}fontMissing`, params: { font: el.font_family } };
  }
  if (el.type === 'image') {
    const r = rasterImage(el, tpl);
    if (r?.error) {
      return r.error.startsWith(WARN)
        ? { key: r.error }
        : { key: `${WARN}raw`, params: { msg: r.error } };
    }
  }
  if (el.type === 'text' && isTextBox(el)) {
    const fit = rasterText(el, tpl, data)?.text;
    if (fit && fit.clippedLines > 0) {
      return {
        key: `${WARN}clipped`,
        params: {
          lines: fit.clippedLines,
          ...(fit.usedPt < el.size_pt ? { shrunkPt: fit.usedPt } : {}),
        },
      };
    }
  }
  const box = measureElement(el, tpl, data);
  if (box.x_mm + box.w_mm > tpl.width_mm + 0.05 || box.y_mm + box.h_mm > tpl.height_mm + 0.05) {
    return { key: `${WARN}outOfLabel` };
  }
  return null;
}

// ============================================================
// 라벨 전체 → 캔버스 (프린터 도트 해상도)
//   미리보기는 이 결과를 화면 배율로 확대해 그린다.
// ============================================================

export function renderLabelCanvas(
  tpl: LabelTemplate,
  data: LabelData
): HTMLCanvasElement | null {
  const dpi = tpl.dpi;
  const W = mmToDots(tpl.width_mm, dpi);
  const H = mmToDots(tpl.height_mm, dpi);
  const canvas = newCanvas(W, H);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  for (const el of tpl.layout || []) {
    if (el.hidden) continue;
    const x = mmToDots(el.x_mm, dpi);
    const y = mmToDots(el.y_mm, dpi);

    if (el.type === 'box') {
      const swap = el.rotate === 90 || el.rotate === 270;
      const w = mmToDots(swap ? el.h_mm : el.w_mm, dpi);
      const h = mmToDots(swap ? el.w_mm : el.h_mm, dpi);
      ctx.fillStyle = '#000';
      if (el.filled) {
        ctx.fillRect(x, y, w, h);
      } else {
        const th = Math.max(1, mmToDots(el.thickness_mm, dpi));
        ctx.fillRect(x, y, w, th);
        ctx.fillRect(x, y + h - th, w, th);
        ctx.fillRect(x, y, th, h);
        ctx.fillRect(x + w - th, y, th, h);
      }
      continue;
    }

    if (el.type === 'line') {
      const swap = el.rotate === 90 || el.rotate === 270;
      ctx.fillStyle = '#000';
      ctx.fillRect(
        x,
        y,
        Math.max(1, mmToDots(swap ? el.h_mm : el.w_mm, dpi)),
        Math.max(1, mmToDots(swap ? el.w_mm : el.h_mm, dpi))
      );
      continue;
    }

    const raster = rasterElement(el, tpl, data);
    if (raster) ctx.drawImage(raster.canvas, x, y);
  }

  return canvas;
}

// ============================================================
// 1-bit 패킹 — TSPL BITMAP 페이로드
//   TSPL BITMAP 은 비트 0 = 검정(찍힘), 1 = 흰색(안 찍힘)
// ============================================================

export interface PackedBitmap {
  widthBytes: number;
  height: number;
  bytes: Uint8Array;
}

export function packMono(canvas: HTMLCanvasElement): PackedBitmap | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height).data;
  const widthBytes = Math.ceil(width / 8);
  const bytes = new Uint8Array(widthBytes * height).fill(0xff);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = img[i + 3];
      const lum = 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
      if (a > 128 && lum < 128) {
        bytes[y * widthBytes + (x >> 3)] &= ~(0x80 >> (x & 7));
      }
    }
  }

  return { widthBytes, height, bytes };
}
