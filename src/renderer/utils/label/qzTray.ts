// ============================================================
// QZ Tray 클라이언트 — 웹 ↔ 로컬 라벨 프린터 중계
//
// 브라우저는 USB 프린터에 raw 명령을 직접 못 보낸다.
// 인쇄 PC 에 상주하는 QZ Tray 가 localhost(ws://localhost:8182 등) 에서
// 그 역할을 대신한다.
//
// · qz-tray.js / js-sha256 은 CDN 에서 동적 로드 (SSR 회피 — 브라우저에서만)
// · 인쇄는 RAW(base64) 로 전송 — 이미지/PDF 보다 정렬·스캔율이 안정적
//
// ── 허용 창 ("An anonymous request wants to connect") ──────────
// 서명 인증서를 설정하지 않았으므로 QZ 가 새 연결마다 허용/차단 창을 띄운다.
// 사용자가 "Remember this decision" 과 함께 허용하면 그 PC 에서는 더 묻지 않는다.
// 창 없이 완전 무음으로 쓰려면 자체 서명 인증서를 만들어 각 인쇄 PC 의 QZ 에
// 신뢰시키고(override.crt), 요청을 서버에서 서명해야 한다 — 무료 버전으로 가능하다.
// (별도 작업 항목)
//
// ── 연결 판정에 관한 함정 (qz-tray 2.2.4) ───────────────────────
// 1) websocket.isActive() 는 소켓이 "연결 중(CONNECTING)" 이어도 true 다.
//    실제 명령을 보내는 connection.sendData 는 핸드셰이크가 끝나야 붙는다.
//    → isActive() 만 믿고 명령을 보내면 "sendData is not a function" 으로 터진다.
//    → qz.api.getVersion() (서명 불필요·허용 창 없음) 왕복이 성공해야 연결로 본다.
//       getConnectionInfo() 는 로컬 상태만 읽어서 판정에 못 쓴다.
// 2) QZ 가 꺼진 채로 connect/disconnect 가 얽히면 라이브러리 내부 소켓이
//    CLOSING 에 갇혀 이후 connect() 가 즉시 거부된다 (페이지 새로고침 전까지).
//    라이브러리 밖에서는 그 상태를 고칠 수 없으므로, 스크립트를 다시 불러와
//    깨끗한 인스턴스로 교체한다 (resetQzLibrary).
// 3) 그래서 이 파일은 disconnect() 를 복구 용도로 부르지 않는다.
//    복구 = 라이브러리 리셋 + 재연결. 연결마다 허용 창이 뜰 수 있으므로
//    재시도는 딱 한 번만 한다.
// ============================================================

import { bytesToBase64 } from './tspl';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    qz?: any;
    sha256?: any;
  }
}

const QZ_SRC = 'https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js';
const SHA_SRC = 'https://cdn.jsdelivr.net/npm/js-sha256@0.11.0/src/sha256.min.js';

/** 핸드셰이크 완료를 기다리는 최대 시간 */
const READY_TIMEOUT_MS = 8000;
/** 준비 확인 재시도 간격 */
const READY_POLL_MS = 150;
/** 왕복 확인 1회 제한 */
const PROBE_TIMEOUT_MS = 2000;
/** connect() 전체 제한 (라이브러리가 호스트×포트 조합을 순회한다) */
const CONNECT_TIMEOUT_MS = 12000;
/** disconnect() 제한 — 반쯤 열린 소켓은 close 이벤트가 안 와서 영원히 기다린다 */
const DISCONNECT_TIMEOUT_MS = 1500;

