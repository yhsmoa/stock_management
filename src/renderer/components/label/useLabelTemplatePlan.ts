import { useCallback, useEffect, useMemo, useState } from 'react';
import { pickTemplate, itemAudience, type AudienceTemplates, type LabelPrintItem } from '../../services/labelPrintService';
import { fetchLabelTemplates } from '../../services/labelTemplateService';
import {
  LABEL_AUDIENCES,
  type LabelAudience,
  type LabelTemplate,
  type LabelType,
} from '../../utils/label/labelTypes';

// ============================================================
// 템플릿 선택 계획 — 상품관리 [라벨출력] 모달
//
//   · 모달이 열릴 때 그 사업자가 쓸 수 있는 템플릿(공용 + 전용, 두 종류 모두)을 한 번 받는다
//   · 항목들을 권장연령 유무로 성인/키즈로 나누고, "있는 대상" 마다
//     (종류 × 대상) 템플릿을 자동 선택한다 (pickTemplate — 기본 템플릿 우선)
//   · 작업자가 드롭다운에서 바꾸면 override 로 덮어쓴다 (모달을 다시 열면 초기화)
//   · 대상에 맞는 템플릿이 하나도 없으면 null → 화면에 "템플릿 없음" 으로 알린다
// ============================================================

export interface LabelTemplatePlan {
  loading: boolean;
  /** 이 사업자가 쓸 수 있는 전체 템플릿 (두 종류 모두) */
  templates: LabelTemplate[];
  /** 항목에 실제로 존재하는 대상 — 성인 → 키즈 순 */
  audiences: LabelAudience[];
  /** 대상별 항목 수 */
  counts: Record<LabelAudience, number>;
  /** 그 종류의 템플릿 후보 전체 (대상 무관 — 드롭다운에서 강제로 바꿀 수 있게) */
  templatesOf: (labelType: LabelType) => LabelTemplate[];
  /** 그 종류에서 대상별로 확정된 템플릿 — 항목이 있는 대상만 키가 있다 */
  selectedOf: (labelType: LabelType) => AudienceTemplates;
  /** 항목은 있는데 템플릿이 없는 대상 */
  missingOf: (labelType: LabelType) => LabelAudience[];
  select: (labelType: LabelType, audience: LabelAudience, templateId: string) => void;
}

interface Params {
  /** 모달이 열려 있을 때만 조회한다 (열 때마다 최신 템플릿 반영) */
  active: boolean;
  userId: string | null;
  items: LabelPrintItem[];
}

const overrideKey = (labelType: LabelType, audience: LabelAudience) => `${labelType}:${audience}`;

export function useLabelTemplatePlan({ active, userId, items }: Params): LabelTemplatePlan {
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  // ── 템플릿 조회 — 모달이 열릴 때 / 사업자가 바뀔 때 ──
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setOverrides({}); // 새로 열면 자동 선택으로 되돌린다
    setLoading(true);
    (async () => {
      try {
        // 이 앱의 stock 템플릿 중 "내 것 + 공용" (labelTemplateService)
        const list = userId ? await fetchLabelTemplates(userId) : [];
        if (!cancelled) setTemplates(list);
      } catch (err) {
        console.error('라벨 템플릿 조회 오류:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, userId]);

  // ── 대상 분류 ──
  const counts = useMemo(() => {
    const c: Record<LabelAudience, number> = { adult: 0, kids: 0 };
    for (const it of items) c[itemAudience(it)] += 1;
    return c;
  }, [items]);

  const audiences = useMemo(
    () => LABEL_AUDIENCES.map((a) => a.key).filter((a) => counts[a] > 0),
    [counts]
  );

  // ── 선택 ──
  const templatesOf = useCallback(
    (labelType: LabelType) => templates.filter((t) => t.label_type === labelType),
    [templates]
  );

  const selectedOf = useCallback(
    (labelType: LabelType): AudienceTemplates => {
      const out: AudienceTemplates = {};
      for (const a of audiences) {
        const overrideId = overrides[overrideKey(labelType, a)];
        const overridden = overrideId
          ? templates.find((t) => t.id === overrideId && t.label_type === labelType) ?? null
          : null;
        out[a] = overridden ?? pickTemplate(templates, userId, labelType, a);
      }
      return out;
    },
    [audiences, overrides, templates, userId]
  );

  const missingOf = useCallback(
    (labelType: LabelType) => {
      const sel = selectedOf(labelType);
      return audiences.filter((a) => !sel[a]);
    },
    [audiences, selectedOf]
  );

  const select = useCallback((labelType: LabelType, audience: LabelAudience, templateId: string) => {
    setOverrides((prev) => ({ ...prev, [overrideKey(labelType, audience)]: templateId }));
  }, []);

  return useMemo(
    () => ({ loading, templates, audiences, counts, templatesOf, selectedOf, missingOf, select }),
    [loading, templates, audiences, counts, templatesOf, selectedOf, missingOf, select]
  );
}
