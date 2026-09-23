import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../utils/label/i18n';
import UnsavedChangesGuard from '../components/common/UnsavedChangesGuard';
import { deleteLabelTemplate, saveLabelTemplate } from '../services/labelTemplateService';
import { getCurrentLabelAccount } from '../services/labelService';

import TemplateBoard from '../components/label-settings/TemplateBoard';
import CanvasToolbar, { type AlignAction } from '../components/label-settings/CanvasToolbar';
import LabelCanvas from '../components/label-settings/LabelCanvas';
import ElementListPanel from '../components/label-settings/ElementListPanel';
import ElementPropsPanel from '../components/label-settings/ElementPropsPanel';

import { useLabelSettingsData } from '../components/label-settings/useLabelSettingsData';
import { useTemplateDraft, type ElementPatch } from '../components/label-settings/useTemplateDraft';
import { getLocalPrinter } from '../utils/label/localPrinterMap';

import {
  SAMPLE_LABEL_DATA,
  createElement,
  textLinesHeightMm,
  accountFieldsToLabelData,
  DEFAULT_FONT,
  type LabelData,
  type LabelElement,
  WEB_FONTS,
  printerLangOf,
  APP_LABEL_SOURCE,
  type LabelTemplate,
  type LabelType,
} from '../utils/label/labelTypes';
import {
  measureElement,
  elementWarning,
  preloadTemplateAssets,
  ensureFontsLoaded,
} from '../utils/label/labelRender';
import { useRasterVersion } from '../components/label-settings/useRasterVersion';
import { buildLabelJob } from '../utils/label/labelJob';
import { printRaw } from '../utils/label/qzTray';
import './LabelSettings.css';

// ============================================================
// 라벨 설정 — 3분할 편집기
//
//   왼쪽   : 템플릿 보드(탭: 템플릿·기본정보·미리보기데이터·프린터) + 요소 목록
//   가운데 : 툴바 + 라벨 캔버스 (드래그로 배치, 다중 선택 가능)
//   오른쪽 : 선택 요소 속성
//
// 인쇄는 QZ Tray(localhost) 로 RAW 전송 — 템플릿의 printer_lang 에 따라 TSPL / ZPL
//   미리보기 래스터 = 인쇄 래스터 (utils/label/labelRender.ts 공용)
//   프린터는 "템플릿마다 이 PC 에서 쓸 프린터" 를 브라우저에 로컬로 저장한다
//   (utils/label/localPrinterMap.ts) — 상품관리 [라벨출력] 모달과 같은 저장소
//
// 템플릿은 이 앱의 stock 출처만 다룬다 (services/labelTemplateService.ts — 권한 규칙도 거기).
// 문구는 utils/label/ko.json 의 labelSettings.* (t() — utils/label/i18n.ts).
// 엔진이 돌려주는 경고(elementWarning)는 키+치환값이라 여기서 t() 로 문구로 바꾼다.
// 미저장 경고는 UnsavedChangesGuard (사이드 메뉴 이동 · 새로고침/창 닫기).
// ============================================================

const MIN_SCALE = 3;
const MAX_SCALE = 20;
const TOAST_MS = 2600;

/** 새 템플릿 기본값 — 종류별로 실무에서 바로 쓸 만한 배치를 넣어 둔다 (name 은 현재 언어로) */
const newTemplate = (labelType: LabelType, name: string): LabelTemplate => ({
  id: '',
  user_ids: null,
  name,
  description: null,
  // 기본은 성인(권장연령 없음). 키즈용은 기본정보 탭에서 대상을 바꿔 쓴다
  audiences: ['adult'],
  // 이 앱은 stock 출처 고정 (저장할 때도 서비스가 stock 으로 고정한다)
  source: APP_LABEL_SOURCE,
  label_type: labelType,
  printer_lang: 'TSPL2',
  width_mm: labelType === 'care' ? 30 : 40,
  height_mm: labelType === 'care' ? 40 : 30,
  gap_mm: 2,
  // 케어라벨은 보통 틈 없는 리본 → 연속 용지. 틈 설정으로 나가면 프린터가 멈춘다
  media: labelType === 'care' ? 'continuous' : 'gap',
  dpi: labelType === 'care' ? 300 : 203,
  layout:
    labelType === 'care'
      ? [
          // 케어라벨 — 긴 한글(상품명·소재)은 자동 줄바꿈으로 여러 줄 표기
          {
            ...createElement('text'),
            y_mm: 3,
            field: 'brand',
            size_pt: 9,
            bold: true,
            font_family: DEFAULT_FONT,
          },
          // 상품명·소재는 길이가 매번 달라서 "영역" 으로 잡는다 (넘치면 자동 축소)
          {
            ...createElement('text'),
            y_mm: 9,
            field: 'item_name',
            size_pt: 6,
            max_w_mm: 26,
            h_mm: textLinesHeightMm(6, 3, 300),
          },
          {
            ...createElement('text'),
            y_mm: 22,
            field: 'composition',
            size_pt: 6,
            max_w_mm: 26,
            h_mm: textLinesHeightMm(6, 2, 300),
          },
          { ...createElement('text'), y_mm: 32, field: 'recommanded_age', size_pt: 6 },
        ]
      : [
          { ...createElement('text'), y_mm: 2, field: 'brand', size_pt: 8, bold: true },
          {
            ...createElement('text'),
            y_mm: 6,
            field: 'item_name',
            size_pt: 6,
            max_w_mm: 36,
            h_mm: textLinesHeightMm(6, 2, 203),
          },
          { ...createElement('barcode'), x_mm: 3, y_mm: 12, h_mm: 10 },
          { ...createElement('text'), y_mm: 25, field: 'product_no', size_pt: 6 },
        ],
  is_default: false,
});

