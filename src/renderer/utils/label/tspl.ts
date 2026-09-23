// ============================================================
// TSPL 렌더러 — 라벨 템플릿(JSON, mm) → TSPL2 명령(바이트)
//
// 대상: TSC TE310(300dpi, 케어라벨) / Deli DL-720(TSPL 호환, 바코드)
//
// 설계 요점
//   · 좌표·크기는 템플릿에 mm 로 저장 → 인쇄 순간 DPI 로 dots 변환
//   · 텍스트·바코드·QR·이미지는 전부 캔버스 1-bit 비트맵(BITMAP)으로 출력
//       - TSPL 내장 폰트는 영문/숫자만 가능 → 한글(상품명·소재)을 못 찍는다.
//       - 내장 BARCODE 명령은 펌웨어마다 "아래 숫자" 를 빼먹거나 폰트가 다르다
//         (Deli 계열에서 실제 발생). QRCODE 도 버전 선택이 펌웨어마다 달라 크기가 어긋날 수 있다.
//       래스터는 프린터 도트 해상도로 그리므로 스캔 품질은 네이티브와 같고,
//       화면 미리보기 = 인쇄물이 보장된다. 래스터는 utils/label/labelRender.ts 가 담당한다.
//   · 선/박스만 네이티브 명령 (단순 도형이라 차이가 없고 바이트가 작다)
//   · 결과는 Uint8Array — BITMAP 페이로드가 이진이라 문자열로 다루면 깨진다.
//
// ⚠️ 브라우저 전용 (canvas 사용). 인쇄는 클라이언트에서 수행된다.
// ============================================================

import type { LabelElement, LabelData, LabelTemplate } from './labelTypes';
import { mmToDots, ptToDots, dotsToMm, packMono, rasterElement } from './labelRender';

// 기존 호출부 호환을 위해 단위 변환 헬퍼를 계속 re-export 한다
export { mmToDots, ptToDots, dotsToMm };
export { wrapTextLines } from './labelRender';

const CRLF = '\r\n';
const enc = new TextEncoder();

