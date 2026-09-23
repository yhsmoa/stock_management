
import React from 'react';
import { useTranslation } from '../../utils/label/i18n';
import {
  LABEL_AUDIENCES,
  isSharedTemplate,
  templateAudiences,
  type LabelTemplate,
  type LabelType,
} from '../../utils/label/labelTypes';
import type { LabelUser } from './useLabelSettingsData';

// ============================================================
// 템플릿 목록 — 템플릿 보드(TemplateBoard)의 "템플릿" 탭 내용.
//   종류/범위(전체·내 것·공용)로 걸러서 고르고, 여기서 새 템플릿을 만든다.
//   목록은 서버가 이미 "내 것 + 공용" 으로 걸러서 준다 — 다른 계정 템플릿은 오지 않는다.
//   카드 테두리·탭 전환은 TemplateBoard 가 담당하므로 여기는 내용만 그린다.
// ============================================================

/** 라벨 종류 키 — 이름은 t(`labelSettings.types.${key}`) */
export const LABEL_TYPE_KEYS: LabelType[] = ['barcode', 'care'];

/** 범위 필터 값 */
export const SCOPE_MINE = '__mine__';
export const SCOPE_SHARED = '__common__';

/** 대상 표기 "성인·키즈" 를 현재 언어로 */
export function useAudiencesLabel() {
  const { t } = useTranslation();
  return (tpl: Pick<LabelTemplate, 'audiences'>) => {
    const set = templateAudiences(tpl);
    return LABEL_AUDIENCES.filter((a) => set.includes(a.key))
      .map((a) => t(`labelSettings.audience.${a.key}`))
      .join('·');
  };
}

interface Props {
  templates: LabelTemplate[];
  /** 로그인한 계정 (배열이지만 1명) */
  users: LabelUser[];
  loading: boolean;
  filterType: LabelType | '';
  /** '' 전체 · SCOPE_MINE 내 것 · SCOPE_SHARED 공용 */
  filterUserId: string;
  activeId: string | null;
  onFilterType: (v: LabelType | '') => void;
  onFilterUser: (v: string) => void;
  onPick: (tpl: LabelTemplate) => void;
  onCreate: (type: LabelType) => void;
}

const TemplateListPanel: React.FC<Props> = ({
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
}) => {
  const { t } = useTranslation();
  const audiencesLabel = useAudiencesLabel();
  const me = users[0] ?? null;
  const isMine = (tpl: LabelTemplate) => !!me && !!tpl.user_ids?.includes(me.id);

  const visible = templates.filter((tpl) => {
    if (filterType && tpl.label_type !== filterType) return false;
    if (filterUserId === SCOPE_SHARED) return isSharedTemplate(tpl);
    if (filterUserId === SCOPE_MINE) return isMine(tpl);
    return true;
  });

  /** 메타 줄의 범위 표기: 공용 / 내 템플릿 */
  const ownerLabel = (tpl: LabelTemplate) => {
    if (isSharedTemplate(tpl)) return t('labelSettings.list.shared');
    return isMine(tpl) ? t('labelSettings.list.mine') : t('labelSettings.list.assignedUser');
  };

  return (
    <>
      <div className="ls-row-2">
        <select value={filterType} onChange={(e) => onFilterType(e.target.value as LabelType | '')}>
          <option value="">{t('labelSettings.list.allTypes')}</option>
          {LABEL_TYPE_KEYS.map((key) => (
            <option key={key} value={key}>
              {t(`labelSettings.types.${key}`)}
            </option>
          ))}
        </select>
        <select value={filterUserId} onChange={(e) => onFilterUser(e.target.value)}>
          <option value="">{t('labelSettings.list.filterAll')}</option>
          <option value={SCOPE_MINE}>{t('labelSettings.list.mine')}</option>
          <option value={SCOPE_SHARED}>{t('labelSettings.list.shared')}</option>
        </select>
      </div>

      <div className="ls-row-2 ls-mt8">
        <button className="ls-btn-sm" onClick={() => onCreate('barcode')}>
          {t('labelSettings.list.newBarcode')}
        </button>
        <button className="ls-btn-sm" onClick={() => onCreate('care')}>
          {t('labelSettings.list.newCare')}
        </button>
      </div>

      <div className="ls-list-items">
        {loading ? (
          <div className="ls-empty">{t('labelSettings.list.loading')}</div>
        ) : visible.length === 0 ? (
          <div className="ls-empty">{t('labelSettings.list.empty')}</div>
        ) : (
          visible.map((tpl) => (
            <button
              key={tpl.id}
              className={`ls-list-item ${activeId === tpl.id ? 'active' : ''}`}
              onClick={() => onPick(tpl)}
            >
              <span className="ls-item-name">
                {tpl.name}
                {tpl.is_default && (
                  <span className="ls-default-badge">{t('labelSettings.list.default')}</span>
                )}
              </span>
              {/* 두 번째 줄 — 작업자용 설명. 없으면 비워 둔다 */}
              <span className={`ls-item-desc ${tpl.description ? '' : 'is-empty'}`}>
                {tpl.description || t('labelSettings.list.noDescription')}
              </span>
              <span className="ls-item-meta">
                {t(`labelSettings.typeShort.${tpl.label_type}`)} ·{' '}
                {audiencesLabel(tpl)} · {tpl.width_mm}×{tpl.height_mm}mm · {tpl.dpi}dpi · {ownerLabel(tpl)}
              </span>
            </button>
          ))
        )}
      </div>
    </>
  );
};

export default TemplateListPanel;
