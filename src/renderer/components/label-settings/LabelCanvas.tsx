
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../utils/label/i18n';
import LabelPreview from './LabelPreview';
import type { LabelData, LabelElement, LabelTemplate } from '../../utils/label/labelTypes';
import { isTextBox } from '../../utils/label/labelTypes';
import { measureElement, rasterElement, type ElementBox } from '../../utils/label/labelRender';
import { useRasterVersion } from './useRasterVersion';

/** 캔버스가 요소마다 들고 있는 영역 정보 */
interface CanvasBox extends ElementBox {
  /** 영역 텍스트가 현재 샘플로 잘리는가 */
  clipped?: boolean;
}

// ============================================================
// 라벨 캔버스 — 드래그로 배치하는 편집 화면
//
// 구성 (겹쳐 놓는다)
//   1) LabelPreview  : 인쇄와 동일한 래스터 (아래층)
//   2) SVG 오버레이   : 격자 · 클릭 판정 · 선택 테두리 · 크기 핸들 · 마퀴 선택 (위층)
//   두 층 모두 같은 크기(mm × scale) 라 좌표가 정확히 겹친다.
//
// 좌표계
//   · SVG viewBox 는 mm 단위 (0 0 width_mm height_mm)
//   · 마우스 이동량(px) ÷ scale = 이동량(mm)
//
// 다중 선택
//   · 빈 곳을 드래그 = 마퀴(사각형) 선택 — 겹치는(잠금 제외) 요소 전부 선택
//   · Shift/Ctrl(Cmd)+클릭 = 선택 토글 (그 클릭 자체는 이동을 시작하지 않는다)
//   · 이미 여러 개가 선택된 상태에서 그중 하나를 수정 없이 드래그하면 전체가 같이 이동
//   · 크기 조절 핸들은 "정확히 1개" 선택했을 때만 나온다 (여러 개 동시 리사이즈는 지원 안 함)
// ============================================================

const RULER = 18; // 눈금자 두께 (px)
const HANDLE_PX = 8; // 크기 핸들 한 변 (px)
const MARQUEE_THRESHOLD_MM = 0.3; // 이 이상 움직여야 "드래그"로 인정 (클릭과 구분)

export type ElementPatch = Partial<Record<string, unknown>>;

interface LabelCanvasProps {
  template: LabelTemplate;
  data: LabelData;
  /** px per mm */
  scale: number;
  showGrid: boolean;
  /** 스냅 간격 (mm). 0 이면 스냅 없음 */
  snapMm: number;
  selectedIds: string[];
  /** 캔버스가 계산한 "새 선택 전체 목록"을 그대로 받는다 (교체든 토글이든 캔버스가 판단) */
  onSelect: (ids: string[]) => void;
  /**
   * 요소 변경(들). 여러 개를 한 번에 옮길 때는 배열에 전부 담아 한 번에 부른다
   * (되돌리기 한 단계로 묶기 위함).
   * commit=false → 드래그 중 (되돌리기 기록 없이 화면만 갱신)
   * commit=true  → 드래그 종료 (되돌리기 한 단계로 기록)
   */
  onElementsChange: (entries: { id: string; patch: ElementPatch }[], commit: boolean) => void;
}

type DragMode = 'move' | 'resize-e' | 'resize-s' | 'resize-se';

interface ElementDragState {
  kind: 'element';
  /** move 는 여러 개 가능, resize 는 항상 1개(선택 1개일 때만 핸들이 뜨므로) */
  ids: string[];
  mode: DragMode;
  startX: number;
  startY: number;
  origins: Map<string, { x_mm: number; y_mm: number }>;
  boxes: Map<string, ElementBox>;
  /** resize 계산의 기준이 되는 요소 (ids[0]과 동일) */
  primary: LabelElement;
  lastPatches: { id: string; patch: ElementPatch }[] | null;
}

