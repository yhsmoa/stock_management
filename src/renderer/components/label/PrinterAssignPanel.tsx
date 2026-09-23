import React from 'react';
import { useTranslation } from '../../utils/label/i18n';
import type { LabelTemplate } from '../../utils/label/labelTypes';
import type { PrinterAssignments } from './usePrinterAssignments';
import './PrinterAssignPanel.css';

// ============================================================
// 이 PC 프린터 — 지금 고른 템플릿마다 한 줄씩
//
//   이 PC 프린터                         [다시 찾기]
//   아이엠몽 스티커 라벨 50×70   [ BIXOLON SLP-DX4 · 203dpi ▾ ]
//   아이엠몽 케어라벨 40×70      [ (지정 안 함)             ▾ ]  ← 빨간 테두리
//       ⚠ 프린터 203dpi · 템플릿 300dpi — 크기가 달라집니다        ← 해상도가 다를 때
//
// 지정값은 [라벨 설정] 프린터 탭과 같은 저장소에 남는다 (usePrinterAssignments).
// ============================================================

interface Props {
  /** 지금 인쇄에 쓰일 템플릿 (중복 없이) */
  templates: LabelTemplate[];
  printers: PrinterAssignments;
  disabled?: boolean;
}

const PrinterAssignPanel: React.FC<Props> = ({ templates, printers, disabled }) => {
  const { t } = useTranslation();
  const { qzOk, printers: list, errorDetail, map, refresh, assign } = printers;

  if (templates.length === 0) return null;

  return (
    <div className="epp-root">
      <div className="epp-head">
        <span className="epp-title">{t('print.printerTitle')}</span>
        <button type="button" className="epp-refresh" onClick={refresh} disabled={qzOk === null}>
          {t('print.printerRefresh')}
        </button>
      </div>

      {templates.map((tpl) => {
        const current = map[tpl.id] ?? '';
        const info = current ? list.find((p) => p.name === current) : undefined;
        const known = !current || !!info;
        // 해상도가 다르면 라벨이 확대/축소돼 나온다 — 막지는 않고 알려만 준다
        const dpiMismatch = !!info?.dpi && info.dpi !== tpl.dpi;
        return (
          <div className="epp-row-wrap" key={tpl.id}>
            <div className="epp-row">
              <span className="epp-name" title={tpl.name}>
                {tpl.name}
              </span>
              <select
                className={!current || !known ? 'is-missing' : ''}
                value={current}
                disabled={disabled || !qzOk}
                onChange={(e) => assign(tpl.id, e.target.value)}
              >
                <option value="">{qzOk === null ? t('print.printerLoading') : t('print.printerNone')}</option>
                {list.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.dpi ? `${p.name} · ${p.dpi}dpi` : p.name}
                  </option>
                ))}
                {current && !known && (
                  <option value={current}>{t('print.printerMissingOnPc', { name: current })}</option>
                )}
              </select>
            </div>
            {dpiMismatch && (
              <div className="epp-row-warn">
                {t('print.dpiMismatch', { printerDpi: info!.dpi!, tplDpi: tpl.dpi })}
              </div>
            )}
          </div>
        );
      })}

      {qzOk === false && (
        <div className="epp-warn">
          {t('print.qzNotRunning')}
          {errorDetail && <div className="epp-detail">({errorDetail})</div>}
        </div>
      )}
      <div className="epp-hint">{t('print.printerHint')}</div>
    </div>
  );
};

export default PrinterAssignPanel;
