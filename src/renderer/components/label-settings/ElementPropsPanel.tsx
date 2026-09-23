
import React, { useRef } from 'react';
import { useTranslation } from '../../utils/label/i18n';
import {
  productFieldsFor,
  ACCOUNT_FIELDS,
  LABEL_FONTS,
  DEFAULT_FONT,
  DEFAULT_LINE_GAP,
  DEFAULT_MIN_PT,
  isBindable,
  isTextBox,
  resolveElementText,
  type LabelData,
  type LabelElement,
  type LabelTemplate,
  type Rotation,
  type Symbology,
  type TextAlign,
  type TextVAlign,
  type TextOverflow,
} from '../../utils/label/labelTypes';
import { measureElement, rasterElement, isFontAvailable } from '../../utils/label/labelRender';
import { CARE_SYMBOLS } from '../../utils/label/careSymbols';
import type { ElementPatch } from './useTemplateDraft';

// ============================================================
// 선택 요소 속성 (우측 컬럼 하단)
//
// 세 덩어리로 나눈다
//   1) 내용   — 데이터 필드 바인딩 / 직접 입력({필드} 자리표시자 혼용)
//   2) 위치   — X · Y · 회전 · 잠금 · 숨김
//   3) 모양   — 요소 종류별 (글꼴·크기 / 바코드 규격 / QR 셀 …)
//
// 숫자 입력은 같은 항목을 연속으로 만지면 되돌리기 한 단계로 합쳐진다
// (onPatch 의 key). 그래서 key 를 항목마다 구분해서 넘긴다.
// 모든 문구는 ko.json (labelSettings.props.*) — 필드·글꼴·기호 이름은 key 로 찾는다.
// ============================================================

const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const ALIGN_KEYS: { key: TextAlign; i18n: string }[] = [
  { key: 'left', i18n: 'alignLeft' },
  { key: 'center', i18n: 'alignCenter' },
  { key: 'right', i18n: 'alignRight' },
];
const SYMBOLOGIES: Symbology[] = ['128', '128M', 'EAN13', 'EAN8', 'UPCA', '39', '93'];
const ECC_LEVELS = ['L', 'M', 'Q', 'H'] as const;

interface Props {
  el: LabelElement;
  template: LabelTemplate;
  data: LabelData;
  /** 이미 번역된 경고 문구 */
  warning: string | null;
  onPatch: (id: string, patch: ElementPatch, opts?: { key?: string }) => void;
}

// ── 작은 입력 헬퍼 ────────────────────────────────────────
interface NumProps {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  /** 비우면 undefined 로 저장 (선택 항목) */
  optional?: boolean;
  span2?: boolean;
}

const Num: React.FC<NumProps> = ({
  label,
  value,
  onChange,
  step = 0.5,
  min,
  max,
  placeholder,
  optional,
  span2,
}) => (
  <label className={`ls-field ${span2 ? 'ls-col-2' : ''}`}>
    <span>{label}</span>
    <input
      type="number"
      step={step}
      min={min}
      max={max}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') {
          onChange(optional ? undefined : min ?? 0);
          return;
        }
        onChange(Number(raw));
      }}
    />
  </label>
);

const Check: React.FC<{
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, checked, onChange }) => (
  <label className="ls-field ls-check">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span>{label}</span>
  </label>
);

