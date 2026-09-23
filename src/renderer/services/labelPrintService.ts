import { buildLabelBatch } from '../utils/label/labelJob';
import { preloadTemplateAssets } from '../utils/label/labelRender';
import { printRaw } from '../utils/label/qzTray';
import { getLocalPrinter } from '../utils/label/localPrinterMap';
import {
  accountFieldsToLabelData,
  audienceOfItem,
  templateHasAudience,
  type LabelAudience,
  type LabelData,
  type LabelTemplate,
  type LabelType,
} from '../utils/label/labelTypes';
import { insertLabelPrintLogs, type LabelUser } from './labelTemplateService';

// ============================================================
// 라벨 즉시 출력 — 상품관리에서 고른 항목을 QZ Tray 로 인쇄
//
// 항목마다 data(필드 묶음)를 그대로 템플릿에 바인딩한다. data 의 키는
// services/labelService.ts 의 toLabelPrintItems() 가 만들고, utils/label/labelTypes.ts 의
// SOURCE_PRODUCT_FIELDS.stock 과 일치해야 한다 (편집기 필드 드롭다운).
//
// 흐름:
//   1. 항목마다 대상 판정 — audience 가 있으면 그대로, 없으면 권장연령 유무로
//   2. 대상별 템플릿은 호출 측(드롭다운, useLabelTemplatePlan)이 골라서 넘긴다.
//      필요한 대상에 템플릿이 없으면 아무것도 찍지 않고 안내만 돌려준다.
//   3. 프린터 — "이 템플릿을 이 PC 에서 어떤 프린터로" (utils/label/localPrinterMap.ts —
//      [라벨 설정] 프린터 탭과 같은 저장소). 모든 그룹의 프린터를 먼저 확인하고 나서 인쇄한다
//   4. 템플릿(=프린터)별로 묶어 바인딩(상품 + 계정 정보) → 명령(TSPL/ZPL, 템플릿의 printer_lang) → QZ RAW
//   5. label_print_logs 기록 (실패해도 인쇄 성공은 유지)
//
// 오류 문구는 i18n 키로 돌려준다 (호출 측이 t() 로 번역).
// buildPrintJobs() 는 같은 준비 과정을 인쇄 없이 돌려 TSPL/ZPL 바이트만 만든다 (진단용 다운로드).
// ============================================================

/** 인쇄할 항목 1개 */
export interface LabelPrintItem {
  /** 템플릿에 바인딩되는 값 — 키는 productFieldsFor('stock') 과 일치 */
  data: LabelData;
  /** 장수 */
  qty: number;
  /** 성인/키즈를 직접 정할 때. 없으면 data.recommanded_age 유무로 판정 */
  audience?: LabelAudience;
}

/** 대상별로 고른 템플릿 — 그 대상의 항목이 없으면 키 자체가 없어도 된다 */
export type AudienceTemplates = Partial<Record<LabelAudience, LabelTemplate | null>>;

export interface PrintLabelParams {
  items: LabelPrintItem[];
  /** 사업자 (si_users) — 계정 정보 바인딩(acc_*) 과 기록용 */
  account: LabelUser | null;
  labelType: LabelType;
  /** 대상(성인/키즈)별 템플릿 — 드롭다운에서 확정된 값 */
  templates: AudienceTemplates;
  /** 인쇄한 사람 (기록용 — 로그인 계정 아이디) */
  printedBy?: string | null;
}

/** 인쇄 직전까지 준비된 작업 1건 — 템플릿, 그 템플릿으로 찍을 항목들 */
export interface PrintJob {
  template: LabelTemplate;
  rows: LabelPrintItem[];
}

/** 결과 — errorKey 는 i18n 키(print.*), errorParams 는 치환값 */
export interface PrintLabelResult {
  success: boolean;
  printed: number;
  errorKey?: string;
  errorParams?: Record<string, string | number>;
  /** 라이브러리가 준 원문 (있으면 errorKey 문구 뒤에 괄호로 붙인다) */
  errorDetail?: string;
}

/** 항목의 대상 — 직접 지정 > 권장연령 유무 */
export function itemAudience(it: LabelPrintItem): LabelAudience {
  if (it.audience === 'kids' || it.audience === 'adult') return it.audience;
  const age = it.data.recommanded_age;
  return audienceOfItem(age == null ? null : String(age));
}

/**
 * 항목 → 라벨 바인딩 데이터
 *   항목 값 그대로 + qty + 계정 정보(acc_*). null 은 빈 문자열로.
 */
function toLabelData(it: LabelPrintItem, account: LabelUser | null): LabelData {
  const out: LabelData = {};
  for (const [k, v] of Object.entries(it.data)) {
    out[k] = typeof v === 'boolean' ? (v ? 'Y' : '') : v == null ? '' : v;
  }
  out.qty = it.qty;
  return { ...out, ...accountFieldsToLabelData(account) };
}

// ============================================================
// 템플릿 자동 선택 — (사업자 + 종류 + 대상)
//   사용자 기본 → 공용 기본 → 사용자 첫째 → 공용 첫째. 그 대상을 가진 템플릿만 후보.
//   (출처는 조회 단계에서 이미 걸러져 있다)
// ============================================================
export function pickTemplate(
  templates: LabelTemplate[],
  userId: string | null,
  labelType: LabelType,
  audience: LabelAudience
): LabelTemplate | null {
  const candidates = templates.filter(
    (t) => t.label_type === labelType && templateHasAudience(t, audience)
  );
  const isSpecificallyFor = (t: LabelTemplate) =>
    !!t.user_ids && t.user_ids.length > 0 && userId != null && t.user_ids.includes(userId);
  const isShared = (t: LabelTemplate) => !t.user_ids || t.user_ids.length === 0;

  return (
    candidates.find((t) => t.is_default && isSpecificallyFor(t)) ??
    candidates.find((t) => t.is_default && isShared(t)) ??
    candidates.find((t) => isSpecificallyFor(t)) ??
    candidates.find((t) => isShared(t)) ??
    null
  );
}

