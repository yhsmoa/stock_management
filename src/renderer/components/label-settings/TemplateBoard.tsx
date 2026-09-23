
import React, { useState } from 'react';
import { useTranslation } from '../../utils/label/i18n';
import type { LabelData, LabelTemplate, LabelType } from '../../utils/label/labelTypes';
import type { PrinterInfo } from '../../utils/label/qzTray';
import type { LabelUser } from './useLabelSettingsData';
import TemplateListPanel from './TemplateListPanel';
import TemplateInfoPanel from './TemplateInfoPanel';
import SampleDataPanel from './SampleDataPanel';
import LocalPrinterPanel from './LocalPrinterPanel';

// ============================================================
// 템플릿 보드 — 템플릿 목록 · 기본정보 · 미리보기 데이터 · 프린터를
// 탭 하나짜리 카드로 묶는다 (왼쪽 컬럼 상단, 그 아래에 요소 목록이 온다).
//
// 템플릿을 고르거나 새로 만들면 "기본정보" 탭으로 자동 전환한다 —
// 방금 고른/만든 템플릿을 바로 편집할 수 있게.
// ============================================================

type TabKey = 'list' | 'info' | 'sample' | 'printer';

const TABS: TabKey[] = ['list', 'info', 'sample', 'printer'];

interface Props {
  // 템플릿 탭
  templates: LabelTemplate[];
  users: LabelUser[];
  loading: boolean;
  filterType: LabelType | '';
  filterUserId: string;
  activeId: string | null;
  onFilterType: (v: LabelType | '') => void;
  onFilterUser: (v: string) => void;
  onPick: (tpl: LabelTemplate) => void;
  onCreate: (type: LabelType) => void;

  // 기본정보 탭
  draft: LabelTemplate | null;
  onPatchTemplate: (patch: Partial<LabelTemplate>, key?: string) => void;

  // 미리보기 데이터 탭
  sampleData: LabelData;
  onSampleDataChange: (next: LabelData) => void;

  // 프린터 탭
  qzOk: boolean | null;
  qzPrinters: PrinterInfo[];
  onRefreshQz: () => void;
}

const TemplateBoard: React.FC<Props> = ({
  templates,
  users,
  loading,
  filterType,
  filterUserId,
  activeId,
  onFilterType,
  onFilterUser,
  onPick,
  onCreate,
  draft,
  onPatchTemplate,
  sampleData,
  onSampleDataChange,
  qzOk,
  qzPrinters,
  onRefreshQz,
}) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>('list');

  const handlePick = (tpl: LabelTemplate) => {
    onPick(tpl);
    setTab('info');
  };

  const handleCreate = (type: LabelType) => {
    onCreate(type);
    setTab('info');
  };

  return (
    <section className="ls-panel ls-board">
      <div className="ls-tabs">
        {TABS.map((key) => (
          <button
            key={key}
            className={`ls-tab ${tab === key ? 'active' : ''}`}
            onClick={() => setTab(key)}
          >
            {t(`labelSettings.tabs.${key}`)}
          </button>
        ))}
      </div>

      <div className="ls-tab-body">
        {tab === 'list' && (
          <TemplateListPanel
            templates={templates}
            users={users}
            loading={loading}
            filterType={filterType}
            filterUserId={filterUserId}
            activeId={activeId}
            onFilterType={onFilterType}
            onFilterUser={onFilterUser}
            onPick={handlePick}
            onCreate={handleCreate}
          />
        )}

        {tab === 'info' &&
          (draft ? (
            <TemplateInfoPanel draft={draft} users={users} onPatch={onPatchTemplate} />
          ) : (
            <div className="ls-empty">{t('labelSettings.board.needPick')}</div>
          ))}

        {tab === 'sample' &&
          (draft ? (
            <SampleDataPanel data={sampleData} onChange={onSampleDataChange} />
          ) : (
            <div className="ls-empty">{t('labelSettings.board.needPickSample')}</div>
          ))}

        {tab === 'printer' && (
          <LocalPrinterPanel
            templates={templates}
            qzOk={qzOk}
            qzPrinters={qzPrinters}
            onRefreshQz={onRefreshQz}
          />
        )}
      </div>
    </section>
  );
};

export default TemplateBoard;
