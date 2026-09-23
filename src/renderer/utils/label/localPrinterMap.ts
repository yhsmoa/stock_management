// ============================================================
// 템플릿별 로컬 프린터 매핑 — "이 템플릿을 이 PC 에서 어떤 프린터로 뽑을지"
//
// 왜 서버(Supabase)가 아니라 브라우저에 저장하나
//   같은 물리 프린터도 PC 마다 QZ Tray 에 보이는 이름이 다르다
//   (예: A PC 에선 "Deli DL-720C", B PC 에선 "\\A-PC\DL-720C 공유").
//   그래서 "자리 번호 → 프린터명" 을 서버에 저장하는 옛 방식(label_printers 테이블,
//   PC-NO 1~4)은 PC 가 바뀌거나 프린터를 재설치하면 깨졌다.
//   대신 각 PC 가 "템플릿 X 는 이 프린터" 를 스스로 한 번만 기억하게 한다 —
//   PC-NO 개념 자체가 필요 없어진다.
//
// 키는 템플릿 id 다. 템플릿을 지우고 새로 만들면 그 PC 에서 다시 지정해야 한다
// (id 가 바뀌므로) — 템플릿 구조를 자주 안 바꾸는 편이라 감수할 만한 트레이드오프.
//
// [라벨 설정] 프린터 탭과 상품관리 [라벨출력] 모달이 같은 저장소(이 앱의 origin)를 쓴다 —
// 어느 쪽에서 지정해도 다른 쪽에 그대로 보인다.
// (label-service 시절에는 iframe 저장소가 분리돼 따로 지정해야 했다 — 이 앱에는 해당 없음)
// ============================================================

const STORAGE_KEY = 'ls_local_printer_map_v1';

/** 프린터 미지정 시 안내 문구 — printLabels() 등에서 재사용 */
export const LOCAL_PRINTER_HELP =
  '[라벨 설정] > 프린터 탭에서 이 템플릿을 이 PC 의 어떤 프린터로 뽑을지 먼저 지정해주세요.';

/**
 * localStorage 를 만질 수 있는지.
 * 브라우저 설정(사이트 데이터 차단 등)에 따라 `window.localStorage` 를 읽는 것만으로
 * SecurityError 가 날 수 있어 try 안에서 확인한다 — 여기서 던지면 호출부 화면이 통째로 죽는다.
 */
function canUseStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function readAll(): Record<string, string> {
  if (!canUseStorage()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.error('로컬 프린터 매핑 읽기 실패:', err);
    return {};
  }
}

function writeAll(map: Record<string, string>): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    console.error('로컬 프린터 매핑 저장 실패:', err);
  }
}

/** 템플릿 id → 이 PC 에서 쓸 프린터명 전체 목록 */
export function getAllLocalPrinters(): Record<string, string> {
  return readAll();
}

/** 특정 템플릿의 이 PC 프린터명 (없으면 null) */
export function getLocalPrinter(templateId: string): string | null {
  const map = readAll();
  return map[templateId] || null;
}

/** 템플릿의 이 PC 프린터 지정. printerName 이 빈 문자열이면 지정 해제 */
export function setLocalPrinter(templateId: string, printerName: string): void {
  const map = readAll();
  if (printerName) {
    map[templateId] = printerName;
  } else {
    delete map[templateId];
  }
  writeAll(map);
}

/** 템플릿이 삭제됐을 때 그 매핑도 같이 정리 (안 해도 무해하지만 깔끔하게) */
export function removeLocalPrinter(templateId: string): void {
  const map = readAll();
  if (templateId in map) {
    delete map[templateId];
    writeAll(map);
  }
}
