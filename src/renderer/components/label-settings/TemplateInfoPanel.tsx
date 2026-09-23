
import React from 'react';
import { useTranslation } from '../../utils/label/i18n';
import {
  LABEL_MEDIA,
  LABEL_CUTTER,
  LABEL_AUDIENCES,
  PRINTER_LANGS,
  isSharedTemplate,
  printerLangOf,
  templateAudiences,
  type LabelAudience,
  type LabelCutter,
  type LabelMedia,
  type LabelTemplate,
  type LabelType,
  type PrinterLang,
} from '../../utils/label/labelTypes';
import type { LabelUser } from './useLabelSettingsData';
import { LABEL_TYPE_KEYS } from './TemplateListPanel';

// ============================================================
// 기본 정보 — 템플릿 보드(TemplateBoard)의 "기본정보" 탭 내용.
//
// DPI 는 "프린터가 실제로 찍는 해상도" 라서 바꾸면 모든 요소의 실제 크기가 달라진다.
// 어떤 프린터를 쓸지는 여기가 아니라 "프린터" 탭(템플릿별 · 이 PC 로컬)에서 정한다.
// 선택지 이름(용지·절단·대상)은 lib 상수의 key 로 i18n 에서 찾는다.
//
// 공개 범위: 로그인한 계정 전용(기본) 또는 공용. 다른 계정에 배정하는 UI 는 없다 —
// users 는 로그인한 계정 하나뿐이고, 서버(API)도 user_ids 를 [내 id] 또는 null 로만 저장한다.
// ============================================================

const DPI_OPTIONS = [203, 300, 600];

interface Props {
  draft: LabelTemplate;
  /** 로그인한 계정 (배열이지만 1명) */
  users: LabelUser[];
  onPatch: (patch: Partial<LabelTemplate>, key?: string) => void;
}

