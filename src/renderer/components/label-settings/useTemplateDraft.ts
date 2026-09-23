
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  createElement,
  newElementId,
  type LabelElement,
  type LabelTemplate,
} from '../../utils/label/labelTypes';

// ============================================================
// 편집 중 템플릿(draft) 상태 + 되돌리기/다시하기
//
// 되돌리기 한 단계의 기준
//   · 요소 추가/삭제/복제/순서변경 · 규격 변경  → 즉시 1단계
//   · 드래그 이동                              → 드래그 1회가 1단계
//       (첫 transient 변경 때 "이전 상태"를 기록하고, 이후는 덮어쓴다)
//   · 숫자/텍스트 입력                          → 같은 항목을 연속 수정하면 1단계로 합침
//       (COALESCE_MS 안에 같은 key 로 들어온 변경은 묶는다)
//
// dirty 판정은 "마지막 저장 시점의 JSON" 과 비교한다.
// ============================================================

const HISTORY_MAX = 100;
const COALESCE_MS = 700;

export type ElementPatch = Partial<Record<string, unknown>>;

interface HistoryState {
  past: LabelTemplate[];
  present: LabelTemplate | null;
  future: LabelTemplate[];
}

const EMPTY: HistoryState = { past: [], present: null, future: [] };

export interface TemplateDraftApi {
  draft: LabelTemplate | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 새 draft 로 교체하고 저장 기준점도 리셋 (템플릿 선택/새로 만들기) */
  load: (tpl: LabelTemplate | null) => void;
  /** 저장 성공 후 — 서버가 돌려준 값으로 기준점만 갱신 */
  markSaved: (saved: LabelTemplate) => void;
  patchTemplate: (patch: Partial<LabelTemplate>, key?: string) => void;
  patchElement: (
    id: string,
    patch: ElementPatch,
    opts?: { commit?: boolean; key?: string }
  ) => void;
  /**
   * 여러 요소를 한 번에 patch — 다중 선택 드래그 이동용.
   * entries 전체가 되돌리기 한 단계(같은 드래그 세션 = 같은 id 조합)로 묶인다.
   */
  patchElements: (
    entries: { id: string; patch: ElementPatch }[],
    opts?: { commit?: boolean; key?: string }
  ) => void;
  /** overrides 로 초기값(예: 텍스트 영역 크기)을 덮어쓴다 */
  addElement: (type: LabelElement['type'], overrides?: ElementPatch) => string | null;
  removeElement: (id: string) => void;
  /** 다중 선택 삭제 — 전부 한 번에, 되돌리기 한 단계 */
  removeElements: (ids: string[]) => void;
  duplicateElement: (id: string) => string | null;
  /** 다중 선택 복제 — 전부 한 번에, 되돌리기 한 단계. 새로 생긴 id 목록을 돌려준다(선택 갱신용) */
  duplicateElements: (ids: string[]) => string[];
  /** dir: -1 = 뒤로(아래층), +1 = 앞으로(위층) */
  reorderElement: (id: string, dir: -1 | 1) => void;
  undo: () => void;
  redo: () => void;
}

