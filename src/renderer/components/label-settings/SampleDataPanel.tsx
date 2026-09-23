
import React from 'react';
import { useTranslation } from '../../utils/label/i18n';
import {
  PRODUCT_FIELDS,
  ACCOUNT_FIELDS,
  SAMPLE_LABEL_DATA,
  type LabelData,
} from '../../utils/label/labelTypes';

// ============================================================
// 미리보기 데이터 — 템플릿 보드(TemplateBoard)의 "미리보기 데이터" 탭 내용.
//
// 상품명·소재처럼 길이가 매번 다른 데이터는 "가장 긴 경우" 로 영역을
// 잡아야 한다. 여기서 샘플 값을 바꾸면 캔버스·경고·테스트 출력이
// 전부 이 값으로 그려진다. 계정 정보(acc_*)도 같은 방식으로 미리 볼 수 있다.
// 필드 이름은 labelSettings.fields.* 로 번역한다.
// ============================================================

interface Props {
  data: LabelData;
  onChange: (next: LabelData) => void;
}

const SampleDataPanel: React.FC<Props> = ({ data, onChange }) => {
  const { t } = useTranslation();

  const set = (key: string, raw: string) => {
    const isNumber = key === 'qty';
    onChange({ ...data, [key]: isNumber ? (raw === '' ? null : Number(raw)) : raw });
  };

  const renderField = (f: { key: string; label: string }, long: boolean) => {
    const v = data[f.key];
    return (
      <label className="ls-field" key={f.key}>
        <span>{t(`labelSettings.fields.${f.key}`, { defaultValue: f.label })}</span>
        {long ? (
          <textarea
            rows={2}
            value={v == null ? '' : String(v)}
            onChange={(e) => set(f.key, e.target.value)}
          />
        ) : (
          <input
            type={f.key === 'qty' ? 'number' : 'text'}
            value={v == null ? '' : String(v)}
            onChange={(e) => set(f.key, e.target.value)}
          />
        )}
      </label>
    );
  };

  return (
    <>
      <div className="ls-panel-inline-title">
        {t('labelSettings.sample.title')}
        <button className="ls-btn-ghost ls-btn-xs" onClick={() => onChange(SAMPLE_LABEL_DATA)}>
          {t('labelSettings.sample.reset')}
        </button>
      </div>
      <div className="ls-hint ls-mb8">{t('labelSettings.sample.hint')}</div>

      <div className="ls-sample-grid">
        {PRODUCT_FIELDS.map((f) =>
          renderField(f, f.key === 'item_name' || f.key === 'composition')
        )}
      </div>

      <div className="ls-sub-title">{t('labelSettings.sample.accountTitle')}</div>
      <div className="ls-hint ls-mb8">{t('labelSettings.sample.accountHint')}</div>
      <div className="ls-sample-grid">
        {ACCOUNT_FIELDS.map((f) => renderField(f, f.key === 'acc_address'))}
      </div>
    </>
  );
};

export default SampleDataPanel;
