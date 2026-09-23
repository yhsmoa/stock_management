// ============================================================
// ZPL 렌더러 — 라벨 템플릿(JSON, mm) → ZPL II 명령(바이트)
//
// 대상: Zebra · BIXOLON BPL-Z(ZPL 에뮬레이션, SLP-DX420 등) · HPRT(ZPL 모드)
//
// 왜 필요한가
//   회사 사무실 프린터가 TSPL 을 모르는 기종이다. BIXOLON 은 SLCS/BPL-Z/BPL-E 만 알아서
//   TSPL 스트림(BITMAP 이진 포함)을 받으면 라벨에 "Stored Font Info / Memory left" 같은
//   자기 정보만 찍고 만다. 템플릿의 printer_lang 을 'ZPL' 로 두면 이 렌더러가 쓰인다.
//
// 설계 요점 (utils/label/tspl.ts 와 같은 구조)
//   · 좌표·크기는 mm → 인쇄 순간 dots 로 변환
//   · 텍스트·바코드·QR·이미지는 전부 캔버스 1-bit 래스터 → ^GFA (ASCII 16진수)
//       - 화면 미리보기 = 인쇄물 보장, 한글 폰트 문제 없음 (프린터 폰트를 안 쓴다)
//       - ZPL 은 비트 1 = 검정. packMono 는 TSPL 규약(0 = 검정)이라 바이트를 반전한다
//       - 16진수라 이진 데이터가 명령 스트림에 섞이지 않는다 (ZPL 의 ~ 즉시 명령과 충돌 없음)
//   · 선/박스는 ^GB 네이티브
//   · 결과는 Uint8Array (전부 ASCII)
//
// 매핑
//   SIZE          → ^PW(폭 dots) ^LL(길이 dots)
//   GAP/BLINE     → ^MNY(틈) / ^MNN(연속) / ^MNM(블랙마크)   ※ 틈 크기는 프린터가 스스로 잰다
//   DENSITY 0~15  → ~SD 0~30 (2배)
//   SPEED         → ^PR (inch/s)
//   SET CUTTER    → ^MMC + ^PQ 의 절단 간격 (each = 1장마다, batch = 묶음 끝) / off = ^MMT
//   DIRECTION 1   → ^PON (기본). 거꾸로 나오면 프린터 쪽 설정이나 여기 ^POI 로 뒤집을 것
//
// ⚠️ 브라우저 전용 (canvas 사용). 인쇄는 클라이언트에서 수행된다.
// ============================================================

import type { LabelElement, LabelData, LabelTemplate } from './labelTypes';
import { mmToDots, packMono, rasterElement } from './labelRender';

const CRLF = '\r\n';
const enc = new TextEncoder();

/** 바이트 → 대문자 16진수 (ZPL ^GFA 는 ASCII 16진수를 받는다) */
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase());
function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i]];
  return s;
}