function ascii(s: string): Uint8Array {
  return enc.encode(s);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ============================================================
// 요소 1개 → TSPL 바이트
// ============================================================
function renderElement(
  el: LabelElement,
  data: LabelData,
  tpl: LabelTemplate
): Uint8Array[] {
  if (el.hidden) return [];

  const dpi = tpl.dpi;
  const x = mmToDots(el.x_mm, dpi);
  const y = mmToDots(el.y_mm, dpi);
  const rotate = el.rotate ?? 0;
  const out: Uint8Array[] = [];

  switch (el.type) {
    case 'text':
    case 'barcode':
    case 'qr':
    case 'image': {
      // 래스터는 회전까지 이미 반영돼 있다 (BITMAP 은 회전 인자가 없다)
      // 이미지는 호출 전에 preloadTemplateAssets() 로 읽어 두어야 한다
      const raster = rasterElement(el, tpl, data);
      if (!raster || raster.error) break; // 규격 위반 바코드 등은 자리표시자를 찍지 않는다
      const packed = packMono(raster.canvas);
      if (!packed) break;
      out.push(ascii(`BITMAP ${x},${y},${packed.widthBytes},${packed.height},0,`));
      out.push(packed.bytes);
      out.push(ascii(CRLF));
      break;
    }

    case 'box': {
      // 회전 시 가로/세로가 바뀐다 (박스는 각도가 아니라 치수 교환으로 충분)
      const swap = rotate === 90 || rotate === 270;
      const w = mmToDots(swap ? el.h_mm : el.w_mm, dpi);
      const h = mmToDots(swap ? el.w_mm : el.h_mm, dpi);
      if (el.filled) {
        out.push(ascii(`BAR ${x},${y},${Math.max(1, w)},${Math.max(1, h)}${CRLF}`));
      } else {
        const th = Math.max(1, mmToDots(el.thickness_mm, dpi));
        out.push(ascii(`BOX ${x},${y},${x + w},${y + h},${th}${CRLF}`));
      }
      break;
    }

    case 'line': {
      const swap = rotate === 90 || rotate === 270;
      const w = Math.max(1, mmToDots(swap ? el.h_mm : el.w_mm, dpi));
      const h = Math.max(1, mmToDots(swap ? el.w_mm : el.h_mm, dpi));
      out.push(ascii(`BAR ${x},${y},${w},${h}${CRLF}`));
      break;
    }
  }

  return out;
}

// ============================================================
// 템플릿 + 데이터 → 인쇄 작업 1건 (Uint8Array)
//   copies = 인쇄 장수 (보통 라벨 수량)
// ============================================================
export function buildTsplJob(
  tpl: LabelTemplate,
  data: LabelData,
  copies: number
): Uint8Array {
  const n = Math.max(1, Math.floor(copies || 1));
  const parts: Uint8Array[] = [];

  parts.push(ascii(`SIZE ${tpl.width_mm} mm,${tpl.height_mm} mm${CRLF}`));
  // 용지 센서 — 틀리면 프린터가 라벨 경계를 찾다가 에러로 멈춘다
  switch (tpl.media ?? 'gap') {
    case 'continuous':
      parts.push(ascii(`GAP 0 mm,0${CRLF}`)); // 연속 용지: 틈 찾기 없음, SIZE 만큼 이송
      break;
    case 'blackmark':
      parts.push(ascii(`BLINE ${tpl.gap_mm} mm,0${CRLF}`));
      break;
    default:
      parts.push(ascii(`GAP ${tpl.gap_mm} mm,0${CRLF}`));
  }
  // 농도/속도 — RAW 인쇄는 드라이버 설정을 거치지 않으므로 여기서 지정 (없으면 프린터 기본값)
  if (tpl.density != null && Number.isFinite(tpl.density)) {
    parts.push(ascii(`DENSITY ${Math.min(15, Math.max(0, Math.round(tpl.density)))}${CRLF}`));
  }
  if (tpl.speed != null && Number.isFinite(tpl.speed) && tpl.speed > 0) {
    parts.push(ascii(`SPEED ${tpl.speed}${CRLF}`));
  }
  // 자동 절단 — 1 = 매 장, BATCH = PRINT 묶음 끝, OFF = 안 함
  switch (tpl.cutter ?? 'off') {
    case 'each':
      parts.push(ascii(`SET CUTTER 1${CRLF}`));
      break;
    case 'batch':
      parts.push(ascii(`SET CUTTER BATCH${CRLF}`));
      break;
    default:
      parts.push(ascii(`SET CUTTER OFF${CRLF}`));
  }
  parts.push(ascii(`DIRECTION 1${CRLF}`));
  parts.push(ascii(`REFERENCE 0,0${CRLF}`));
  parts.push(ascii(`CLS${CRLF}`));

  for (const el of tpl.layout || []) {
    for (const chunk of renderElement(el, data, tpl)) parts.push(chunk);
  }

  parts.push(ascii(`PRINT ${n}${CRLF}`));
  return concat(parts);
}

/** 여러 항목을 한 번의 전송으로 (항목마다 CLS~PRINT 반복) */
export function buildTsplBatch(
  tpl: LabelTemplate,
  rows: { data: LabelData; copies: number }[]
): Uint8Array {
  return concat(rows.map((r) => buildTsplJob(tpl, r.data, r.copies)));
}

/** QZ Tray raw 전송용 base64 */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** 디버그용 — 이진(BITMAP) 부분은 «bitmap N bytes» 로 축약해 보여준다 */
export function tsplPreviewText(bytes: Uint8Array): string {
  let s = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    s += b >= 32 && b < 127 ? String.fromCharCode(b) : b === 13 ? '' : b === 10 ? '\n' : '·';
    i++;
  }
  return s.replace(/·{4,}/g, (m) => `«bitmap ${m.length} bytes»`);
}