const TemplateInfoPanel: React.FC<Props> = ({ draft, users, onPatch }) => {
  const { t } = useTranslation();
  const shared = isSharedTemplate(draft);
  const media = draft.media ?? 'gap';
  const me = users[0] ?? null;

  const setShared = (on: boolean) => {
    onPatch({ user_ids: on || !me ? null : [me.id] });
  };

  // 대상은 최소 1개 — 마지막 하나는 해제되지 않는다 (인쇄 시 어디에도 안 잡히는 템플릿 방지)
  const audiences = templateAudiences(draft);
  const toggleAudience = (key: LabelAudience) => {
    const has = audiences.includes(key);
    if (has && audiences.length === 1) return;
    const next = has ? audiences.filter((a) => a !== key) : [...audiences, key];
    onPatch({ audiences: next });
  };

  return (
    <>
      <div className="ls-grid-2">
        <label className="ls-field ls-col-2">
          <span>{t('labelSettings.info.name')}</span>
          <input
            value={draft.name}
            onChange={(e) => onPatch({ name: e.target.value }, 'tpl:name')}
            placeholder={t('labelSettings.info.namePh')}
          />
        </label>

        <label className="ls-field ls-col-2">
          <span>{t('labelSettings.info.description')}</span>
          <textarea
            rows={2}
            value={draft.description ?? ''}
            onChange={(e) => onPatch({ description: e.target.value }, 'tpl:desc')}
            placeholder={t('labelSettings.info.descriptionPh')}
          />
        </label>
        <div className="ls-hint ls-col-2">{t('labelSettings.info.descriptionHint')}</div>

        <label className="ls-field">
          <span>{t('labelSettings.info.type')}</span>
          <select
            value={draft.label_type}
            onChange={(e) => onPatch({ label_type: e.target.value as LabelType })}
          >
            {LABEL_TYPE_KEYS.map((key) => (
              <option key={key} value={key}>
                {t(`labelSettings.types.${key}`)}
              </option>
            ))}
          </select>
        </label>

        {/* 출처(stock/rocket) 선택은 없다 — 이 앱의 템플릿은 항상 stock (labelTemplateService 가 고정) */}

        <label className="ls-field">
          <span>{t('labelSettings.info.width')}</span>
          <input
            type="number"
            step="0.5"
            min={5}
            value={draft.width_mm}
            onChange={(e) => onPatch({ width_mm: Number(e.target.value) }, 'tpl:w')}
          />
        </label>

        <label className="ls-field">
          <span>{t('labelSettings.info.height')}</span>
          <input
            type="number"
            step="0.5"
            min={5}
            value={draft.height_mm}
            onChange={(e) => onPatch({ height_mm: Number(e.target.value) }, 'tpl:h')}
          />
        </label>

        <label className="ls-field">
          <span>{t('labelSettings.info.dpi')}</span>
          <select value={draft.dpi} onChange={(e) => onPatch({ dpi: Number(e.target.value) })}>
            {DPI_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} dpi
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ── 공개 범위 — 내 계정 전용 / 공용 ── */}
      <div className="ls-sub-title">{t('labelSettings.info.shareTitle')}</div>
      <div className="ls-hint ls-mb8">{t('labelSettings.info.shareHint')}</div>
      <label className="ls-check ls-user-shared">
        <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
        <span>{t('labelSettings.info.sharedAll')}</span>
      </label>

      {/* ── 대상 — 권장연령 유무로 자동 선택된다 ── */}
      <div className="ls-sub-title">{t('labelSettings.info.audienceTitle')}</div>
      <div className="ls-hint ls-mb8">{t('labelSettings.info.audienceHint')}</div>
      <div className="ls-audience-checks">
        {LABEL_AUDIENCES.map((a) => (
          <label className="ls-check" key={a.key}>
            <input
              type="checkbox"
              checked={audiences.includes(a.key)}
              onChange={() => toggleAudience(a.key)}
            />
            <span>
              {t(`labelSettings.audience.${a.key}`)}{' '}
              <em>({t(`labelSettings.audienceHint.${a.key}`)})</em>
            </span>
          </label>
        ))}
      </div>

      {/* ── 용지 · 절단 ── */}
      <div className="ls-sub-title">{t('labelSettings.info.mediaTitle')}</div>
      <div className="ls-grid-2">
        <label className="ls-field ls-col-2">
          <span>{t('labelSettings.info.media')}</span>
          <select value={media} onChange={(e) => onPatch({ media: e.target.value as LabelMedia })}>
            {LABEL_MEDIA.map((m) => (
              <option key={m.key} value={m.key}>
                {t(`labelSettings.media.${m.key}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="ls-hint ls-col-2">{t(`labelSettings.mediaHint.${media}`)}</div>

        {media !== 'continuous' && (
          <label className="ls-field">
            <span>
              {media === 'blackmark'
                ? t('labelSettings.info.blackmarkHeight')
                : t('labelSettings.info.gap')}
            </span>
            <input
              type="number"
              step="0.5"
              min={0}
              value={draft.gap_mm}
              onChange={(e) => onPatch({ gap_mm: Number(e.target.value) }, 'tpl:gap')}
            />
          </label>
        )}

        <label className="ls-field ls-check ls-col-2">
          <input
            type="checkbox"
            checked={draft.is_default}
            onChange={(e) => onPatch({ is_default: e.target.checked })}
          />
          <span>{t('labelSettings.info.isDefault')}</span>
        </label>
      </div>

      {/* ── 프린터 설정 (명령 언어·농도·속도) ── */}
      <div className="ls-sub-title">{t('labelSettings.info.printerTitle')}</div>
      <div className="ls-hint ls-mb8">{t('labelSettings.info.printerHint')}</div>
      <div className="ls-grid-2">
        {/* 명령 언어 — 프린터 기종에 맞춰야 한다. 틀리면 라벨 대신 프린터 정보 문구가 찍힌다 */}
        <label className="ls-field ls-col-2">
          <span>{t('labelSettings.info.printerLang')}</span>
          <select
            value={printerLangOf(draft)}
            onChange={(e) => onPatch({ printer_lang: e.target.value as PrinterLang })}
          >
            {PRINTER_LANGS.map((l) => (
              <option key={l.key} value={l.key}>
                {t(`labelSettings.printerLang.${l.key}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="ls-hint ls-col-2">{t(`labelSettings.printerLangHint.${printerLangOf(draft)}`)}</div>
        <label className="ls-field">
          <span>{t('labelSettings.info.density')}</span>
          <input
            type="number"
            min={0}
            max={15}
            step={1}
            placeholder={t('labelSettings.info.defaultPh')}
            value={draft.density ?? ''}
            onChange={(e) =>
              onPatch({ density: e.target.value === '' ? null : Number(e.target.value) }, 'tpl:density')
            }
          />
        </label>
        <label className="ls-field">
          <span>{t('labelSettings.info.speed')}</span>
          <input
            type="number"
            min={1}
            max={12}
            step={1}
            placeholder={t('labelSettings.info.defaultPh')}
            value={draft.speed ?? ''}
            onChange={(e) =>
              onPatch({ speed: e.target.value === '' ? null : Number(e.target.value) }, 'tpl:speed')
            }
          />
        </label>
        <div className="ls-hint ls-col-2">{t('labelSettings.info.densityHint')}</div>
        <label className="ls-field ls-col-2">
          <span>{t('labelSettings.info.cutter')}</span>
          <select
            value={draft.cutter ?? 'off'}
            onChange={(e) => onPatch({ cutter: e.target.value as LabelCutter })}
          >
            {LABEL_CUTTER.map((c) => (
              <option key={c.key} value={c.key}>
                {t(`labelSettings.cutter.${c.key}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
};

export default TemplateInfoPanel;