// ============================================================
// 요소 1개 → ZPL 문자열
// ============================================================
function renderElement(el: LabelElement, data: LabelData, tpl: LabelTemplate): string {
  if (el.hidden) return '';

  const dpi = tpl.dpi;
  const x = mmToDots(el.x_mm, dpi);
  const y = mmToDots(el.y_mm, dpi);
  const rotate = el.rotate ?? 0;

  switch (el.type) {
    case 'text':
    case 'barcode':
    case 'qr':
    case 'image': {
      // 래스터는 회전까지 이미 반영돼 있다. 이미지는 호출 전에 preloadTemplateAssets() 로 읽어 둔다
      const raster = rasterElement(el, tpl, data);
      if (!raster || raster.error) return ''; // 규격 위반 바코드 등은 자리표시자를 찍지 않는다
      const packed = packMono(raster.canvas);
      if (!packed) return '';
      // TSPL 규약(0 = 검정) → ZPL 규약(1 = 검정). 오른쪽 여백 비트는 packMono 가 1(흰색)로 채워
      // 두므로 반전하면 0 = 안 찍힘 이 된다
      const inverted = new Uint8Array(packed.bytes.length);
      for (let i = 0; i < inverted.length; i++) inverted[i] = ~packed.bytes[i] & 0xff;
      const total = inverted.length;
      return `^FO${x},${y}^GFA,${total},${total},${packed.widthBytes},${toHex(inverted)}^FS${CRLF}`;
    }

    case 'box': {
      const swap = rotate === 90 || rotate === 270;
      const w = Math.max(1, mmToDots(swap ? el.h_mm : el.w_mm, dpi));
      const h = Math.max(1, mmToDots(swap ? el.w_mm : el.h_mm, dpi));
      // 선 두께가 변의 길이를 넘으면 ZPL 이 거부한다 → 채움은 짧은 변만큼
      const th = el.filled ? Math.min(w, h) : Math.min(Math.max(1, mmToDots(el.thickness_mm, dpi)), w, h);
      return `^FO${x},${y}^GB${w},${h},${th},B,0^FS${CRLF}`;
    }

    case 'line': {
      const swap = rotate === 90 || rotate === 270;
      const w = Math.max(1, mmToDots(swap ? el.h_mm : el.w_mm, dpi));
      const h = Math.max(1, mmToDots(swap ? el.w_mm : el.h_mm, dpi));
      return `^FO${x},${y}^GB${w},${h},${Math.min(w, h)},B,0^FS${CRLF}`;
    }
  }
  return '';
}

// ============================================================
// 템플릿 + 데이터 → 인쇄 작업 1건 (Uint8Array)
//   copies = 인쇄 장수 (보통 라벨 수량)
// ============================================================
export function buildZplJob(tpl: LabelTemplate, data: LabelData, copies: number): Uint8Array {
  const n = Math.max(1, Math.floor(copies || 1));
  const dpi = tpl.dpi;
  let s = `^XA${CRLF}`;

  s += `^PW${Math.max(1, mmToDots(tpl.width_mm, dpi))}${CRLF}`;
  s += `^LL${Math.max(1, mmToDots(tpl.height_mm, dpi))}${CRLF}`;
  s += `^LH0,0${CRLF}`;

  // 용지 센서 — 틀리면 프린터가 라벨 경계를 찾다가 에러로 멈춘다
  switch (tpl.media ?? 'gap') {
    case 'continuous':
      s += `^MNN${CRLF}`;
      break;
    case 'blackmark':
      s += `^MNM${CRLF}`;
      break;
    default:
      s += `^MNY${CRLF}`;
  }

  // 농도/속도 — RAW 인쇄는 드라이버 설정을 거치지 않으므로 여기서 지정 (없으면 프린터 기본값)
  if (tpl.density != null && Number.isFinite(tpl.density)) {
    s += `~SD${Math.min(30, Math.max(0, Math.round(tpl.density * 2)))}${CRLF}`;
  }
  if (tpl.speed != null && Number.isFinite(tpl.speed) && tpl.speed > 0) {
    s += `^PR${Math.min(14, Math.max(1, Math.round(tpl.speed)))}${CRLF}`;
  }

  // 자동 절단 — ^MMC 에서 ^PQ 의 두 번째 값이 "몇 장마다 자를지"
  const cutter = tpl.cutter ?? 'off';
  s += cutter === 'off' ? `^MMT${CRLF}` : `^MMC${CRLF}`;
  const cutEvery = cutter === 'each' ? 1 : cutter === 'batch' ? n : 0;

  for (const el of tpl.layout || []) s += renderElement(el, data, tpl);

  s += `^PQ${n},${cutEvery},0,N${CRLF}`;
  s += `^XZ${CRLF}`;
  return enc.encode(s);
}

/** 여러 항목을 한 번의 전송으로 (항목마다 ^XA~^XZ 반복) */
export function buildZplBatch(tpl: LabelTemplate, rows: { data: LabelData; copies: number }[]): Uint8Array {
  const parts = rows.map((r) => buildZplJob(tpl, r.data, r.copies));
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
