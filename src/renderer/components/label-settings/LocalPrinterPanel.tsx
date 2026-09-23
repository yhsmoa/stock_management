
import React, { useEffect, useState } from 'react';
import { useTranslation } from '../../utils/label/i18n';
import type { LabelTemplate } from '../../utils/label/labelTypes';
import type { PrinterInfo } from '../../utils/label/qzTray';
import { getAllLocalPrinters, setLocalPrinter } from '../../utils/label/localPrinterMap';
import { useAudiencesLabel } from './TemplateListPanel';

// ============================================================
// 프린터 — 템플릿 보드(TemplateBoard)의 "프린터" 탭 내용.
//
// PC-NO(자리 번호) 개념이 없다. 대신 템플릿마다 "이 PC 에서 어떤 프린터로
// 뽑을지" 를 브라우저에 저장한다(utils/label/localPrinterMap.ts) — 다른 PC 에는
// 전혀 영향을 안 준다. 같은 템플릿이라도 PC 마다 따로 지정해야 한다.
//
// 이 탭은 현재 편집 중인 템플릿 하나가 아니라 "전체 템플릿 목록" 을 보여준다 —
// 이 PC 를 처음 쓰기 시작할 때 한 번에 전부 지정해 두라는 뜻.
//
// 여기 지정값은 상품관리 [라벨출력] 모달(PrinterAssignPanel)과 같은 저장소다 —
// 어느 쪽에서 지정해도 다른 쪽에 그대로 보인다.
// ============================================================

const SAVED_FLASH_MS = 1800;

const printerLabel = (p: PrinterInfo) => (p.dpi ? `${p.name} · ${p.dpi}dpi` : p.name);

interface Props {
  templates: LabelTemplate[];
  qzOk: boolean | null;
  qzPrinters: PrinterInfo[];
  onRefreshQz: () => void;
}

const LocalPrinterPanel: React.FC<Props> = ({ templates, qzOk, qzPrinters, onRefreshQz }) => {
  const { t } = useTranslation();
  const audiencesLabel = useAudiencesLabel();
  const [map, setMap] = useState<Record<string, string>>({});
  const [flashId, setFlashId] = useState<string | null>(null);

  // 이 PC 의 저장값은 localStorage 라 마운트 시 한 번 읽는다 (SSR 에서는 빈 값)
  useEffect(() => {
    setMap(getAllLocalPrinters());
  }, []);

  useEffect(() => {
    if (!flashId) return;
    const timer = setTimeout(() => setFlashId(null), SAVED_FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashId]);

  const handleChange = (templateId: string, printerName: string) => {
    setLocalPrinter(templateId, printerName);
    setMap((prev) => {
      const next = { ...prev };
      if (printerName) next[templateId] = printerName;
      else delete next[templateId];
      return next;
    });
    setFlashId(templateId);
  };

  return (
    <>
      <div className="ls-panel-inline-title">
        {t('labelSettings.printer.title')}
        <button className="ls-btn-ghost ls-btn-xs" onClick={onRefreshQz}>
          {t('labelSettings.printer.refresh')}
        </button>
      </div>

      <div className="ls-hint ls-mb8">{t('labelSettings.printer.hint')}</div>

      {templates.length === 0 ? (
        <div className="ls-empty">{t('labelSettings.printer.empty')}</div>
      ) : (
        <table className="ls-map-table">
          <thead>
            <tr>
              <th>{t('labelSettings.printer.colTemplate')}</th>
              <th>{t('labelSettings.printer.colPrinter')}</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((tpl) => {
              const current = map[tpl.id] ?? '';
              const known = current ? qzPrinters.some((p) => p.name === current) : true;
              return (
                <tr key={tpl.id}>
                  <td>
                    <div className="ls-map-tpl-name">{tpl.name}</div>
                    {tpl.description && <div className="ls-map-tpl-desc">{tpl.description}</div>}
                    <div className="ls-map-tpl-meta">
                      {t(`labelSettings.typeShort.${tpl.label_type}`)} ·{' '}
                      {audiencesLabel(tpl)} ·{' '}
                      {tpl.dpi}dpi
                    </div>
                  </td>
                  <td>
                    <select
                      value={current}
                      onChange={(e) => handleChange(tpl.id, e.target.value)}
                      disabled={!qzOk}
                      className={!known ? 'is-missing' : ''}
                    >
                      <option value="">{t('labelSettings.printer.none')}</option>
                      {qzPrinters.map((p) => (
                        <option key={p.name} value={p.name}>
                          {printerLabel(p)}
                        </option>
                      ))}
                      {current && !known && (
                        <option value={current}>
                          {t('labelSettings.printer.missingOnPc', { name: current })}
                        </option>
                      )}
                    </select>
                    {flashId === tpl.id && (
                      <span className="ls-map-saved">{t('labelSettings.printer.savedFlash')}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="ls-hint ls-mt8">
        {t('labelSettings.printer.setup1')}{' '}
        <a href="/api/qz/cert?download=1" download="override.crt">
          {t('labelSettings.printer.setupLink')}
        </a>{' '}
        {t('labelSettings.printer.setup2')}
      </div>

      {qzOk === false && (
        <div className="ls-warn">
          {t('labelSettings.printer.notRunning')}
          <br />
          {t('labelSettings.printer.blockedHint')}
        </div>
      )}
      {qzOk === null && <div className="ls-warn">{t('labelSettings.printer.waitingHint')}</div>}
    </>
  );
};

export default LocalPrinterPanel;
