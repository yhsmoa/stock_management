
import React from 'react';
import { useTranslation } from '../../utils/label/i18n';
import { isBindable, type LabelElement } from '../../utils/label/labelTypes';
import type { ElementPatch } from './useTemplateDraft';

// ============================================================
// 요소 목록 (왼쪽 컬럼, 템플릿 보드 아래)
//
// 목록 순서 = 인쇄 순서 = 겹칠 때 위아래 순서.
// 마지막 항목이 가장 위에 그려지므로 ▲/▼ 로 순서를 바꾼다.
//
// Shift/Ctrl(Cmd)+클릭으로 여러 행을 함께 선택할 수 있다 (캔버스 다중 선택과 연동).
// 요소 이름(caption)은 lib 의 elementCaption 과 같은 규칙이지만 현재 언어로 번역한다.
// ============================================================

interface Props {
  layout: LabelElement[];
  selectedIds: string[];
  /** 요소 id → 번역된 경고 문구 (없으면 null) */
  warnings: Map<string, string | null>;
  /** 캔버스와 동일하게 "새 선택 전체 목록"을 그대로 받는다 */
  onSelect: (ids: string[]) => void;
  onPatch: (id: string, patch: ElementPatch) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReorder: (id: string, dir: -1 | 1) => void;
}

const ElementListPanel: React.FC<Props> = ({
  layout,
  selectedIds,
  warnings,
  onSelect,
  onPatch,
  onRemove,
  onDuplicate,
  onReorder,
}) => {
  const { t } = useTranslation();
  const selectedSet = new Set(selectedIds);

  /** 목록에 보여줄 이름 (name → 필드명 → 고정문구 → 타입) — 현재 언어로 */
  const caption = (el: LabelElement): string => {
    if (el.name) return el.name;
    if (isBindable(el)) {
      if (el.field) return t(`labelSettings.fields.${el.field}`, { defaultValue: el.field });
      if (el.text) return `"${el.text}"`;
    }
    if (el.type === 'image') {
      return el.symbol
        ? t('labelSettings.elements.symbolCaption', {
            name: t(`labelSettings.careSymbols.${el.symbol}`, { defaultValue: el.symbol }),
          })
        : t('labelSettings.elements.uploadImage');
    }
    return t(`labelSettings.elType.${el.type}`);
  };

  const handleRowClick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      onSelect(selectedSet.has(id) ? selectedIds.filter((v) => v !== id) : [...selectedIds, id]);
    } else {
      onSelect([id]);
    }
  };

  return (
    <section className="ls-panel ls-el-panel">
      <div className="ls-panel-title">
        {t('labelSettings.elements.title')}
        <span className="ls-count">
          {selectedIds.length > 1
            ? t('labelSettings.elements.selectedCount', { sel: selectedIds.length, total: layout.length })
            : layout.length}
        </span>
      </div>

      {layout.length === 0 ? (
        <div className="ls-empty">{t('labelSettings.elements.empty')}</div>
      ) : (
        <div className="ls-el-list">
          {layout.map((el, i) => {
            const warn = warnings.get(el.id);
            const name = caption(el);
            return (
              <div
                key={el.id}
                className={`ls-el-row ${selectedSet.has(el.id) ? 'active' : ''} ${el.hidden ? 'is-hidden' : ''}`}
                onClick={(e) => handleRowClick(e, el.id)}
              >
                <span className="ls-el-type">{t(`labelSettings.elType.${el.type}`)}</span>
                <span className="ls-el-desc" title={name}>
                  {warn && <span className="ls-el-warn" title={warn}>⚠</span>}
                  {name}
                </span>

                <div className="ls-el-tools">
                  <button
                    className="ls-el-tool"
                    title={el.hidden ? t('labelSettings.elements.show') : t('labelSettings.elements.hide')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPatch(el.id, { hidden: !el.hidden });
                    }}
                  >
                    {el.hidden ? '◌' : '◉'}
                  </button>
                  <button
                    className="ls-el-tool"
                    title={el.locked ? t('labelSettings.elements.unlock') : t('labelSettings.elements.lock')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPatch(el.id, { locked: !el.locked });
                    }}
                  >
                    {el.locked ? '🔒' : '🔓'}
                  </button>
                  <button
                    className="ls-el-tool"
                    title={t('labelSettings.elements.back')}
                    disabled={i === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onReorder(el.id, -1);
                    }}
                  >
                    ▲
                  </button>
                  <button
                    className="ls-el-tool"
                    title={t('labelSettings.elements.front')}
                    disabled={i === layout.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      onReorder(el.id, 1);
                    }}
                  >
                    ▼
                  </button>
                  <button
                    className="ls-el-tool"
                    title={t('labelSettings.elements.duplicate')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicate(el.id);
                    }}
                  >
                    ⧉
                  </button>
                  <button
                    className="ls-el-tool ls-el-del"
                    title={t('labelSettings.elements.delete')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(el.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default ElementListPanel;
