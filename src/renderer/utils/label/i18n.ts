// ============================================================
// 라벨 화면 문구 — ko.json 조회 + {{변수}} 치환
//
// label-service(ko/zh, i18next)에서 옮겨 온 화면이라 호출부는 t('labelSettings.xxx', {...})
// 형태 그대로 둔다. 이 앱은 한국어만 쓰므로 i18next 대신 이 작은 조회 함수로 대신한다.
// 옮겨 온 코드가 쓰는 i18next 기능만 같은 동작으로 흉내 낸다:
//   · 키는 점(.)으로 중첩 객체를 따라간다 — 동적 키(`labelSettings.fields.${key}`)도 같다
//   · 값이 없으면 params.defaultValue, 그것도 없으면 키 문자열 그대로 (빠진 문구가 화면에 드러난다)
//   · {{name}} 은 params 의 값으로 바꾼다 (defaultValue 에도 적용). 없는 변수는 빈 문자열
//   · 복수형(_one/_other)·중첩($t)은 쓰지 않는다 — count 는 {{count}} 치환에만 쓰인다
//
// ⚠️ label-service 의 locales/ko.json 에서 labelSettings·print 만 가져왔다.
//    엔진 쪽(labelRender 경고, labelPrintService 오류)도 i18n 키를 돌려주므로 키 이름을 바꾸지 않는다.
// ============================================================

import ko from './ko.json';

type TextTree = { [key: string]: string | TextTree };
/** 치환값 — i18next 처럼 아무 값이나 받아 문자열로 바꾼다. defaultValue 는 키가 없을 때의 문구 */
export type TextParams = Record<string, unknown>;

const TEXTS = ko as TextTree;

/** 중첩 키 조회 — 문자열이 아니면 null */
function lookup(key: string): string | null {
  let node: string | TextTree | undefined = TEXTS;
  for (const part of key.split('.')) {
    if (node == null || typeof node === 'string') return null;
    node = node[part];
  }
  return typeof node === 'string' ? node : null;
}

/** {{name}} 치환 */
function interpolate(text: string, params?: TextParams): string {
  if (!params) return text;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
    params[name] == null ? '' : String(params[name])
  );
}

/** 키 → 문구 */
export function t(key: string, params?: TextParams): string {
  const found = lookup(key);
  if (found != null) return interpolate(found, params);
  const fallback = params?.defaultValue;
  return typeof fallback === 'string' ? interpolate(fallback, params) : key;
}

/** react-i18next 와 같은 모양 — 옮겨 온 컴포넌트의 `const { t } = useTranslation()` 을 그대로 쓰게 */
export function useTranslation(): { t: typeof t } {
  return { t };
}
