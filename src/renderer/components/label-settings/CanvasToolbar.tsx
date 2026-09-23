
import React from 'react';
import { useTranslation } from '../../utils/label/i18n';
import type { LabelElement } from '../../utils/label/labelTypes';

// ============================================================
// 캔버스 툴바 — 요소 추가 · 정렬 · 되돌리기 · 화면 배율
//
// 저장/삭제/테스트출력 같은 "템플릿 전체" 동작은 페이지 상단 헤더에 있다.
// 여기는 캔버스에서 손이 자주 가는 것만 둔다.
// 문구는 utils/label/ko.json 의 labelSettings.toolbar.*
// ============================================================

export type AlignAction = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

const ADD_TYPES: LabelElement['type'][] = ['text', 'barcode', 'qr', 'box', 'line', 'image'];

const ALIGN_BUTTONS: { action: AlignAction; label: string }[] = [
  { action: 'left', label: '⇤' },
  { action: 'hcenter', label: '↔' },
  { action: 'right', label: '⇥' },
  { action: 'top', label: '⇑' },
  { action: 'vcenter', label: '↕' },
  { action: 'bottom', label: '⇓' },
];

const SNAP_VALUES = [0, 0.5, 1];

interface Props {
  onAdd: (type: LabelElement['type']) => void;
  scale: number;
  onScale: (v: number) => void;
  onFit: () => void;
  showGrid: boolean;
  onShowGrid: (v: boolean) => void;
  snapMm: number;
  onSnapMm: (v: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  hasSelection: boolean;
  onAlign: (a: AlignAction) => void;
}

const CanvasToolbar: React.FC<Props> = ({
  onAdd,
  scale,
  onScale,
  onFit,
  showGrid,
  onShowGrid,
  snapMm,
  onSnapMm,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hasSelection,
  onAlign,
}) => {
  const { t } = useTranslation();

  return (
    <div className="lc-toolbar">
      {/* 요소 추가 */}
      <div className="lc-tool-group">
        {ADD_TYPES.map((type) => (
          <button key={type} className="ls-btn-sm" onClick={() => onAdd(type)}>
            + {t(`labelSettings.toolbar.add.${type}`)}
          </button>
        ))}
      </div>

      <span className="lc-sep" />

      {/* 정렬 */}
      <div className="lc-tool-group">
        {ALIGN_BUTTONS.map((b) => (
          <button
            key={b.action}
            className="ls-btn-icon"
            title={t(`labelSettings.toolbar.align.${b.action}`)}
            disabled={!hasSelection}
            onClick={() => onAlign(b.action)}
          >
            {b.label}
          </button>
        ))}
      </div>

      <span className="lc-sep" />

      {/* 되돌리기 */}
      <div className="lc-tool-group">
        <button
          className="ls-btn-icon"
          title={t('labelSettings.toolbar.undo')}
          disabled={!canUndo}
          onClick={onUndo}
        >
          ↶
        </button>
        <button
          className="ls-btn-icon"
          title={t('labelSettings.toolbar.redo')}
          disabled={!canRedo}
          onClick={onRedo}
        >
          ↷
        </button>
      </div>

      <span className="lc-spacer" />

      {/* 화면 배율 · 격자 · 스냅 */}
      <div className="lc-tool-group">
        <label className="lc-inline">
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => onShowGrid(e.target.checked)}
          />
          {t('labelSettings.toolbar.grid')}
        </label>

        <label className="lc-inline">
          {t('labelSettings.toolbar.snap')}
          <select value={snapMm} onChange={(e) => onSnapMm(Number(e.target.value))}>
            {SNAP_VALUES.map((v) => (
              <option key={v} value={v}>
                {v === 0 ? t('labelSettings.toolbar.snapFree') : `${v}mm`}
              </option>
            ))}
          </select>
        </label>

        <label className="lc-inline lc-zoom">
          {t('labelSettings.toolbar.zoom')}
          <input
            type="range"
            min={3}
            max={20}
            step={0.5}
            value={scale}
            onChange={(e) => onScale(Number(e.target.value))}
          />
          <span className="lc-zoom-val">{scale.toFixed(1)}×</span>
        </label>

        <button className="ls-btn-sm" onClick={onFit}>
          {t('labelSettings.toolbar.fit')}
        </button>
      </div>
    </div>
  );
};

export default CanvasToolbar;