/** QZ Tray 가 안 떠 있을 때 사용자에게 보여줄 문구 */
export const QZ_NOT_RUNNING =
  '이 PC에서 QZ Tray가 실행 중이 아닙니다. QZ Tray를 실행한 뒤 다시 시도해주세요.';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 약속에 시간 제한을 건다 — 넘기면 거부 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} 시간 초과 (${ms}ms)`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ============================================================
// 라이브러리 로드 / 리셋
// ============================================================
let loadPromise: Promise<any> | null = null;
/** 캐시된 연결 (성공한 것만 유지). 끊기면 null 로 되돌린다 */
let connectPromise: Promise<any> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`스크립트 로드 실패: ${src}`)));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => {
      s.dataset.loaded = '1';
      resolve();
    };
    s.onerror = () => reject(new Error(`스크립트 로드 실패: ${src}`));
    document.head.appendChild(s);
  });
}

/**
 * 라이브러리를 버리고 다음 getQz() 에서 새로 불러오게 한다.
 * qz-tray.js 는 최상위 `var qz` + `window.qz = qz` 라서 스크립트를 다시 실행하면
 * 내부 상태(_qz)가 완전히 새것으로 바뀐다. 갇힌 소켓 상태에서 벗어나는 유일한 방법.
 */
export function resetQzLibrary(): void {
  connectPromise = null;
  loadPromise = null;
  if (typeof window === 'undefined') return;
  try {
    document
      .querySelectorAll<HTMLScriptElement>(`script[src="${QZ_SRC}"]`)
      .forEach((s) => s.remove());
  } catch {
    /* 무시 */
  }
  window.qz = undefined;
}

/** qz 객체 확보 (필요 시 CDN 로드 + 초기화) */
export async function getQz(): Promise<any> {
  if (typeof window === 'undefined') {
    throw new Error('QZ Tray는 브라우저에서만 사용할 수 있습니다.');
  }
  if (window.qz) return window.qz;

  if (!loadPromise) {
    loadPromise = (async () => {
      await loadScript(SHA_SRC);
      await loadScript(QZ_SRC);
      const qz = window.qz;
      if (!qz) throw new Error('QZ Tray 라이브러리를 불러오지 못했습니다.');

      qz.api.setPromiseType((resolver: any) => new Promise(resolver));
      if (window.sha256) {
        qz.api.setSha256Type((data: any) => window.sha256(data));
      }

      // ── 요청 서명 (허용 창 제거) ──
      //   인증서: /api/qz/cert — 없으면(404) 익명 모드로 동작해 허용 창이 뜬다
      //   서명  : /api/qz/sign — 라이브러리가 만든 해시 문자열을 서버가 SHA512withRSA 로 서명
      qz.security.setCertificatePromise((resolve: any, reject: any) => {
        fetch('/api/qz/cert', { cache: 'no-store' })
          .then((r) => (r.ok ? r.text() : Promise.reject(new Error('인증서 미설정'))))
          .then(resolve, reject);
      });
      qz.security.setSignatureAlgorithm('SHA512');
      qz.security.setSignaturePromise((toSign: string) => (resolve: any, reject: any) => {
        fetch('/api/qz/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request: toSign }),
        })
          .then((r) => r.json())
          .then((j) => (j?.success ? resolve(j.signature) : reject(new Error(j?.error || '서명 실패'))))
          .catch(reject);
      });

      // 연결이 끊기면 캐시한 연결 약속을 버려서 다음 호출이 새로 연결하게 한다
      try {
        qz.websocket.setClosedCallbacks(() => {
          connectPromise = null;
        });
      } catch (err) {
        console.error('QZ 종료 콜백 등록 실패:', err);
      }

      return qz;
    })().catch((e) => {
      loadPromise = null; // 실패 시 재시도 가능하게
      throw e;
    });
  }
  return loadPromise;
}

// ============================================================
// 연결
// ============================================================

/** 실제 왕복 1회 — 지금 명령을 보낼 수 있는 상태인지 확인한다 (서명 불필요 호출) */
async function probe(qz: any): Promise<void> {
  await withTimeout(Promise.resolve(qz.api.getVersion()), PROBE_TIMEOUT_MS, 'QZ 응답 확인');
}

/**
 * sendData 가 붙을 때까지(= 핸드셰이크 완료까지) 기다린다.
 * isActive() 가 CONNECTING 도 true 로 보고하기 때문에 필요한 단계다.
 */
async function waitUntilReady(qz: any): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await probe(qz);
      return;
    } catch (err) {
      lastError = err;
      await sleep(READY_POLL_MS);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('QZ Tray 연결 준비 시간이 초과되었습니다.');
}

/** connect() 1회 — 라이브러리가 "이미 시도 중" 이라고 하면 그냥 기다리는 쪽으로 넘긴다 */
async function connectOnce(qz: any): Promise<void> {
  try {
    await withTimeout(
      Promise.resolve(qz.websocket.connect({ retries: 1, delay: 1 })),
      CONNECT_TIMEOUT_MS,
      'QZ Tray 연결'
    );
  } catch (err) {
    if (/has not returned yet/i.test(msgOf(err))) return; // 진행 중 → waitUntilReady 가 판정
    throw err;
  }
}

/**
 * QZ Tray 연결 (이미 쓸 수 있으면 그대로 재사용)
 *
 * 동시에 여러 번 불려도 실제 연결은 한 번만 한다.
 * 실패하면 라이브러리를 리셋해서 다음 호출이 깨끗한 상태에서 시작하게 한다.
 * (disconnect() 로 정리하려 들면 CLOSING 에 갇힌다 — 파일 상단 참고)
 */
export async function connectQz(): Promise<any> {
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    let qz = await getQz();
    try {
      if (!qz.websocket.isActive()) {
        try {
          await connectOnce(qz);
        } catch (err) {
          // 갇힌 소켓("previous disconnect", "already exists") → 새 라이브러리로 한 번 더
          if (!/previous disconnect|already exists/i.test(msgOf(err))) throw err;
          resetQzLibrary();
          qz = await getQz();
          await connectOnce(qz);
        }
      }
      await waitUntilReady(qz);
      return qz;
    } catch (err) {
      resetQzLibrary();
      throw err;
    }
  })();

  return connectPromise;
}

// ============================================================
// 조회 (읽기 전용 — 실패해도 재시도 안전)
// ============================================================

async function findPrinters(): Promise<string[]> {
  const qz = await connectQz();
  const found = await qz.printers.find();
  if (Array.isArray(found)) return found.map((p: unknown) => String(p));
  return found ? [String(found)] : [];
}

/**
 * 설치된 프린터 목록 (실패 시 예외)
 * 한 번만 재시도한다 — 연결마다 허용 창이 뜰 수 있어서 반복하면 사용자를 괴롭힌다.
 */
export async function listPrinters(): Promise<string[]> {
  try {
    return await findPrinters();
  } catch (err) {
    console.error('프린터 조회 실패 — 라이브러리를 리셋하고 한 번 더 시도합니다:', err);
    resetQzLibrary();
    return findPrinters();
  }
}

export interface PrinterInfo {
  name: string;
  /** 드라이버가 보고한 해상도 (dpi). 모르면 undefined */
  dpi?: number;
  driver?: string;
}

/**
 * 프린터 목록 + 해상도. printers.details() 가 dpi(density) 를 알려준다.
 * details 가 실패하는 QZ 버전이면 이름만 돌려준다.
 */
export async function listPrinterDetails(): Promise<PrinterInfo[]> {
  const names = await listPrinters();
  try {
    const qz = await connectQz();
    const details = await qz.printers.details();
    if (Array.isArray(details)) {
      const byName = new Map<string, PrinterInfo>();
      for (const d of details) {
        if (!d?.name) continue;
        const dpi = Number(d.density);
        byName.set(String(d.name), {
          name: String(d.name),
          dpi: Number.isFinite(dpi) && dpi > 0 ? dpi : undefined,
          driver: d.driver ? String(d.driver) : undefined,
        });
      }
      return names.map((n) => byName.get(n) ?? { name: n });
    }
  } catch (err) {
    console.error('프린터 상세 조회 실패 (이름만 사용):', err);
  }
  return names.map((n) => ({ name: n }));
}

/**
 * 연결 가능 여부 — 실패해도 예외를 던지지 않는다.
 * 프린터 조회로 실제 왕복 통신을 해봐야 확실하다.
 */
export async function isQzAvailable(): Promise<boolean> {
  try {
    await listPrinters();
    return true;
  } catch {
    return false;
  }
}

/** 기본 프린터명 */
export async function getDefaultPrinter(): Promise<string | null> {
  try {
    const qz = await connectQz();
    const p = await qz.printers.getDefault();
    return p ? String(p) : null;
  } catch {
    return null;
  }
}

// ============================================================
// 인쇄
// ============================================================

/**
 * RAW(TSPL) 인쇄
 *
 * ⚠️ print() 가 실패해도 재시도하지 않는다 — 프린터가 이미 일부를 받았을 수
 *    있어서 재시도하면 중복 인쇄가 된다.
 *    대신 전송 "직전" 에 왕복 확인을 한 번 해서, 끊긴 연결이면 그때 새로 맺는다.
 *    (확인 단계는 읽기 전용이라 실패해도 아무것도 인쇄되지 않는다)
 */
export async function printRaw(printerName: string, bytes: Uint8Array): Promise<void> {
  let qz = await connectQz();

  try {
    await probe(qz);
  } catch (err) {
    console.error('인쇄 직전 연결 확인 실패 — 다시 연결합니다:', err);
    resetQzLibrary();
    qz = await connectQz();
  }

  const cfg = qz.configs.create(printerName);
  await qz.print(cfg, [{ type: 'raw', format: 'base64', data: bytesToBase64(bytes) }]);
}

/** 연결 해제 (페이지 이탈 시 등 — 필수는 아님). 응답이 없으면 기다리지 않는다 */
export async function disconnectQz(): Promise<void> {
  connectPromise = null;
  if (typeof window === 'undefined') return;
  const qz = window.qz;
  try {
    if (qz?.websocket?.isActive?.()) {
      await withTimeout(
        Promise.resolve(qz.websocket.disconnect()),
        DISCONNECT_TIMEOUT_MS,
        'QZ 연결 해제'
      );
    }
  } catch {
    /* 이미 끊겼거나 응답 없음 */
  }
}