// ============================================================
const ElementPropsPanel: React.FC<Props> = ({ el, template, data, warning, onPatch }) => {
  const { t } = useTranslation();
  const P = (key: string, params?: Record<string, unknown>) => t(`labelSettings.props.${key}`, params);
  const fieldName = (key: string, fallback: string) =>
    t(`labelSettings.fields.${key}`, { defaultValue: fallback });

  const textRef = useRef<HTMLTextAreaElement>(null);
  const patch = (p: ElementPatch, key?: string) => onPatch(el.id, p, { key });
  // 이 템플릿의 출처(stock)에 있는 상품 필드만 고를 수 있게
  const PRODUCT_FIELDS = productFieldsFor(template.source);

  const box = measureElement(el, template, data);
  const bindable = isBindable(el);
  // 영역 텍스트의 줄 수·축소 결과 (래스터 캐시에서 바로 읽는다)
  const fit = el.type === 'text' ? rasterElement(el, template, data)?.text ?? null : null;
  const mode: 'field' | 'text' = bindable && el.field ? 'field' : 'text';

  /** 커서 위치에 `{필드}` 삽입 */
  const insertField = (fieldKey: string) => {
    if (!bindable) return;
    const token = `{${fieldKey}}`;
    const node = textRef.current;
    const cur = el.text ?? '';
    if (!node) {
      patch({ text: cur + token });
      return;
    }
    const start = node.selectionStart ?? cur.length;
    const end = node.selectionEnd ?? cur.length;
    const next = cur.slice(0, start) + token + cur.slice(end);
    patch({ text: next });
    requestAnimationFrame(() => {
      node.focus();
      const pos = start + token.length;
      node.setSelectionRange(pos, pos);
    });
  };

  const alignSelect = (
    <label className="ls-field">
      <span>{P('align')}</span>
      <select
        value={(el as { align?: TextAlign }).align ?? 'left'}
        onChange={(e) => patch({ align: e.target.value as TextAlign })}
      >
        {ALIGN_KEYS.map((a) => (
          <option key={a.key} value={a.key}>
            {P(a.i18n)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section className="ls-panel ls-props-panel">
      <div className="ls-panel-title">
        {P('title', { type: t(`labelSettings.elType.${el.type}`) })}
        <span className="ls-size-readout">
          {box.w_mm.toFixed(1)} × {box.h_mm.toFixed(1)} mm
        </span>
      </div>

      {warning && <div className="ls-warn ls-warn-sm">{warning}</div>}

      <label className="ls-field">
        <span>{P('name')}</span>
        <input
          value={el.name ?? ''}
          placeholder={P('namePh')}
          onChange={(e) => patch({ name: e.target.value || undefined }, `el:${el.id}:name`)}
        />
      </label>

      {/* ============================================ */}
      {/* 1) 내용                                      */}
      {/* ============================================ */}
      {bindable && (
        <>
          <div className="ls-sub-title">{P('content')}</div>

          <div className="ls-seg">
            <button
              className={mode === 'field' ? 'active' : ''}
              onClick={() => patch({ field: 'item_name' })}
            >
              {P('fieldMode')}
            </button>
            <button
              className={mode === 'text' ? 'active' : ''}
              onClick={() => patch({ field: undefined, text: el.text ?? '' })}
            >
              {P('textMode')}
            </button>
          </div>

          {mode === 'field' ? (
            <label className="ls-field">
              <span>{P('bindField')}</span>
              <select
                value={el.field ?? ''}
                onChange={(e) => patch({ field: e.target.value })}
              >
                <optgroup label={P('groupProduct')}>
                  {PRODUCT_FIELDS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {fieldName(f.key, f.label)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={P('groupAccount')}>
                  {ACCOUNT_FIELDS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {fieldName(f.key, f.label)}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
          ) : (
            <>
              <label className="ls-field">
                <span>{P('text')}</span>
                <textarea
                  ref={textRef}
                  rows={el.type === 'text' ? 3 : 2}
                  value={el.text ?? ''}
                  placeholder={P('textPh')}
                  onChange={(e) => patch({ text: e.target.value }, `el:${el.id}:text`)}
                />
              </label>

              <label className="ls-field">
                <span>{P('insertField')}</span>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) insertField(e.target.value);
                    e.target.value = '';
                  }}
                >
                  <option value="">{P('pickField')}</option>
                  <optgroup label={P('groupProduct')}>
                    {PRODUCT_FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {fieldName(f.key, f.label)} — {`{${f.key}}`}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={P('groupAccountShort')}>
                    {ACCOUNT_FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {fieldName(f.key, f.label)} — {`{${f.key}}`}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>

              <div className="ls-resolved">
                <span>{P('resolved')}</span>
                <code>{resolveElementText(el, data) || P('emptyValue')}</code>
              </div>
            </>
          )}
        </>
      )}

      {/* ============================================ */}
      {/* 2) 위치                                      */}
      {/* ============================================ */}
      <div className="ls-sub-title">{P('position')}</div>
      <div className="ls-grid-2">
        <Num
          label="X (mm)"
          value={el.x_mm}
          min={0}
          onChange={(v) => patch({ x_mm: v ?? 0 }, `el:${el.id}:x`)}
        />
        <Num
          label="Y (mm)"
          value={el.y_mm}
          min={0}
          onChange={(v) => patch({ y_mm: v ?? 0 }, `el:${el.id}:y`)}
        />
        <label className="ls-field">
          <span>{P('rotate')}</span>
          <select
            value={el.rotate ?? 0}
            onChange={(e) => patch({ rotate: Number(e.target.value) as Rotation })}
          >
            {ROTATIONS.map((r) => (
              <option key={r} value={r}>
                {r}°
              </option>
            ))}
          </select>
        </label>
        <div className="ls-field ls-inline-checks">
          <Check
            label={P('locked')}
            checked={!!el.locked}
            onChange={(v) => patch({ locked: v || undefined })}
          />
          <Check
            label={P('hidden')}
            checked={!!el.hidden}
            onChange={(v) => patch({ hidden: v || undefined })}
          />
        </div>
      </div>

      {/* ============================================ */}
      {/* 3) 모양 — 텍스트                              */}
      {/* ============================================ */}
      {el.type === 'text' && (
        <>
          <div className="ls-sub-title">{P('textTitle')}</div>
          <div className="ls-grid-2">
            <label className="ls-field ls-col-2">
              <span>
                {P('font')}
                {el.font_family && !isFontAvailable(el.font_family) && (
                  <em className="ls-font-missing">{P('fontMissing')}</em>
                )}
              </span>
              <select
                value={el.font_family ?? DEFAULT_FONT}
                onChange={(e) => patch({ font_family: e.target.value })}
              >
                {LABEL_FONTS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {t(`labelSettings.fonts.${f.key}`, { defaultValue: f.label })}
                    {isFontAvailable(f.key) ? '' : P('notInstalled')}
                  </option>
                ))}
              </select>
            </label>

            <Num
              label={P('size')}
              value={el.size_pt}
              step={0.5}
              min={2}
              onChange={(v) => patch({ size_pt: v ?? 8 }, `el:${el.id}:size`)}
            />

            {alignSelect}

            <div className="ls-field ls-inline-checks ls-col-2">
              <Check
                label={P('bold')}
                checked={!!el.bold}
                onChange={(v) => patch({ bold: v || undefined })}
              />
              <Check
                label={P('italic')}
                checked={!!el.italic}
                onChange={(v) => patch({ italic: v || undefined })}
              />
              <Check
                label={P('invert')}
                checked={!!el.invert}
                onChange={(v) => patch({ invert: v || undefined })}
              />
            </div>

            <Num
              label={P('letterSpacing')}
              value={el.letter_spacing_mm}
              optional
              step={0.05}
              placeholder="0"
              onChange={(v) => patch({ letter_spacing_mm: v }, `el:${el.id}:ls`)}
            />
            <Num
              label={P('lineGap')}
              value={el.line_gap ?? DEFAULT_LINE_GAP}
              step={0.05}
              min={0.8}
              onChange={(v) => patch({ line_gap: v ?? DEFAULT_LINE_GAP }, `el:${el.id}:gap`)}
            />
          </div>

          {/* ── 영역 (텍스트 상자) ── */}
          <div className="ls-sub-title">{P('areaTitle')}</div>
          <div className="ls-hint ls-mb8">{P('areaHint')}</div>
          <div className="ls-grid-2">
            <Num
              label={P('width')}
              value={el.max_w_mm}
              optional
              placeholder={P('widthPh')}
              min={1}
              onChange={(v) => patch({ max_w_mm: v }, `el:${el.id}:maxw`)}
            />
            <Num
              label={P('height')}
              value={el.h_mm}
              optional
              placeholder={P('heightPh')}
              min={0.5}
              onChange={(v) => patch({ h_mm: v }, `el:${el.id}:h`)}
            />

            {isTextBox(el) ? (
              <>
                <label className="ls-field">
                  <span>{P('vAlign')}</span>
                  <select
                    value={el.v_align ?? 'top'}
                    onChange={(e) => patch({ v_align: e.target.value as TextVAlign })}
                  >
                    <option value="top">{P('vTop')}</option>
                    <option value="middle">{P('vMiddle')}</option>
                    <option value="bottom">{P('vBottom')}</option>
                  </select>
                </label>
                <label className="ls-field">
                  <span>{P('overflow')}</span>
                  <select
                    value={el.overflow ?? 'shrink'}
                    onChange={(e) => patch({ overflow: e.target.value as TextOverflow })}
                  >
                    <option value="shrink">{P('shrink')}</option>
                    <option value="clip">{P('clip')}</option>
                  </select>
                </label>
                {(el.overflow ?? 'shrink') === 'shrink' && (
                  <Num
                    label={P('minPt')}
                    value={el.min_pt ?? DEFAULT_MIN_PT}
                    step={0.5}
                    min={1}
                    onChange={(v) => patch({ min_pt: v ?? DEFAULT_MIN_PT }, `el:${el.id}:minpt`)}
                  />
                )}
                <div className="ls-field">
                  <span>{P('fitLabel')}</span>
                  <div className="ls-fit-readout">
                    {fit ? (
                      <>
                        {P('fitLines', { fit: fit.fitLines, total: fit.totalLines })}
                        {fit.usedPt < el.size_pt && (
                          <em>{P('fitShrunk', { from: el.size_pt, to: fit.usedPt })}</em>
                        )}
                        {fit.clippedLines > 0 && (
                          <strong>{P('fitClipped', { n: fit.clippedLines })}</strong>
                        )}
                      </>
                    ) : (
                      P('noContent')
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <Check
                  label={P('wrap')}
                  checked={!!el.wrap}
                  onChange={(v) => patch({ wrap: v || undefined })}
                />
                {el.wrap && (
                  <Num
                    label={P('maxLines')}
                    value={el.max_lines}
                    optional
                    step={1}
                    min={1}
                    placeholder={P('unlimited')}
                    onChange={(v) => patch({ max_lines: v }, `el:${el.id}:lines`)}
                  />
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ── 모양 — 바코드 ── */}
      {el.type === 'barcode' && (
        <>
          <div className="ls-sub-title">{P('barcodeTitle')}</div>
          <div className="ls-grid-2">
            <label className="ls-field ls-col-2">
              <span>{P('symbology')}</span>
              <select
                value={el.symbology}
                onChange={(e) => patch({ symbology: e.target.value as Symbology })}
              >
                {SYMBOLOGIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <div className="ls-hint ls-col-2">{t(`labelSettings.symbologyHint.${el.symbology}`)}</div>

            {alignSelect}
            <Num
              label={P('alignWidth')}
              value={el.max_w_mm}
              optional
              placeholder={P('widthPh')}
              min={1}
              onChange={(v) => patch({ max_w_mm: v }, `el:${el.id}:maxw`)}
            />
            <Num
              label={P('barHeight')}
              value={el.h_mm}
              min={2}
              onChange={(v) => patch({ h_mm: v ?? 10 }, `el:${el.id}:bh`)}
            />
            <Num
              label={P('narrow')}
              value={el.narrow}
              step={1}
              min={1}
              max={10}
              onChange={(v) => patch({ narrow: v ?? 2 }, `el:${el.id}:narrow`)}
            />
            <Num
              label={P('wide')}
              value={el.wide}
              step={1}
              min={1}
              max={10}
              onChange={(v) => patch({ wide: v ?? 2 }, `el:${el.id}:wide`)}
            />
            <Check
              label={P('humanReadable')}
              checked={!!el.human_readable}
              onChange={(v) => patch({ human_readable: v || undefined })}
            />
            {el.human_readable && (
              <Num
                label={P('textPt')}
                value={el.text_pt ?? 7}
                step={0.5}
                min={4}
                onChange={(v) => patch({ text_pt: v ?? 7 }, `el:${el.id}:tpt`)}
              />
            )}
          </div>
        </>
      )}

      {/* ── 모양 — QR ── */}
      {el.type === 'qr' && (
        <>
          <div className="ls-sub-title">{P('qrTitle')}</div>
          <div className="ls-grid-2">
            <Num
              label={P('cell')}
              value={el.cell}
              step={1}
              min={1}
              max={10}
              onChange={(v) => patch({ cell: v ?? 4 }, `el:${el.id}:cell`)}
            />
            <label className="ls-field">
              <span>{P('ecc')}</span>
              <select
                value={el.ecc}
                onChange={(e) => patch({ ecc: e.target.value as 'L' | 'M' | 'Q' | 'H' })}
              >
                {ECC_LEVELS.map((lv) => (
                  <option key={lv} value={lv}>
                    {P(`ecc${lv}`)}
                  </option>
                ))}
              </select>
            </label>
            {alignSelect}
            <Num
              label={P('alignWidth')}
              value={el.max_w_mm}
              optional
              placeholder={P('widthPh')}
              min={1}
              onChange={(v) => patch({ max_w_mm: v }, `el:${el.id}:maxw`)}
            />
            <div className="ls-hint ls-col-2">{P('qrHint')}</div>
          </div>
        </>
      )}

      {/* ── 모양 — 이미지 / 세탁 기호 ── */}
      {el.type === 'image' && (
        <>
          <div className="ls-sub-title">{P('imageTitle')}</div>
          <div className="ls-grid-2">
            <label className="ls-field ls-col-2">
              <span>{P('symbol')}</span>
              <select
                value={el.symbol ?? ''}
                onChange={(e) => {
                  const key = e.target.value || undefined;
                  // 기호는 정사각형 — 선택 시 세로를 가로에 맞춘다
                  patch(key ? { symbol: key, src: undefined, h_mm: el.w_mm } : { symbol: undefined });
                }}
              >
                <option value="">{P('useUpload')}</option>
                {CARE_SYMBOLS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {t(`labelSettings.careSymbols.${s.key}`, { defaultValue: s.label })}
                  </option>
                ))}
              </select>
            </label>

            <label className="ls-field ls-col-2">
              <span>{P('upload')}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const src = String(reader.result || '');
                    if (!src) return;
                    // 원본 비율로 세로를 맞춘다
                    const img = new Image();
                    img.onload = () => {
                      const ratio = img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : 1;
                      patch({
                        src,
                        symbol: undefined,
                        h_mm: Math.round(el.w_mm * ratio * 10) / 10,
                      });
                    };
                    img.onerror = () => patch({ src, symbol: undefined });
                    img.src = src;
                  };
                  reader.readAsDataURL(file);
                  e.target.value = '';
                }}
              />
            </label>

            <Num
              label={P('imgW')}
              value={el.w_mm}
              min={1}
              onChange={(v) => {
                const w = v ?? 5;
                const keep = el.keep_ratio !== false && el.w_mm > 0;
                patch(
                  keep ? { w_mm: w, h_mm: Math.round((w * el.h_mm) / el.w_mm * 10) / 10 } : { w_mm: w },
                  `el:${el.id}:w`
                );
              }}
            />
            <Num
              label={P('imgH')}
              value={el.h_mm}
              min={1}
              onChange={(v) => {
                const h = v ?? 5;
                const keep = el.keep_ratio !== false && el.h_mm > 0;
                patch(
                  keep ? { h_mm: h, w_mm: Math.round((h * el.w_mm) / el.h_mm * 10) / 10 } : { h_mm: h },
                  `el:${el.id}:h`
                );
              }}
            />
            <Check
              label={P('keepRatio')}
              checked={el.keep_ratio !== false}
              onChange={(v) => patch({ keep_ratio: v ? undefined : false })}
            />
            <Num
              label={P('threshold')}
              value={el.threshold ?? 128}
              step={8}
              min={0}
              max={255}
              onChange={(v) => patch({ threshold: v ?? 128 }, `el:${el.id}:thr`)}
            />
            <div className="ls-hint ls-col-2">{P('thresholdHint')}</div>
          </div>
        </>
      )}

      {/* ── 모양 — 박스 / 선 ── */}
      {(el.type === 'box' || el.type === 'line') && (
        <>
          <div className="ls-sub-title">{el.type === 'box' ? P('boxTitle') : P('lineTitle')}</div>
          <div className="ls-grid-2">
            <Num
              label={P('imgW')}
              value={el.w_mm}
              min={0.1}
              onChange={(v) => patch({ w_mm: v ?? 1 }, `el:${el.id}:w`)}
            />
            <Num
              label={P('imgH')}
              value={el.h_mm}
              step={0.1}
              min={0.1}
              onChange={(v) => patch({ h_mm: v ?? 1 }, `el:${el.id}:h`)}
            />
            {el.type === 'box' && (
              <>
                <Num
                  label={P('thickness')}
                  value={el.thickness_mm}
                  step={0.1}
                  min={0.1}
                  onChange={(v) => patch({ thickness_mm: v ?? 0.3 }, `el:${el.id}:th`)}
                />
                <Check
                  label={P('filled')}
                  checked={!!el.filled}
                  onChange={(v) => patch({ filled: v || undefined })}
                />
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
};

export default ElementPropsPanel;
