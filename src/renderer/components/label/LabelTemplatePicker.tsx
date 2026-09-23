import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../utils/label/i18n';
import type { LabelAudience, LabelTemplate, LabelType } from '../../utils/label/labelTypes';
import type { LabelTemplatePlan } from './useLabelTemplatePlan';
import './LabelTemplatePicker.css';

// ============================================================
// 템플릿 선택 — [라벨출력] 모달의 출력 버튼 위에 놓인다
//
//   라벨 스티커   성인 3   [ 템플릿 이름          ▾ ]
//                          [ 템플릿 설명               ]
//                 키즈 2   [ 키즈 템플릿 없음 …       ]
//   케어 라벨     …
//
// 드롭다운은 native <select> 가 아니라 직접 그린다 — 옵션 한 줄에 "이름 / 설명"
// 두 줄이 들어가야 해서다 (작업자가 설명을 보고 고른다).
// 자동 선택은 useLabelTemplatePlan 이 하고, 여기는 보여주고 바꾸기만 한다.
// ============================================================

// ============================================================
// 두 줄 드롭다운
// ============================================================
interface SelectProps {
  options: LabelTemplate[];
  value: LabelTemplate | null;
  /** 값이 없을 때 보여줄 문구 (템플릿 없음 안내) */
  placeholder: string;
  disabled?: boolean;
  onChange: (templateId: string) => void;
}

const TemplateSelect: React.FC<SelectProps> = ({ options, value, placeholder, disabled, onChange }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭 / Esc 로 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const noOptions = options.length === 0;
  const noDesc = t('print.templateNoDescription');

  return (
    <div className={`ltp-select ${open ? 'open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`ltp-select-btn ${value ? '' : 'is-missing'}`}
        disabled={disabled || noOptions}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {value ? (
          <>
            <span className="ltp-name">{value.name}</span>
            <span className={`ltp-desc ${value.description ? '' : 'is-empty'}`}>
              {value.description || noDesc}
            </span>
          </>
        ) : (
          <span className="ltp-placeholder">{placeholder}</span>
        )}
        <span className="ltp-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open && !noOptions && (
        <ul className="ltp-menu" role="listbox">
          {options.map((tpl) => (
            <li
              key={tpl.id}
              role="option"
              aria-selected={value?.id === tpl.id}
              className={`ltp-option ${value?.id === tpl.id ? 'active' : ''}`}
              onClick={() => {
                onChange(tpl.id);
                setOpen(false);
              }}
            >
              <span className="ltp-name">
                {tpl.name}
                {tpl.is_default && <em className="ltp-default">{t('print.templateDefault')}</em>}
              </span>
              <span className={`ltp-desc ${tpl.description ? '' : 'is-empty'}`}>
                {tpl.description || noDesc}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ============================================================
// 종류 한 블록 — 대상(성인/키즈)별 한 줄씩
// ============================================================
interface Props {
  plan: LabelTemplatePlan;
  labelType: LabelType;
  /** 블록 제목 (라벨 스티커 / 케어 라벨) */
  title: string;
  disabled?: boolean;
}

const LabelTemplatePicker: React.FC<Props> = ({ plan, labelType, title, disabled }) => {
  const { t } = useTranslation();
  const options = plan.templatesOf(labelType);
  const selected = plan.selectedOf(labelType);

  const audienceName = (a: LabelAudience) =>
    t(a === 'kids' ? 'print.templateKids' : 'print.templateAdult');

  return (
    <div className="ltp-block">
      <div className="ltp-title">{title}</div>
      {plan.audiences.length === 0 ? (
        <div className="ltp-empty">{t('print.emptyMessage')}</div>
      ) : (
        plan.audiences.map((a) => (
          <div className="ltp-row" key={a}>
            <span className={`ltp-aud ltp-aud-${a}`}>
              {audienceName(a)}
              <em>{plan.counts[a]}</em>
            </span>
            <TemplateSelect
              options={options}
              value={selected[a] ?? null}
              disabled={disabled || plan.loading}
              placeholder={
                plan.loading
                  ? t('print.templateLoading')
                  : options.length === 0
                    ? t('print.templateNone')
                    : t('print.templateMissing', { audience: audienceName(a) })
              }
              onChange={(id) => plan.select(labelType, a, id)}
            />
          </div>
        ))
      )}
    </div>
  );
};

export default LabelTemplatePicker;