/** 항목들을 대상별로 나눈다 — 항목이 없는 대상은 키가 없다 */
export function groupByAudience(items: LabelPrintItem[]): Partial<Record<LabelAudience, LabelPrintItem[]>> {
  const out: Partial<Record<LabelAudience, LabelPrintItem[]>> = {};
  for (const it of items) (out[itemAudience(it)] ??= []).push(it);
  return out;
}

// ============================================================
// 1)~3) 항목 → 템플릿별 작업 묶음 (인쇄·진단 공용)
//   대상별로 나누고, 대상마다 템플릿이 있는지 확인한 뒤, 같은 템플릿끼리 합친다.
//   템플릿이 빠진 대상이 있으면 작업을 만들지 않고 그 대상 목록을 돌려준다.
// ============================================================
function planJobs(
  items: LabelPrintItem[],
  templates: AudienceTemplates
): { jobs: PrintJob[] } | { missing: LabelAudience[] } {
  const byAudience = groupByAudience(items);
  const missing = (Object.keys(byAudience) as LabelAudience[]).filter((a) => !templates[a]);
  if (missing.length > 0) return { missing };

  const jobs = new Map<string, PrintJob>();
  for (const a of Object.keys(byAudience) as LabelAudience[]) {
    const template = templates[a]!;
    const job = jobs.get(template.id) ?? { template, rows: [] };
    job.rows.push(...byAudience[a]!);
    jobs.set(template.id, job);
  }
  return { jobs: Array.from(jobs.values()) };
}

/** 작업 1건 → TSPL/ZPL 바이트 (템플릿의 printer_lang. 이미지·글꼴을 먼저 읽어 둔다) */
async function buildJobBytes(job: PrintJob, account: LabelUser | null): Promise<Uint8Array> {
  await preloadTemplateAssets(job.template); // 이미지·글꼴이 빠진 채 나가지 않게
  return buildLabelBatch(
    job.template,
    job.rows.map((it) => ({ data: toLabelData(it, account), copies: it.qty }))
  );
}

/**
 * 진단용 — 인쇄와 똑같이 준비하되 프린터로 보내지 않고 템플릿별 명령 바이트를 돌려준다.
 * 프린터가 지정되지 않았어도 만든다 (무엇이 나갈지 보는 게 목적).
 * 템플릿이 빠진 대상이 있으면 빈 배열.
 */
export async function buildPrintJobs(
  params: Pick<PrintLabelParams, 'items' | 'account' | 'templates'>
): Promise<{ template: LabelTemplate; printer: string | null; bytes: Uint8Array; labels: number }[]> {
  const planned = planJobs(params.items, params.templates);
  if ('missing' in planned) return [];
  const out = [];
  for (const job of planned.jobs) {
    out.push({
      template: job.template,
      printer: getLocalPrinter(job.template.id),
      bytes: await buildJobBytes(job, params.account),
      labels: job.rows.reduce((n, it) => n + it.qty, 0),
    });
  }
  return out;
}

export async function printLabels(params: PrintLabelParams): Promise<PrintLabelResult> {
  const { items, account, labelType, templates, printedBy } = params;

  if (items.length === 0) return { success: false, printed: 0, errorKey: 'print.noItems' };

  try {
    // ── 1)~3) 대상별 분류 → 템플릿 확인 → 템플릿별 묶기 ──
    const planned = planJobs(items, templates);
    if ('missing' in planned) {
      return {
        success: false,
        printed: 0,
        errorKey: 'print.noTemplate',
        errorParams: { audienceKeys: planned.missing.join(','), labelType },
      };
    }
    const jobs = planned.jobs;

    // ── 4) 프린터 — 전부 먼저 확인 (반만 찍히는 일 방지) ──
    const printers = new Map<string, string>();
    for (const { template } of jobs) {
      const printer = getLocalPrinter(template.id);
      if (!printer) {
        return {
          success: false,
          printed: 0,
          errorKey: 'print.printerNotSet',
          errorParams: { name: template.name },
        };
      }
      printers.set(template.id, printer);
    }

    // ── 5) 명령(TSPL/ZPL) 생성 + QZ 인쇄 (템플릿별) ──
    for (const job of jobs) {
      const bytes = await buildJobBytes(job, account);
      await printRaw(printers.get(job.template.id)!, bytes);
    }

    // ── 6) 기록 (실패해도 인쇄 성공은 유지) ──
    try {
      await insertLabelPrintLogs(
        jobs.flatMap(({ template, rows }) =>
          rows.map((it) => ({
            template_id: template.id,
            user_id: account?.id ?? null,
            barcode: it.data.barcode == null ? null : String(it.data.barcode),
            item_name: [it.data.item_name, it.data.option_name].filter(Boolean).join(', ') || null,
            qty: it.qty,
            label_type: labelType,
            printed_by: printedBy ?? null,
          }))
        )
      );
    } catch (logErr) {
      console.error('인쇄 기록 저장 실패(무시):', logErr);
    }

    return { success: true, printed: items.reduce((n, it) => n + it.qty, 0) };
  } catch (error) {
    console.error('라벨 인쇄 오류:', error);
    return {
      success: false,
      printed: 0,
      errorKey: 'print.qzNotRunning',
      errorDetail: error instanceof Error ? error.message : undefined,
    };
  }
}