interface MarqueeDragState {
  kind: 'marquee';
  startMmX: number;
  startMmY: number;
  curMmX: number;
  curMmY: number;
  /** 시작 시 Shift/Ctrl 이 눌려 있었는가 — true 면 기존 선택에 더한다 */
  additive: boolean;
  moved: boolean;
}

type DragState = ElementDragState | MarqueeDragState;

/** 값 정리 — 스냅 간격이 있으면 그 배수로, 없으면 0.1mm 로 */
function quantize(v: number, snapMm: number): number {
  const step = snapMm > 0 ? snapMm : 0.1;
  return Math.round(v / step) * step;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

/** 소수점 잔여 오차 제거 (0.30000000000000004 방지) */
function tidy(v: number): number {
  return Math.round(v * 100) / 100;
}

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id];
}

const LabelCanvas: React.FC<LabelCanvasProps> = ({
  template,
  data,
  scale,
  showGrid,
  snapMm,
  selectedIds,
  onSelect,
  onElementsChange,
}) => {
  const { t } = useTranslation();
  const W = template.width_mm;
  const H = template.height_mm;
  const cssW = Math.max(1, W * scale);
  const cssH = Math.max(1, H * scale);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  /** 마퀴 사각형을 화면에 그리기 위한 상태 (렌더가 필요해서 ref 가 아니라 state) */
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null
  );
  const rasterVersion = useRasterVersion();

  // ── 요소별 실제 점유 영역 (회전 반영) ──
  const boxes = useMemo(() => {
    const map = new Map<string, CanvasBox>();
    for (const el of template.layout || []) {
      const box = measureElement(el, template, data);
      // 영역 텍스트가 이 샘플로 잘리면 캔버스에 표시한다 (선택 안 해도 보이게)
      const clipped =
        el.type === 'text' &&
        (rasterElement(el, template, data)?.text?.clippedLines ?? 0) > 0;
      map.set(el.id, { ...box, clipped });
    }
    return map;
    // layout/규격/데이터가 바뀌거나 이미지가 늦게 읽히면 다시 측정
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, data, rasterVersion]);

  /** 클라이언트 px 좌표 → 이 캔버스의 mm 좌표 */
  const toMm = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
    },
    [scale]
  );

  // ============================================================
  // 요소 드래그 시작 (이동/크기조절)
  // ============================================================
  const startElementDrag = useCallback(
    (e: React.PointerEvent, el: LabelElement, mode: DragMode) => {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      e.preventDefault();
      e.stopPropagation();

      // Shift/Ctrl+클릭 = 선택 토글만 하고 끝 (같은 제스처로 이동을 시작하지 않는다)
      if (additive && mode === 'move') {
        onSelect(toggleId(selectedIds, el.id));
        return;
      }
      if (el.locked) {
        if (mode === 'move') onSelect([el.id]);
        return;
      }

      // 이미 여러 개가 선택돼 있고 그중 하나를 그대로 끌면 전체 이동, 아니면 단일 선택으로 교체
      const ids =
        mode === 'move' && selectedIds.length > 1 && selectedIds.includes(el.id)
          ? selectedIds
          : [el.id];
      if (ids.length === 1) onSelect(ids);

      const origins = new Map<string, { x_mm: number; y_mm: number }>();
      const elBoxes = new Map<string, ElementBox>();
      for (const id of ids) {
        const target = id === el.id ? el : template.layout.find((x) => x.id === id);
        if (!target) continue;
        origins.set(id, { x_mm: target.x_mm, y_mm: target.y_mm });
        elBoxes.set(id, boxes.get(id) ?? { x_mm: target.x_mm, y_mm: target.y_mm, w_mm: 5, h_mm: 5 });
      }

      dragRef.current = {
        kind: 'element',
        ids,
        mode,
        startX: e.clientX,
        startY: e.clientY,
        origins,
        boxes: elBoxes,
        primary: el,
        lastPatches: null,
      };
      setDragging(true);
    },
    [boxes, onSelect, selectedIds, template.layout]
  );

  // ============================================================
  // 마퀴(사각형) 선택 시작 — 빈 곳 드래그
  // ============================================================
  const startMarquee = useCallback(
    (e: React.PointerEvent) => {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      const { x, y } = toMm(e.clientX, e.clientY);
      dragRef.current = {
        kind: 'marquee',
        startMmX: x,
        startMmY: y,
        curMmX: x,
        curMmY: y,
        additive,
        moved: false,
      };
      setDragging(true);
    },
    [toMm]
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: PointerEvent) => {
      const st = dragRef.current;
      if (!st) return;

      if (st.kind === 'marquee') {
        const { x, y } = toMm(e.clientX, e.clientY);
        if (!st.moved && Math.hypot(x - st.startMmX, y - st.startMmY) > MARQUEE_THRESHOLD_MM) {
          st.moved = true;
        }
        st.curMmX = x;
        st.curMmY = y;
        const x0 = Math.min(st.startMmX, x);
        const y0 = Math.min(st.startMmY, y);
        setMarqueeRect({ x: x0, y: y0, w: Math.abs(x - st.startMmX), h: Math.abs(y - st.startMmY) });
        return;
      }

      const dx = (e.clientX - st.startX) / scale;
      const dy = (e.clientY - st.startY) / scale;

      if (st.mode === 'move') {
        const entries = st.ids.map((id) => {
          const origin = st.origins.get(id)!;
          const box = st.boxes.get(id)!;
          const x = clamp(quantize(origin.x_mm + dx, snapMm), 0, Math.max(0, W - box.w_mm));
          const y = clamp(quantize(origin.y_mm + dy, snapMm), 0, Math.max(0, H - box.h_mm));
          return { id, patch: { x_mm: tidy(x), y_mm: tidy(y) } as ElementPatch };
        });
        st.lastPatches = entries;
        onElementsChange(entries, false);
        return;
      }

      // ── 크기 조절 (선택 1개일 때만 진입) — 화면에 보이는 상자 크기를 먼저 정하고,
      //    회전이면 요소 고유 폭/높이로 되돌린다 ──
      const id = st.ids[0];
      const o = st.primary;
      const box = st.boxes.get(id)!;
      const resizeW = st.mode === 'resize-e' || st.mode === 'resize-se';
      const resizeH = st.mode === 'resize-s' || st.mode === 'resize-se';
      const screenW = resizeW
        ? clamp(quantize(box.w_mm + dx, snapMm), 1, Math.max(1, W - o.x_mm))
        : box.w_mm;
      const screenH = resizeH
        ? clamp(quantize(box.h_mm + dy, snapMm), 0.5, Math.max(0.5, H - o.y_mm))
        : box.h_mm;
      const swap = o.rotate === 90 || o.rotate === 270;
      const elW = swap ? screenH : screenW;
      const elH = swap ? screenW : screenH;

      let patch: ElementPatch | null = null;
      if (o.type === 'text') {
        patch = { max_w_mm: tidy(Math.max(2, elW)) };
        // 높이를 끌면 한 줄 텍스트도 영역(상자)이 된다
        if (isTextBox(o) || resizeH) patch.h_mm = tidy(Math.max(1, elH));
      } else if (o.type === 'barcode') {
        patch = {};
        if (resizeH) patch.h_mm = tidy(Math.max(2, elH));
        if (resizeW) patch.max_w_mm = tidy(Math.max(2, elW)); // 정렬 기준 영역 폭
      } else if (o.type === 'qr') {
        if (resizeW) patch = { max_w_mm: tidy(Math.max(2, elW)) };
      } else if (o.type === 'box' || o.type === 'line') {
        patch = { w_mm: tidy(Math.max(0.2, elW)), h_mm: tidy(Math.max(0.1, elH)) };
      } else if (o.type === 'image') {
        // 비율 유지면 가로 기준으로 세로를 따라가게 한다
        const keep = o.keep_ratio !== false && o.w_mm > 0 && o.h_mm > 0;
        const w = Math.max(1, elW);
        const h = keep ? (w * o.h_mm) / o.w_mm : Math.max(1, elH);
        patch = { w_mm: tidy(w), h_mm: tidy(h) };
      }

      if (!patch) return;
      const entries = [{ id, patch }];
      st.lastPatches = entries;
      onElementsChange(entries, false);
    };

    const handleUp = () => {
      const st = dragRef.current;
      if (st?.kind === 'element') {
        // 실제로 움직였을 때만 되돌리기 한 단계로 확정한다
        if (st.lastPatches) onElementsChange(st.lastPatches, true);
      } else if (st?.kind === 'marquee') {
        if (!st.moved) {
          // 그냥 클릭 — 빈 곳 클릭은 선택 해제, Shift/Ctrl+빈 곳 클릭은 유지
          if (!st.additive) onSelect([]);
        } else {
          const x0 = Math.min(st.startMmX, st.curMmX);
          const x1 = Math.max(st.startMmX, st.curMmX);
          const y0 = Math.min(st.startMmY, st.curMmY);
          const y1 = Math.max(st.startMmY, st.curMmY);
          const hit = (template.layout || [])
            .filter((el) => !el.hidden && !el.locked)
            .filter((el) => {
              const b = boxes.get(el.id);
              if (!b) return false;
              return b.x_mm < x1 && b.x_mm + b.w_mm > x0 && b.y_mm < y1 && b.y_mm + b.h_mm > y0;
            })
            .map((el) => el.id);
          onSelect(st.additive ? Array.from(new Set([...selectedIds, ...hit])) : hit);
        }
        setMarqueeRect(null);
      }
      dragRef.current = null;
      setDragging(false);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [dragging, scale, snapMm, W, H, onElementsChange, onSelect, toMm, template.layout, boxes, selectedIds]);

  // ============================================================
  // 요소 목록 클릭(list row) 이 아니라 캔버스 자체의 클릭 판정용 헬퍼
  // ============================================================
  const handleElementPointerDown = useCallback(
    (e: React.PointerEvent, el: LabelElement) => {
      startElementDrag(e, el, 'move');
    },
    [startElementDrag]
  );

  // ============================================================
  // 눈금자
  // ============================================================
  const ticks = (lengthMm: number) => {
    const out: { mm: number; major: boolean }[] = [];
    const step = scale >= 8 ? 1 : scale >= 4 ? 2 : 5;
    for (let mm = 0; mm <= Math.ceil(lengthMm); mm += step) {
      out.push({ mm, major: mm % 10 === 0 });
    }
    return out;
  };

  const rulerFont = 8;

  // ============================================================
  // 렌더링
  // ============================================================
  const handleMm = HANDLE_PX / scale;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const singleSelected =
    selectedIds.length === 1 ? template.layout.find((el) => el.id === selectedIds[0]) ?? null : null;

  return (
    <div className="lc-frame" style={{ gridTemplateColumns: `${RULER}px ${cssW}px` }}>
      {/* 좌상단 모서리 */}
      <div className="lc-corner" style={{ width: RULER, height: RULER }} />

      {/* 가로 눈금자 */}
      <svg className="lc-ruler lc-ruler-x" width={cssW} height={RULER}>
        {ticks(W).map(({ mm, major }) => (
          <g key={mm}>
            <line
              x1={mm * scale}
              y1={major ? 4 : RULER - 5}
              x2={mm * scale}
              y2={RULER}
              stroke="#9ca3af"
              strokeWidth={1}
            />
            {major && (
              <text x={mm * scale + 2} y={rulerFont + 1} fontSize={rulerFont} fill="#6b7280">
                {mm}
              </text>
            )}
          </g>
        ))}
      </svg>

      {/* 세로 눈금자 */}
      <svg className="lc-ruler lc-ruler-y" width={RULER} height={cssH}>
        {ticks(H).map(({ mm, major }) => (
          <g key={mm}>
            <line
              x1={major ? 4 : RULER - 5}
              y1={mm * scale}
              x2={RULER}
              y2={mm * scale}
              stroke="#9ca3af"
              strokeWidth={1}
            />
            {major && (
              <text x={1} y={mm * scale + rulerFont + 1} fontSize={rulerFont} fill="#6b7280">
                {mm}
              </text>
            )}
          </g>
        ))}
      </svg>

      {/* 라벨 본체 */}
      <div className="lc-stage" style={{ width: cssW, height: cssH }}>
        <LabelPreview template={template} data={data} scale={scale} className="lc-paper" />

        <svg
          ref={svgRef}
          className="lc-overlay"
          width={cssW}
          height={cssH}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
        >
          {/* 빈 곳 드래그 = 마퀴 선택, 그냥 클릭 = 선택 해제 (pointerup 에서 판단) */}
          <rect
            x={0}
            y={0}
            width={W}
            height={H}
            fill="transparent"
            onPointerDown={startMarquee}
          />

          {/* 격자 */}
          {showGrid && (
            <g pointerEvents="none">
              {Array.from({ length: Math.floor(W) }, (_, i) => i + 1).map((mm) => (
                <line
                  key={`gx${mm}`}
                  x1={mm}
                  y1={0}
                  x2={mm}
                  y2={H}
                  stroke={mm % 5 === 0 ? '#c7d2fe' : '#e5e7eb'}
                  strokeWidth={0.06}
                />
              ))}
              {Array.from({ length: Math.floor(H) }, (_, i) => i + 1).map((mm) => (
                <line
                  key={`gy${mm}`}
                  x1={0}
                  y1={mm}
                  x2={W}
                  y2={mm}
                  stroke={mm % 5 === 0 ? '#c7d2fe' : '#e5e7eb'}
                  strokeWidth={0.06}
                />
              ))}
            </g>
          )}

          {/* 요소 클릭 판정 — 배열 순서대로 그려서 뒤쪽이 위에 온다 */}
          {(template.layout || []).map((el) => {
            if (el.hidden) return null;
            const box = boxes.get(el.id);
            if (!box) return null;
            const isBoxText = el.type === 'text' && isTextBox(el);
            return (
              <g key={el.id}>
                {/* 영역 텍스트는 상자 윤곽을 늘 옅게 보여준다 — "여기가 글이 흐르는 범위" */}
                {isBoxText && (
                  <rect
                    x={box.x_mm}
                    y={box.y_mm}
                    width={box.w_mm}
                    height={box.h_mm}
                    fill="none"
                    stroke={box.clipped ? '#f87171' : '#c7d2fe'}
                    strokeWidth={0.1}
                    strokeDasharray="0.4 0.3"
                    pointerEvents="none"
                  />
                )}
                <rect
                  x={box.x_mm}
                  y={box.y_mm}
                  width={Math.max(box.w_mm, 0.8)}
                  height={Math.max(box.h_mm, 0.8)}
                  fill="transparent"
                  style={{ cursor: el.locked ? 'not-allowed' : 'move' }}
                  onPointerDown={(e) => handleElementPointerDown(e, el)}
                />
                {/* 잘림 표시 — 우하단 빨간 귀퉁이 */}
                {box.clipped && (
                  <path
                    d={`M ${box.x_mm + box.w_mm} ${box.y_mm + box.h_mm - 1.6} L ${box.x_mm + box.w_mm} ${box.y_mm + box.h_mm} L ${box.x_mm + box.w_mm - 1.6} ${box.y_mm + box.h_mm} Z`}
                    fill="#ef4444"
                    pointerEvents="none"
                  >
                    <title>{t('labelSettings.canvas.clippedTitle')}</title>
                  </path>
                )}
              </g>
            );
          })}

          {/* 선택 표시 (여러 개 가능) */}
          {(template.layout || []).map((el) => {
            if (!selectedSet.has(el.id) || el.hidden) return null;
            const box = boxes.get(el.id);
            if (!box) return null;
            const outOfBounds =
              box.x_mm + box.w_mm > W + 0.05 || box.y_mm + box.h_mm > H + 0.05;
            return (
              <rect
                key={`sel_${el.id}`}
                x={box.x_mm}
                y={box.y_mm}
                width={Math.max(box.w_mm, 0.8)}
                height={Math.max(box.h_mm, 0.8)}
                fill="none"
                stroke={outOfBounds ? '#dc2626' : '#2563eb'}
                strokeWidth={0.18}
                strokeDasharray="0.7 0.4"
                pointerEvents="none"
              />
            );
          })}

          {/* 크기 조절 핸들 — 정확히 1개 선택했을 때만 */}
          {singleSelected &&
            !singleSelected.hidden &&
            (() => {
              const el = singleSelected;
              const box = boxes.get(el.id);
              if (!box) return null;
              const rotated = !!el.rotate;

              const handle = (cx: number, cy: number, mode: DragMode, cursor: string) => (
                <rect
                  key={mode}
                  x={cx - handleMm / 2}
                  y={cy - handleMm / 2}
                  width={handleMm}
                  height={handleMm}
                  fill="#fff"
                  stroke="#2563eb"
                  strokeWidth={0.12}
                  style={{ cursor }}
                  onPointerDown={(e) => startElementDrag(e, el, mode)}
                />
              );

              return (
                <g>
                  {/* 텍스트: 오른쪽(폭) · 아래(높이) · 모서리(대각선) — 회전돼도 화면 기준으로 동작 */}
                  {!el.locked && el.type === 'text' && (
                    <>
                      {handle(box.x_mm + box.w_mm, box.y_mm + box.h_mm / 2, 'resize-e', 'ew-resize')}
                      {handle(box.x_mm + box.w_mm / 2, box.y_mm + box.h_mm, 'resize-s', 'ns-resize')}
                      {handle(box.x_mm + box.w_mm, box.y_mm + box.h_mm, 'resize-se', 'nwse-resize')}
                    </>
                  )}
                  {/* 바코드: 아래(높이) · 오른쪽(정렬 영역 폭, 정렬이 켜진 경우) */}
                  {!el.locked && !rotated && el.type === 'barcode' && (
                    <>
                      {handle(box.x_mm + box.w_mm / 2, box.y_mm + box.h_mm, 'resize-s', 'ns-resize')}
                      {(el.align ?? 'left') !== 'left' &&
                        handle(box.x_mm + box.w_mm, box.y_mm + box.h_mm / 2, 'resize-e', 'ew-resize')}
                    </>
                  )}
                  {!el.locked && !rotated && el.type === 'qr' && (el.align ?? 'left') !== 'left' &&
                    handle(box.x_mm + box.w_mm, box.y_mm + box.h_mm / 2, 'resize-e', 'ew-resize')}
                  {!el.locked && (el.type === 'box' || el.type === 'line' || el.type === 'image') &&
                    handle(box.x_mm + box.w_mm, box.y_mm + box.h_mm, 'resize-se', 'nwse-resize')}
                </g>
              );
            })()}

          {/* 마퀴 선택 사각형 */}
          {marqueeRect && (
            <rect
              x={marqueeRect.x}
              y={marqueeRect.y}
              width={marqueeRect.w}
              height={marqueeRect.h}
              fill="#2563eb15"
              stroke="#2563eb"
              strokeWidth={0.15}
              strokeDasharray="0.5 0.3"
              pointerEvents="none"
            />
          )}
        </svg>
      </div>
    </div>
  );
};

export default LabelCanvas;