interface Toast {
  msg: string;
  kind: 'ok' | 'err';
}

const LabelSettings: React.FC = () => {
  const { t } = useTranslation();
  const data = useLabelSettingsData();
  const draftApi = useTemplateDraft();
  const { draft, dirty } = draftApi;
  /** 로그인 계정 id — 템플릿 저장·삭제 권한 확인 (labelTemplateService) */
  const myId = getCurrentLabelAccount()?.id ?? '';

  // 목록 필터 (템플릿 보드의 "템플릿" 탭)
  const [filterUserId, setFilterUserId] = useState('');
  const [filterType, setFilterType] = useState<LabelType | ''>('');

  // 편집 상태 — 다중 선택 가능
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** 미리보기·경고·테스트 출력에 쓰는 샘플 값 (긴 데이터로 영역을 잡아 보는 용도) */
  const [sampleData, setSampleData] = useState<LabelData>(SAMPLE_LABEL_DATA);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  // 캔버스 보기 설정
  const [scale, setScale] = useState(8);
  const [showGrid, setShowGrid] = useState(true);
  const [snapMm, setSnapMm] = useState(0.5);
  const stageWrapRef = useRef<HTMLDivElement>(null);

  /** 선택이 정확히 1개일 때만 상세 속성을 보여준다 */
  const selectedEl = useMemo(
    () => (selectedIds.length === 1 ? draft?.layout.find((el) => el.id === selectedIds[0]) ?? null : null),
    [draft, selectedIds]
  );

  // ── 계정 정보 미리보기 값 — 템플릿에 실제 사업자가 지정돼 있으면 그 사업자의
  //    진짜 값(거래처명·아이디 등)으로 채운다. 그냥 "sample_user" 같은 임의 문구를
  //    보여주면 진짜 인쇄 결과와 다르게 보여서 혼란스럽다.
  //    지정된 사업자 배열이 실제로 바뀔 때만 갱신 — 요소를 옮기는 등 다른 편집으로
  //    draft 가 바뀔 때마다 사용자가 손으로 고친 계정 필드값을 덮어쓰지 않기 위해
  //    "내용"(userIdsKey) 을 의존성으로 쓴다 (배열 참조가 아니라).
  const assignedUserIds = draft?.user_ids;
  const userIdsKey = assignedUserIds && assignedUserIds.length > 0 ? assignedUserIds.join(',') : '';
  useEffect(() => {
    if (!userIdsKey) return; // 공용 — 임의 샘플 유지
    const firstId = userIdsKey.split(',')[0];
    const user = data.users.find((u) => u.id === firstId);
    if (!user) return;
    setSampleData((prev) => ({ ...prev, ...accountFieldsToLabelData(user) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userIdsKey, data.users]);

  // ── 웹폰트 미리 받기 — 글꼴 드롭다운의 "(미설치)" 판정과 미리보기가 맞게 ──
  //    받아오면 래스터 버전이 올라가 경고·캔버스가 다시 계산된다.
  const rasterVersion = useRasterVersion();
  useEffect(() => {
    ensureFontsLoaded(WEB_FONTS);
  }, []);

  // ── 토스트 자동 닫기 ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  // ============================================================
  // 화면 맞춤 — 가운데 칸 크기에 맞춰 배율 계산
  // ============================================================
  const fitToView = useCallback(() => {
    const box = stageWrapRef.current;
    if (!box || !draft) return;
    const availW = box.clientWidth - 60; // 눈금자 + 여백
    const availH = box.clientHeight - 60;
    if (availW <= 0 || availH <= 0) return;
    const next = Math.min(availW / draft.width_mm, availH / draft.height_mm);
    setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(next * 2) / 2)));
  }, [draft]);

  // ============================================================
  // 템플릿 선택 / 새로 만들기 (미저장 확인)
  // ============================================================
  const confirmDiscard = useCallback(() => {
    if (!dirty) return true;
    return window.confirm(t('labelSettings.confirm.discard'));
  }, [dirty, t]);

  const pickTemplate = useCallback(
    (tpl: LabelTemplate) => {
      if (tpl.id === draft?.id) return;
      if (!confirmDiscard()) return;
      draftApi.load(tpl);
      setSelectedIds([]);
      requestAnimationFrame(fitToView);
    },
    [draft?.id, confirmDiscard, draftApi, fitToView]
  );

  const createTemplate = useCallback(
    (type: LabelType) => {
      if (!confirmDiscard()) return;
      // 새 템플릿은 로그인한 계정 전용으로 시작한다 (기본정보 탭에서 공용으로 바꿀 수 있다)
      const me = data.users[0];
      draftApi.load({
        ...newTemplate(type, t(`labelSettings.newName.${type}`)),
        user_ids: me ? [me.id] : null,
      });
      setSelectedIds([]);
      requestAnimationFrame(fitToView);
    },
    [confirmDiscard, draftApi, fitToView, t, data.users]
  );

  // ============================================================
  // 요소 조작
  // ============================================================
  const handleElementsChange = useCallback(
    (entries: { id: string; patch: ElementPatch }[], commit: boolean) => {
      draftApi.patchElements(entries, { commit });
    },
    [draftApi]
  );

  const handleAdd = useCallback(
    (type: LabelElement['type']) => {
      // 텍스트는 처음부터 "영역" 으로 — 시작점에서 오른쪽 여백 2mm 까지, 높이 2줄
      const overrides =
        type === 'text' && draft
          ? {
              max_w_mm: Math.max(4, Math.round((draft.width_mm - 2 - 2) * 10) / 10),
              h_mm: textLinesHeightMm(8, 2, draft.dpi),
            }
          : undefined;
      const id = draftApi.addElement(type, overrides);
      if (id) setSelectedIds([id]);
    },
    [draftApi, draft]
  );

  const handleRemove = useCallback(
    (id: string) => {
      draftApi.removeElement(id);
      setSelectedIds((cur) => cur.filter((v) => v !== id));
    },
    [draftApi]
  );

  const handleRemoveSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    draftApi.removeElements(selectedIds);
    setSelectedIds([]);
  }, [draftApi, selectedIds]);

  const handleDuplicate = useCallback(
    (id: string) => {
      const newId = draftApi.duplicateElement(id);
      if (newId) setSelectedIds([newId]);
    },
    [draftApi]
  );

  const handleDuplicateSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const newIds = draftApi.duplicateElements(selectedIds);
    if (newIds.length > 0) setSelectedIds(newIds);
  }, [draftApi, selectedIds]);

  /** 선택 요소를 라벨 기준으로 정렬 (선택 1개일 때만) */
  const handleAlign = useCallback(
    (action: AlignAction) => {
      if (!draft || !selectedEl) return;
      const box = measureElement(selectedEl, draft, sampleData);
      const round = (v: number) => Math.max(0, Math.round(v * 10) / 10);

      switch (action) {
        case 'left':
          draftApi.patchElement(selectedEl.id, { x_mm: 0 });
          break;
        case 'hcenter':
          draftApi.patchElement(selectedEl.id, {
            x_mm: round((draft.width_mm - box.w_mm) / 2),
          });
          break;
        case 'right':
          draftApi.patchElement(selectedEl.id, {
            x_mm: round(draft.width_mm - box.w_mm),
          });
          break;
        case 'top':
          draftApi.patchElement(selectedEl.id, { y_mm: 0 });
          break;
        case 'vcenter':
          draftApi.patchElement(selectedEl.id, {
            y_mm: round((draft.height_mm - box.h_mm) / 2),
          });
          break;
        case 'bottom':
          draftApi.patchElement(selectedEl.id, {
            y_mm: round(draft.height_mm - box.h_mm),
          });
          break;
      }
    },
    [draft, selectedEl, draftApi, sampleData]
  );

  // ============================================================
  // 저장 / 삭제 / 테스트 출력
  // ============================================================
  /** @returns 저장 성공 여부 — 이탈 가드(UnsavedChangesGuard)가 이동 여부를 판단한다 */
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!draft) return false;
    if (!draft.name.trim()) {
      setToast({ msg: t('labelSettings.toast.nameRequired'), kind: 'err' });
      return false;
    }
    if (!draft.audiences || draft.audiences.length === 0) {
      setToast({ msg: t('labelSettings.toast.audienceRequired'), kind: 'err' });
      return false;
    }
    setSaving(true);
    try {
      const payload = {
        ...(draft.id ? { id: draft.id } : {}),
        user_ids: draft.user_ids,
        name: draft.name,
        description: draft.description ?? null,
        audiences: draft.audiences,
        label_type: draft.label_type,
        printer_lang: printerLangOf(draft),   // TSPL2 | ZPL — 빠뜨리면 편집기에서 골라도 저장이 안 된다
        width_mm: draft.width_mm,
        height_mm: draft.height_mm,
        gap_mm: draft.gap_mm,
        media: draft.media ?? 'gap',
        cutter: draft.cutter ?? 'off',
        dpi: draft.dpi,
        density: draft.density ?? null,
        speed: draft.speed ?? null,
        layout: draft.layout,
        is_default: draft.is_default,
      };
      const saved = await saveLabelTemplate(payload, myId);

      draftApi.markSaved(saved);
      await data.reloadTemplates();
      setToast({ msg: t('labelSettings.toast.saved'), kind: 'ok' });
      return true;
    } catch (err) {
      console.error('템플릿 저장 오류:', err);
      setToast({
        msg: err instanceof Error ? err.message : t('labelSettings.toast.saveError'),
        kind: 'err',
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, draftApi, data, myId, t]);

  const handleDelete = useCallback(async () => {
    if (!draft?.id) return;
    if (!window.confirm(t('labelSettings.confirm.delete', { name: draft.name }))) return;
    try {
      await deleteLabelTemplate(draft.id, myId);
      draftApi.load(null);
      setSelectedIds([]);
      await data.reloadTemplates();
      setToast({ msg: t('labelSettings.toast.deleted'), kind: 'ok' });
    } catch (err) {
      console.error('템플릿 삭제 오류:', err);
      setToast({
        msg: err instanceof Error ? err.message : t('labelSettings.toast.deleteError'),
        kind: 'err',
      });
    }
  }, [draft, draftApi, data, myId, t]);

  const handleTestPrint = useCallback(async () => {
    if (!draft) return;
    if (!draft.id) {
      setToast({ msg: t('labelSettings.toast.saveBeforePrinter'), kind: 'err' });
      return;
    }
    const printer = getLocalPrinter(draft.id);
    if (!printer) {
      setToast({
        msg: t('labelSettings.toast.printerNotSet', {
          name: draft.name,
          help: t('labelSettings.printer.help'),
        }),
        kind: 'err',
      });
      return;
    }
    // 프린터 해상도와 템플릿 해상도가 다르면 실제 크기가 달라진다 — 알고 찍게 한다
    const info = data.qzPrinters.find((p) => p.name === printer);
    if (info?.dpi && info.dpi !== draft.dpi) {
      const go = window.confirm(
        t('labelSettings.confirm.dpiMismatch', {
          printer,
          printerDpi: info.dpi,
          tplDpi: draft.dpi,
          dir: t(info.dpi > draft.dpi ? 'labelSettings.confirm.dpiSmaller' : 'labelSettings.confirm.dpiLarger'),
        })
      );
      if (!go) return;
    }
    try {
      await preloadTemplateAssets(draft); // 이미지(세탁 기호)가 빠진 채 나가지 않게
      const bytes = buildLabelJob(draft, sampleData, 1);   // printer_lang 에 따라 TSPL / ZPL
      await printRaw(printer, bytes);
      setToast({ msg: t('labelSettings.toast.testSent'), kind: 'ok' });
    } catch (err) {
      console.error('테스트 출력 오류:', err);
      const notRunning = t('labelSettings.printer.notRunning');
      setToast({
        msg: err instanceof Error ? `${notRunning} (${err.message})` : notRunning,
        kind: 'err',
      });
    }
  }, [draft, data, sampleData, t]);

  // ============================================================
  // 단축키
  // ============================================================
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      const mod = e.ctrlKey || e.metaKey;

      // 저장은 입력 중에도 받는다
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
        return;
      }
      if (typing) return;
      if (!draft) return;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) draftApi.redo();
        else draftApi.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        draftApi.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd' && selectedIds.length > 0) {
        e.preventDefault();
        handleDuplicateSelected();
        return;
      }
      if (e.key === 'Escape') {
        setSelectedIds([]);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
        e.preventDefault();
        handleRemoveSelected();
        return;
      }

      // 방향키 미세 이동 — 선택된 요소 전부 같이 움직인다
      const step = e.shiftKey ? 1 : 0.1;
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const d = delta[e.key];
      if (d && draft && selectedIds.length > 0) {
        e.preventDefault();
        const entries = selectedIds
          .map((id) => draft.layout.find((el) => el.id === id))
          .filter((el): el is LabelElement => !!el && !el.locked)
          .map((el) => ({
            id: el.id,
            patch: {
              x_mm: Math.max(0, Math.round((el.x_mm + d[0]) * 100) / 100),
              y_mm: Math.max(0, Math.round((el.y_mm + d[1]) * 100) / 100),
            } as ElementPatch,
          }));
        if (entries.length > 0) {
          draftApi.patchElements(entries, {
            key: `el:arrow:${selectedIds.slice().sort().join(',')}`,
          });
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    draft,
    draftApi,
    selectedIds,
    handleSave,
    handleDuplicateSelected,
    handleRemoveSelected,
  ]);

  // ── 요소별 경고 (규격 위반 · 글꼴 없음 · 라벨 밖) — 키를 현재 언어로 번역해 둔다 ──
  const warnings = useMemo(() => {
    const map = new Map<string, string | null>();
    if (!draft) return map;
    for (const el of draft.layout) {
      const w = elementWarning(el, draft, sampleData);
      if (!w) {
        map.set(el.id, null);
        continue;
      }
      // clipped 는 "…pt 까지 줄였는데도" 를 먼저 번역해서 {{shrunk}} 로 끼운다
      const params = { ...(w.params ?? {}) };
      if (w.key.endsWith('.clipped')) {
        params.shrunk =
          params.shrunkPt != null ? t('labelSettings.warn.clippedShrunk', { pt: params.shrunkPt }) : '';
      }
      map.set(el.id, t(w.key, params));
    }
    return map;
    // rasterVersion: 웹폰트가 늦게 도착하면 "글꼴 없음" 경고를 다시 판정해야 한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, sampleData, rasterVersion, t]);

  // ============================================================
  // 렌더링
  // ============================================================
  return (
    <div className="ls-layout">
      {/* 미저장 변경 — 사이드 메뉴 이동은 모달, 새로고침·창 닫기는 브라우저 경고 */}
      <UnsavedChangesGuard
        when={dirty}
        onSave={handleSave}
        message={'저장하지 않은 템플릿 변경이 있습니다.\n저장하지 않고 이동하면 편집한 내용이 사라집니다.'}
      />
      <div className="ls-main-content">
        <main className="ls-content">
          {/* ── 헤더 ── */}
          <header className="ls-header">
            <h1 className="ls-title">{t('labelSettings.title')}</h1>

            <div className="ls-header-right">
              {/* 새 인쇄 PC 설정용 — QZ Tray 에 신뢰시킬 인증서(override.crt).
                  qz-tray.exe 와 같은 폴더에 넣고 QZ Tray 를 재시작하면 허용 창이 안 뜬다 */}
              <a
                className="ls-btn-ghost ls-cert-link"
                href="/api/qz/cert?download=1"
                download="override.crt"
                title={t('labelSettings.header.certTitle')}
              >
                {t('labelSettings.header.cert')}
              </a>
              <span
                className={`ls-qz-badge ${data.qzOk ? 'ok' : data.qzOk === false ? 'off' : ''}`}
              >
                {data.qzOk === null
                  ? t('labelSettings.header.qzChecking')
                  : data.qzOk
                    ? t('labelSettings.header.qzOk')
                    : t('labelSettings.header.qzOff')}
              </span>

              {draft && (
                <>
                  {dirty && <span className="ls-dirty">{t('labelSettings.header.dirty')}</span>}
                  <button className="ls-btn" onClick={handleTestPrint} disabled={!data.qzOk}>
                    {t('labelSettings.header.testPrint')}
                  </button>
                  {draft.id && (
                    <button className="ls-btn-danger" onClick={handleDelete}>
                      {t('labelSettings.header.delete')}
                    </button>
                  )}
                  <button className="ls-btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? t('labelSettings.header.saving') : t('labelSettings.header.save')}
                  </button>
                </>
              )}
            </div>
          </header>

          {/* ── 3분할 작업 영역 ── */}
          <div className="ls-workspace">
            {/* 왼쪽 — 템플릿 보드 + 요소 목록 */}
            <div className="ls-col ls-col-left">
              <TemplateBoard
                templates={data.templates}
                users={data.users}
                loading={data.loading}
                filterType={filterType}
                filterUserId={filterUserId}
                activeId={draft?.id || null}
                onFilterType={setFilterType}
                onFilterUser={setFilterUserId}
                onPick={pickTemplate}
                onCreate={createTemplate}
                draft={draft}
                onPatchTemplate={draftApi.patchTemplate}
                sampleData={sampleData}
                onSampleDataChange={setSampleData}
                qzOk={data.qzOk}
                qzPrinters={data.qzPrinters}
                onRefreshQz={data.refreshQz}
              />

              {draft && (
                <ElementListPanel
                  layout={draft.layout}
                  selectedIds={selectedIds}
                  warnings={warnings}
                  onSelect={setSelectedIds}
                  onPatch={(id, patch) => draftApi.patchElement(id, patch)}
                  onRemove={handleRemove}
                  onDuplicate={handleDuplicate}
                  onReorder={draftApi.reorderElement}
                />
              )}
            </div>

            {/* 가운데 — 캔버스 */}
            <div className="ls-col ls-col-center">
              {!draft ? (
                <div className="ls-empty ls-empty-lg">{t('labelSettings.empty.pickTemplate')}</div>
              ) : (
                <>
                  <CanvasToolbar
                    onAdd={handleAdd}
                    scale={scale}
                    onScale={setScale}
                    onFit={fitToView}
                    showGrid={showGrid}
                    onShowGrid={setShowGrid}
                    snapMm={snapMm}
                    onSnapMm={setSnapMm}
                    canUndo={draftApi.canUndo}
                    canRedo={draftApi.canRedo}
                    onUndo={draftApi.undo}
                    onRedo={draftApi.redo}
                    hasSelection={!!selectedEl}
                    onAlign={handleAlign}
                  />

                  <div className="ls-stage-wrap" ref={stageWrapRef}>
                    <LabelCanvas
                      template={draft}
                      data={sampleData}
                      scale={scale}
                      showGrid={showGrid}
                      snapMm={snapMm}
                      selectedIds={selectedIds}
                      onSelect={setSelectedIds}
                      onElementsChange={handleElementsChange}
                    />
                  </div>

                  <div className="ls-canvas-foot">
                    {t('labelSettings.canvasFoot', { dpi: draft.dpi })}
                  </div>
                </>
              )}
            </div>

            {/* 오른쪽 — 선택 요소 속성 */}
            <div className="ls-col ls-col-right">
              {!draft ? (
                <div className="ls-panel ls-empty">{t('labelSettings.empty.pickTemplateFirst')}</div>
              ) : selectedIds.length > 1 ? (
                <div className="ls-panel">
                  <div className="ls-panel-title">
                    {t('labelSettings.multi.selected', { n: selectedIds.length })}
                  </div>
                  <div className="ls-hint">{t('labelSettings.multi.hint')}</div>
                  <div className="ls-multi-actions">
                    <button className="ls-btn-sm" onClick={handleDuplicateSelected}>
                      {t('labelSettings.multi.duplicate')}
                    </button>
                    <button className="ls-btn-sm ls-btn-danger-sm" onClick={handleRemoveSelected}>
                      {t('labelSettings.multi.delete')}
                    </button>
                  </div>
                </div>
              ) : selectedEl ? (
                <ElementPropsPanel
                  el={selectedEl}
                  template={draft}
                  data={sampleData}
                  warning={warnings.get(selectedEl.id) ?? null}
                  onPatch={(id, patch, opts) =>
                    draftApi.patchElement(id, patch, { key: opts?.key })
                  }
                />
              ) : (
                <div className="ls-panel ls-empty">{t('labelSettings.empty.selectElement')}</div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* ── 토스트 ── */}
      {toast && <div className={`ls-toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
};

export default LabelSettings;