export function useTemplateDraft(): TemplateDraftApi {
  const [state, setState] = useState<HistoryState>(EMPTY);
  const baselineRef = useRef<string>('');
  /**
   * 최신 present 의 거울.
   * setState 업데이터는 React 가 나중에(렌더 단계에서) 실행하므로,
   * "추가한 요소를 곧바로 선택" 같은 동기 판단에는 쓸 수 없다. 그래서 ref 로 읽는다.
   */
  const presentRef = useRef<LabelTemplate | null>(null);
  presentRef.current = state.present;
  /** 드래그 등 연속 변경이 진행 중인 대상 */
  const transientRef = useRef<string | null>(null);
  const coalesceRef = useRef<{ key: string; at: number } | null>(null);

  // ── 히스토리 반영 ──
  const apply = useCallback(
    (updater: (cur: LabelTemplate) => LabelTemplate, push: boolean) => {
      setState((s) => {
        if (!s.present) return s;
        const next = updater(s.present);
        if (next === s.present) return s;
        return push
          ? {
              past: [...s.past, s.present].slice(-HISTORY_MAX),
              present: next,
              future: [],
            }
          : { past: s.past, present: next, future: [] };
      });
    },
    []
  );

  /** key 가 같고 짧은 시간 안이면 한 단계로 합친다 */
  const shouldPush = useCallback((key?: string) => {
    const now = Date.now();
    if (!key) {
      coalesceRef.current = null;
      return true;
    }
    const prev = coalesceRef.current;
    coalesceRef.current = { key, at: now };
    return !(prev && prev.key === key && now - prev.at < COALESCE_MS);
  }, []);

  // ============================================================
  // draft 교체 / 저장 기준점
  // ============================================================
  const load = useCallback((tpl: LabelTemplate | null) => {
    transientRef.current = null;
    coalesceRef.current = null;
    baselineRef.current = tpl ? JSON.stringify(tpl) : '';
    presentRef.current = tpl;
    setState({ past: [], present: tpl, future: [] });
  }, []);

  const markSaved = useCallback((saved: LabelTemplate) => {
    baselineRef.current = JSON.stringify(saved);
    presentRef.current = saved;
    setState((s) => ({ ...s, present: saved }));
  }, []);

  // ============================================================
  // 템플릿 속성
  // ============================================================
  const patchTemplate = useCallback(
    (patch: Partial<LabelTemplate>, key?: string) => {
      apply((cur) => ({ ...cur, ...patch }), shouldPush(key));
    },
    [apply, shouldPush]
  );

  // ============================================================
  // 요소 — 단일/다중 patch 는 같은 로직을 공유한다 (patchElement 는 얇은 래퍼)
  // ============================================================
  const patchElements = useCallback(
    (
      entries: { id: string; patch: ElementPatch }[],
      opts?: { commit?: boolean; key?: string }
    ) => {
      if (entries.length === 0) return;
      const commit = opts?.commit ?? true;
      // 여러 id 의 드래그 세션을 하나로 식별 — 어떤 조합인지까지 키에 넣어야
      // "다른 다중선택으로 다시 드래그" 를 별개 되돌리기 단계로 잡는다.
      const sessionKey =
        entries.length === 1 ? entries[0].id : `multi:${entries.map((e) => e.id).sort().join(',')}`;
      let push: boolean;

      if (!commit) {
        // 연속 변경(드래그) — 첫 변경에서만 이전 상태를 기록
        push = transientRef.current !== sessionKey;
        transientRef.current = sessionKey;
        coalesceRef.current = null;
      } else if (transientRef.current === sessionKey) {
        // 연속 변경의 마지막 확정 — 이미 기록해 두었으므로 덮어쓴다
        push = false;
        transientRef.current = null;
      } else {
        push = shouldPush(opts?.key);
      }

      const patchMap = new Map(entries.map((e) => [e.id, e.patch]));
      apply(
        (cur) => ({
          ...cur,
          layout: cur.layout.map((el) => {
            const p = patchMap.get(el.id);
            return p ? ({ ...el, ...p } as LabelElement) : el;
          }),
        }),
        push
      );
    },
    [apply, shouldPush]
  );

  const patchElement = useCallback(
    (id: string, patch: ElementPatch, opts?: { commit?: boolean; key?: string }) => {
      patchElements([{ id, patch }], opts);
    },
    [patchElements]
  );

  const addElement = useCallback(
    (type: LabelElement['type'], overrides?: ElementPatch) => {
      if (!presentRef.current) return null;
      const el = { ...createElement(type), ...(overrides ?? {}) } as LabelElement;
      apply((cur) => ({ ...cur, layout: [...cur.layout, el] }), true);
      coalesceRef.current = null;
      return el.id;
    },
    [apply]
  );

  const removeElements = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      apply((cur) => ({ ...cur, layout: cur.layout.filter((el) => !idSet.has(el.id)) }), true);
      coalesceRef.current = null;
    },
    [apply]
  );

  const removeElement = useCallback((id: string) => removeElements([id]), [removeElements]);

  const duplicateElements = useCallback(
    (ids: string[]): string[] => {
      // 원본 존재 여부는 ref 로 미리 확인한다 (업데이터는 나중에 실행됨)
      const present = presentRef.current;
      if (!present) return [];
      const idSet = new Set(ids);
      const idToNewId = new Map(present.layout.filter((el) => idSet.has(el.id)).map((el) => [el.id, newElementId()]));
      if (idToNewId.size === 0) return [];

      apply((cur) => {
        const layout: LabelElement[] = [];
        for (const el of cur.layout) {
          layout.push(el);
          const newId = idToNewId.get(el.id);
          if (newId) {
            layout.push({
              ...el,
              id: newId,
              x_mm: Math.round((el.x_mm + 2) * 100) / 100,
              y_mm: Math.round((el.y_mm + 2) * 100) / 100,
            } as LabelElement);
          }
        }
        return { ...cur, layout };
      }, true);
      coalesceRef.current = null;
      return Array.from(idToNewId.values());
    },
    [apply]
  );

  const duplicateElement = useCallback(
    (id: string) => duplicateElements([id])[0] ?? null,
    [duplicateElements]
  );

  const reorderElement = useCallback(
    (id: string, dir: -1 | 1) => {
      apply((cur) => {
        const idx = cur.layout.findIndex((el) => el.id === id);
        const to = idx + dir;
        if (idx < 0 || to < 0 || to >= cur.layout.length) return cur;
        const layout = [...cur.layout];
        [layout[idx], layout[to]] = [layout[to], layout[idx]];
        return { ...cur, layout };
      }, true);
      coalesceRef.current = null;
    },
    [apply]
  );

  // ============================================================
  // 되돌리기 / 다시하기
  // ============================================================
  const undo = useCallback(() => {
    transientRef.current = null;
    coalesceRef.current = null;
    setState((s) => {
      if (s.past.length === 0 || !s.present) return s;
      const prev = s.past[s.past.length - 1];
      return {
        past: s.past.slice(0, -1),
        present: prev,
        future: [s.present, ...s.future].slice(0, HISTORY_MAX),
      };
    });
  }, []);

  const redo = useCallback(() => {
    transientRef.current = null;
    coalesceRef.current = null;
    setState((s) => {
      if (s.future.length === 0 || !s.present) return s;
      return {
        past: [...s.past, s.present].slice(-HISTORY_MAX),
        present: s.future[0],
        future: s.future.slice(1),
      };
    });
  }, []);

  const dirty = useMemo(() => {
    if (!state.present) return false;
    return JSON.stringify(state.present) !== baselineRef.current;
  }, [state.present]);

  return {
    draft: state.present,
    dirty,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    load,
    markSaved,
    patchTemplate,
    patchElement,
    patchElements,
    addElement,
    removeElement,
    removeElements,
    duplicateElement,
    duplicateElements,
    reorderElement,
    undo,
    redo,
  };
}
