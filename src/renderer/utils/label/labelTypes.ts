// ============================================================
// 라벨 즉시출력 — 공용 타입
//
// 템플릿 레이아웃은 "전부 mm" 로 저장한다.
//   · 프린터 해상도(DPI)가 달라도 양식이 깨지지 않음
//   · 인쇄 순간에만 dots 로 변환 (utils/label/labelRender.ts + utils/label/tspl.ts)
//
// ⚠️ layout 은 DB(JSONB)에 그대로 들어간다. 새 속성은 전부 optional 로 추가해
//    기존에 저장된 템플릿이 그대로 열리도록 유지한다.
// ============================================================

export type LabelType = 'care' | 'barcode';

/**
 * 라벨 데이터 출처 — 출처마다 바인딩할 수 있는 상품 필드가 달라서 템플릿에 출처를 기록한다.
 *   stock  : 이 앱 (si_coupang_items 기반)
 *   rocket : 아이엠몽 로켓 = immongRK_scan (coupang_items 기반) — label-service 가 담당, 같은 표를 쓴다
 * 이 앱은 stock 템플릿만 읽고 쓴다 (APP_LABEL_SOURCE). rocket 은 DB 제약·타입 호환용으로만 남긴다.
 */
export type LabelSource = 'stock' | 'rocket';
export const LABEL_SOURCES: LabelSource[] = ['stock', 'rocket'];
/** 이 앱이 쓰는 출처 — 템플릿 조회·저장·인쇄 기록에 고정으로 쓴다 */
export const APP_LABEL_SOURCE: LabelSource = 'stock';

/**
 * 라벨 대상 — 상품의 권장연령 유무로 갈린다.
 *   adult : 권장연령 없음 (기본)
 *   kids  : 권장연령 있음 (키즈 라벨 — 권장연령을 표기해야 함)
 * 템플릿은 둘 중 하나 또는 둘 다에 쓰일 수 있다 (LabelTemplate.audiences).
 */
export type LabelAudience = 'adult' | 'kids';

export const LABEL_AUDIENCES: { key: LabelAudience; label: string; hint: string }[] = [
  { key: 'adult', label: '성인', hint: '권장연령 없음' },
  { key: 'kids', label: '키즈', hint: '권장연령 있음' },
];

/** 상품 항목의 권장연령 값으로 대상 판정 — 값이 있으면 키즈 */
export function audienceOfItem(recommandedAge: string | null | undefined): LabelAudience {
  return recommandedAge && recommandedAge.trim() ? 'kids' : 'adult';
}

/** 템플릿의 대상 목록 — 옛 행(컬럼 없던 시절)은 성인으로 본다 */
export function templateAudiences(tpl: Pick<LabelTemplate, 'audiences'>): LabelAudience[] {
  return tpl.audiences && tpl.audiences.length > 0 ? tpl.audiences : ['adult'];
}

/** 템플릿이 그 대상에 쓰일 수 있는지 */
export function templateHasAudience(
  tpl: Pick<LabelTemplate, 'audiences'>,
  audience: LabelAudience
): boolean {
  return templateAudiences(tpl).includes(audience);
}

/** 목록·메타 표기용: "성인" / "키즈" / "성인·키즈" */
export function audiencesLabel(tpl: Pick<LabelTemplate, 'audiences'>): string {
  const set = templateAudiences(tpl);
  return LABEL_AUDIENCES.filter((a) => set.includes(a.key))
    .map((a) => a.label)
    .join('·');
}

/**
 * 프린터 명령 언어 (LabelTemplate.printer_lang)
 *   TSPL2 : TSC · Deli · HPRT · Xprinter 등 (utils/label/tspl.ts)
 *   ZPL   : Zebra · BIXOLON BPL-Z 에뮬레이션 · HPRT ZPL 모드 (utils/label/zpl.ts)
 * 프린터가 모르는 언어를 보내면 라벨 대신 프린터 정보 문구가 찍힌다 — 기종에 맞춰 골라야 한다.
 */
export type PrinterLang = 'TSPL2' | 'ZPL';

export const PRINTER_LANGS: { key: PrinterLang; label: string }[] = [
  { key: 'TSPL2', label: 'TSPL (TSC · Deli · HPRT · Xprinter)' },
  { key: 'ZPL', label: 'ZPL (Zebra · BIXOLON BPL-Z · HPRT ZPL 모드)' },
];

/** 템플릿의 명령 언어 — 옛 행이나 모르는 값은 TSPL2 */
export function printerLangOf(tpl: Pick<LabelTemplate, 'printer_lang'>): PrinterLang {
  return tpl.printer_lang === 'ZPL' ? 'ZPL' : 'TSPL2';
}

/** API 본문 정규화 — 아는 값만, 나머지는 TSPL2 */
export function normalizePrinterLang(value: unknown): PrinterLang {
  return value === 'ZPL' ? 'ZPL' : 'TSPL2';
}

/** 용지 종류 (LabelTemplate.media 참고) */
export type LabelMedia = 'gap' | 'continuous' | 'blackmark';

/** 자동 절단 (LabelTemplate.cutter) */
export type LabelCutter = 'off' | 'each' | 'batch';

export const LABEL_CUTTER: { key: LabelCutter; label: string }[] = [
  { key: 'off', label: '절단 안 함' },
  { key: 'each', label: '매 장 절단' },
  { key: 'batch', label: '묶음 끝에 한 번 절단' },
];

export const LABEL_MEDIA: { key: LabelMedia; label: string; hint: string }[] = [
  { key: 'gap', label: '틈 있는 라벨 (일반 스티커)', hint: '라벨 사이 투명 틈을 센서가 찾습니다.' },
  {
    key: 'continuous',
    label: '연속 용지 (케어라벨 리본)',
    hint: '틈이 없는 롤. 틈 설정으로 찍으면 용지를 찾다가 빨간불로 멈춥니다.',
  },
  { key: 'blackmark', label: '블랙마크 용지', hint: '뒷면 검은 띠로 라벨을 구분합니다.' },
];

/** 바코드 심볼로지 (TSPL BARCODE 명령의 코드명과 동일) */
export type Symbology = '128' | '128M' | 'EAN13' | 'EAN8' | 'UPCA' | '39' | '93';

/** 요소 회전 — TSPL 은 시계방향 0/90/180/270 만 지원한다 */
export type Rotation = 0 | 90 | 180 | 270;

/** 텍스트 가로 정렬 (max_w_mm 블록 기준) */
export type TextAlign = 'left' | 'center' | 'right';

/** 텍스트 세로 정렬 (영역 h_mm 기준) */
export type TextVAlign = 'top' | 'middle' | 'bottom';

/**
 * 영역을 넘칠 때
 *   shrink: 글자 크기를 min_pt 까지 줄여 가며 맞춘다 (기본). 그래도 넘치면 잘라내고 경고
 *   clip  : 크기는 그대로 두고 넘치는 줄을 잘라낸다
 */
export type TextOverflow = 'shrink' | 'clip';

/** 자동 축소 하한 (pt) — 이보다 작으면 감열 프린터에서 읽을 수 없다 */
export const DEFAULT_MIN_PT = 5;
/** 자동 축소 단계 (pt) */
export const SHRINK_STEP_PT = 0.5;
/** 기본 줄 간격 배수 */
export const DEFAULT_LINE_GAP = 1.25;

// ============================================================
// 레이아웃 요소
// ============================================================
interface ElementBase {
  /** 편집기 내부 키 (React key / 선택 상태) */
  id: string;
  /** 요소 목록에 표시할 이름. 없으면 내용으로 자동 표기 */
  name?: string;
  x_mm: number;
  y_mm: number;
  /** 시계방향 회전 (기본 0) */
  rotate?: Rotation;
  /** 잠금 — 캔버스에서 드래그/선택 불가 */
  locked?: boolean;
  /** 숨김 — 미리보기·인쇄에서 제외 (양식 시안 비교용) */
  hidden?: boolean;
}

export interface TextElement extends ElementBase {
  type: 'text';
  /**
   * 바인딩 필드명 (LABEL_FIELDS).
   * 지정하면 그 필드값만 출력한다. 비우면 text 를 쓰고, text 안의
   * `{필드명}` 자리표시자가 데이터로 치환된다. (예: `수량 {qty}개`)
   */
  field?: string;
  /** 고정 문구 (+ `{필드}` 자리표시자) */
  text?: string;
  size_pt: number;
  bold?: boolean;
  italic?: boolean;
  /** 글꼴 — 미지정 시 DEFAULT_FONT */
  font_family?: string;
  /** 가로 정렬 (max_w_mm 블록 기준, 기본 left) */
  align?: TextAlign;
  /** 영역 폭 (mm). 없으면 라벨 우측 끝까지 */
  max_w_mm?: number;
  /**
   * 영역 높이 (mm) — 바텐더의 "텍스트 상자".
   * 지정하면 영역 모드: 폭에서 항상 줄바꿈하고, 높이를 넘는 줄은 overflow 정책대로.
   * 없으면 한 줄 모드 (wrap / max_lines 가 적용되는 옛 방식).
   */
  h_mm?: number;
  /** 영역 모드에서 넘칠 때 (기본 shrink) */
  overflow?: TextOverflow;
  /** 자동 축소 하한 pt (기본 DEFAULT_MIN_PT) */
  min_pt?: number;
  /** 영역 안 세로 정렬 (기본 top) */
  v_align?: TextVAlign;
  /**
   * [한 줄 모드 전용] 자동 줄바꿈. 영역 모드(h_mm)에서는 항상 켜진 것으로 본다.
   */
  wrap?: boolean;
  /** [한 줄 모드 전용] 최대 줄 수. 영역 모드에서는 높이로 계산된다 */
  max_lines?: number;
  /** 줄 간격 배수 (기본 1.25) */
  line_gap?: number;
  /** 글자 간격 (mm) — 음수 가능. 좁은 라벨에서 미세 조정용 */
  letter_spacing_mm?: number;
  /** 검정 배경 + 흰 글씨 (반전) */
  invert?: boolean;
}

export interface BarcodeElement extends ElementBase {
  type: 'barcode';
  field?: string;
  text?: string;
  symbology: Symbology;
  h_mm: number;
  /** 좁은 바 두께 (dots) — 2~3 권장 */
  narrow: number;
  /** 넓은 바 두께 (dots) — Code39 등 2폭 심볼로지용 (Code128 은 narrow 만 쓴다) */
  wide: number;
  /** 바코드 아래 숫자 표시 */
  human_readable?: boolean;
  /** 아래 숫자 글자 크기 pt (기본 7) */
  text_pt?: number;
  /**
   * 정렬 — 바코드 폭은 데이터 길이로 정해지므로 "영역 폭(max_w_mm)" 안에서 놓는다.
   * max_w_mm 이 없으면 라벨 오른쪽 끝까지가 영역. 기본 left.
   */
  align?: TextAlign;
  /** 정렬 기준 영역 폭 (mm). 없으면 x 부터 라벨 오른쪽 끝까지 */
  max_w_mm?: number;
}

export interface QrElement extends ElementBase {
  type: 'qr';
  field?: string;
  text?: string;
  /** 셀 크기 1~10 (dots/모듈) */
  cell: number;
  /** 오류정정 L/M/Q/H */
  ecc: 'L' | 'M' | 'Q' | 'H';
  /** 정렬 (바코드와 같은 규칙) */
  align?: TextAlign;
  /** 정렬 기준 영역 폭 (mm) */
  max_w_mm?: number;
}

export interface BoxElement extends ElementBase {
  type: 'box';
  w_mm: number;
  h_mm: number;
  /** 선 두께 (mm) */
  thickness_mm: number;
  /** 내부 채우기 (검정) */
  filled?: boolean;
}

export interface LineElement extends ElementBase {
  type: 'line';
  w_mm: number;
  h_mm: number;
}

/**
 * 이미지 — 세탁 기호·로고 등. 흑백 1비트로 찍힌다.
 *   symbol: 내장 세탁 기호 키 (utils/label/careSymbols.ts) — 템플릿이 가벼움
 *   src   : 업로드한 이미지 data URL (PNG/SVG) — 로고 등
 * 둘 다 있으면 symbol 우선.
 */
export interface ImageElement extends ElementBase {
  type: 'image';
  symbol?: string;
  src?: string;
  w_mm: number;
  h_mm: number;
  /** 크기 조절 시 가로세로 비율 유지 (기본 true) */
  keep_ratio?: boolean;
  /** 흑백 변환 임계값 0~255 (기본 128). 낮을수록 검정이 줄어든다 */
  threshold?: number;
}

export type LabelElement =
  | TextElement
  | BarcodeElement
  | QrElement
  | BoxElement
  | LineElement
  | ImageElement;

/** 데이터 바인딩이 가능한 요소 (field / text 를 가진 것) */
export type BindableElement = TextElement | BarcodeElement | QrElement;

export function isBindable(el: LabelElement): el is BindableElement {
  return el.type === 'text' || el.type === 'barcode' || el.type === 'qr';
}

// ============================================================
// 템플릿
// ============================================================
export interface LabelTemplate {
  id: string;
  /**
   * 이 템플릿을 쓸 수 있는 si_users.id 목록.
   * null/빈 배열 = 공용(모든 사용자). 값이 있으면 그 사용자들 전용.
   *   한 템플릿을 여러 사업자가 같이 쓸 수도 있어서 배열이다 (예: 같은 양식을 쓰는 두 브랜드).
   */
  user_ids: string[] | null;
  name: string;
  /**
   * 템플릿 설명 — 드롭다운·목록에서 이름 아래 두 번째 줄로 보인다.
   * 작업자가 이름만으로 헷갈릴 때 고를 수 있게 보조 설명을 넣어 둔다 (예: 용지 크기·대상).
   */
  description?: string | null;
  /**
   * 대상 — 권장연령 없는 상품(adult) / 있는 상품(kids). 둘 다 가능.
   * 인쇄 시 상품마다 권장연령 유무로 대상을 정하고, 그 대상을 가진 템플릿만 자동 선택된다.
   */
  audiences: LabelAudience[];
  /** 출처 — 출처별로 바인딩 가능한 필드가 다르다 (productFieldsFor). 이 앱은 항상 stock */
  source: LabelSource;
  label_type: LabelType;
  /** 프린터 명령 언어 — 'TSPL2' | 'ZPL' (printerLangOf 로 읽는다. DB 는 text 라 string) */
  printer_lang: string;
  width_mm: number;
  height_mm: number;
  /**
   * 라벨 사이 틈(mm). media 가 gap 이면 GAP 명령, blackmark 면 BLINE(마크 높이)로 나간다.
   * continuous 에서는 무시된다.
   */
  gap_mm: number;
  /**
   * 용지 종류 — 센서 설정이 달라서 틀리면 프린터가 용지를 찾다가 빨간불로 멈춘다.
   *   gap        : 라벨 사이에 틈이 있는 일반 스티커 (기본)
   *   continuous : 틈 없는 연속 용지 — 케어라벨 리본(나일론·새틴)이 여기 해당
   *   blackmark  : 뒷면 검은 띠로 구분하는 용지
   */
  media?: LabelMedia;
  /** 자동 절단 — 절단기 달린 프린터에서 SET CUTTER 로 나간다 (기본 off) */
  cutter?: LabelCutter;
  dpi: number;
  /**
   * 인쇄 농도 0~15 (TSPL DENSITY). 비우면 프린터 기본값.
   * RAW 인쇄는 Windows "인쇄 기본 설정" 창의 농도/속도를 거치지 않으므로 여기서 정한다.
   */
  density?: number | null;
  /** 인쇄 속도 inch/s (TSPL SPEED). 비우면 프린터 기본값 */
  speed?: number | null;
  layout: LabelElement[];
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

/** PC-NO(작업 자리)별 프린터 매핑 — 레거시(V1) 호환용. 새 인쇄 경로는 utils/label/localPrinterMap.ts 를 쓴다 */
export interface LabelPrinterMap {
  id?: string;
  station_no: number;
  label_type: LabelType;
  qz_printer_name: string;
}

/** 템플릿이 공용인지 (모든 사용자가 쓸 수 있는지) */
export function isSharedTemplate(tpl: Pick<LabelTemplate, 'user_ids'>): boolean {
  return !tpl.user_ids || tpl.user_ids.length === 0;
}

/** 이 템플릿을 그 사용자가 쓸 수 있는지 (공용이거나 목록에 포함) */
export function templateUsableBy(
  tpl: Pick<LabelTemplate, 'user_ids'>,
  userId: string | null
): boolean {
  if (isSharedTemplate(tpl)) return true;
  return userId != null && !!tpl.user_ids?.includes(userId);
}

// ============================================================
// 라벨에 바인딩되는 값
//   saveLabelData 가 만드는 라벨 1장의 값과 동일하게 유지한다.
// ============================================================
export interface LabelData {
  brand?: string | null;
  item_name?: string | null;
  barcode?: string | null;
  product_no?: string | null;
  /** P / A / B / C / X — resolveScanSizeCode 결과 */
  shipment_size?: string | null;
  composition?: string | null;
  recommanded_age?: string | null;
  qty?: number | null;
  [key: string]: unknown;
}

/**
 * 편집기 필드 드롭다운 — 인쇄할 때 템플릿에 바인딩되는 상품 값.
 *
 * 공통 필드는 두 출처가 모두 갖는 최소 집합이고, 그 아래는 출처별 컬럼이다.
 * stock 키는 services/labelService.ts 의 toLabelPrintItems() 가 채우는 키와 반드시 일치시킨다.
 * 화면 이름은 ko.json (labelSettings.fields.*), label 은 폴백이다.
 */
type FieldDef = { key: string; label: string };

/** 두 출처 공통 — 성인/키즈 판정(recommanded_age)과 수량은 여기 */
export const COMMON_PRODUCT_FIELDS: FieldDef[] = [
  { key: 'barcode', label: '바코드' },
  { key: 'item_name', label: '상품명' },
  { key: 'option_name', label: '옵션명' },
  { key: 'composition', label: '소재' },
  { key: 'recommanded_age', label: '권장연령' },
  { key: 'qty', label: '수량' },
  { key: 'brand', label: '브랜드' },
];

/** 출처별 추가 필드 */
export const SOURCE_PRODUCT_FIELDS: Record<LabelSource, FieldDef[]> = {
  // stock_management — si_coupang_items
  stock: [
    { key: 'product_name', label: '상품명 (등록명)' },
    { key: 'item_code', label: '상품코드' },
    { key: 'option_id', label: '옵션 ID' },
    { key: 'item_id', label: '아이템 ID' },
    { key: 'product_id', label: '상품 ID' },
    { key: 'price', label: '판매가' },
    { key: 'regular_price', label: '정가' },
    { key: 'stock', label: '재고' },
    { key: 'season', label: '시즌' },
    { key: 'note', label: '비고' },
    { key: 'package_type', label: '포장 유형' },
  ],
  // 아이엠몽 로켓 (immongRK_scan, web-production-7466) — coupang_items 컬럼 + rk_inventories 의 재고·위치
  rocket: [
    { key: 'product_name', label: '상품명 (등록명)' },
    { key: 'sku_id', label: 'SKU ID' },
    { key: 'request_number', label: '요청번호' },
    { key: 'order_status', label: '발주가능상태' },
    { key: 'brand_manager', label: '브랜드 담당자' },
    { key: 'instock_manager', label: '입고 담당자' },
    { key: 'size_width', label: '가로 (mm)' },
    { key: 'size_length', label: '세로 (mm)' },
    { key: 'size_height', label: '높이 (mm)' },
    { key: 'weight', label: '무게 (g)' },
    { key: 'moq', label: 'MOQ' },
    { key: 'inner_qty', label: '내박스 수량' },
    { key: 'box_qty', label: '박스 수량' },
    { key: 'box_barcode', label: '박스 바코드' },
    { key: 'stock', label: '재고' },
    { key: 'location', label: '로케이션' },
  ],
};

/** 출처 하나가 쓸 수 있는 필드 (공통 + 출처별) */
export function productFieldsFor(source: LabelSource): FieldDef[] {
  return [...COMMON_PRODUCT_FIELDS, ...(SOURCE_PRODUCT_FIELDS[source] ?? [])];
}

/** 모든 출처의 필드 합집합 — 요소 목록 표기·미리보기 데이터 편집처럼 출처를 모를 때 */
export const PRODUCT_FIELDS: FieldDef[] = (() => {
  const seen = new Set<string>();
  const out: FieldDef[] = [];
  for (const f of [...COMMON_PRODUCT_FIELDS, ...LABEL_SOURCES.flatMap((s) => SOURCE_PRODUCT_FIELDS[s])]) {
    if (seen.has(f.key)) continue;
    seen.add(f.key);
    out.push(f);
  }
  return out;
})();

/**
 * 편집기 필드 드롭다운 — 선택된 사업자(si_users) 계정 정보.
 * 비밀번호·쿠팡 API 키는 라벨에 찍을 이유가 없어서 뺐다.
 * 값은 printLabels()/미리보기가 LabelData 에 `acc_` 접두사로 merge 해서 채운다
 * (상품 필드와 이름이 겹치지 않게 하기 위함).
 */
export const ACCOUNT_FIELDS: FieldDef[] = [
  { key: 'acc_username', label: '아이디' },
  { key: 'acc_name', label: '담당자명' },
  { key: 'acc_seller_id', label: '판매자 ID' },
  { key: 'acc_vendor_id', label: '벤더 ID' },
  { key: 'acc_phone_number', label: '전화번호' },
  { key: 'acc_email_address', label: '이메일' },
];

/** 바인딩 드롭다운에 그룹으로 같이 보여줄 전체 필드 (상품 + 계정) */
export const ALL_BINDABLE_FIELDS = [
  { group: '상품 데이터', fields: PRODUCT_FIELDS },
  { group: '계정 정보', fields: ACCOUNT_FIELDS },
];

/** printLabels()/미리보기에서 사업자(si_users 행)를 LabelData 에 병합할 때 쓴다 */
export function accountFieldsToLabelData(user: {
  username?: string | null;
  name?: string | null;
  seller_id?: string | null;
  vendor_id?: string | null;
  phone_number?: string | null;
  email_address?: string | null;
} | null): Partial<LabelData> {
  if (!user) return {};
  return {
    acc_username: user.username ?? '',
    acc_name: user.name ?? '',
    acc_seller_id: user.seller_id ?? '',
    acc_vendor_id: user.vendor_id ?? '',
    acc_phone_number: user.phone_number ?? '',
    acc_email_address: user.email_address ?? '',
  };
}

/** 미리보기/테스트출력용 샘플 값 (상품 데이터 + 계정 정보) */
export const SAMPLE_LABEL_DATA: LabelData = {
  barcode: '8809123456789',
  item_name: '여성 블라우스 SM-BBTHDY5F207',
  option_name: '아이보리',
  composition: '폴리에스터 100%',
  recommanded_age: '5-7세 (권장)',
  qty: 3,
  brand: 'IMMONG',
  product_name: '여성 블라우스 SM-BBTHDY5F207, 아이보리',
  item_code: 'IM-260618-0049',
  option_id: '91234567890',
  item_id: '12345678901',
  product_id: '7654321',
  price: 19900,
  regular_price: 25900,
  stock: 12,
  season: '2026 SS',
  note: '',
  package_type: '폴리백',
  sku_id: '26606454',
  location: 'A-01-03',
  request_number: 'REQ-2026-0001',
  order_status: '정상',
  brand_manager: '홍길동',
  instock_manager: '김담당',
  size_width: 350,
  size_length: 250,
  size_height: 80,
  weight: 250,
  moq: 1,
  inner_qty: 1,
  box_qty: 25,
  box_barcode: '',
  acc_username: 'immong',
  acc_name: '홍길동',
  acc_seller_id: '7974412345',
  acc_vendor_id: 'A00012345',
  acc_phone_number: '010-0000-0000',
  acc_email_address: 'sample@example.com',
};

// ============================================================
// 글꼴
//
// ⚠️ 텍스트는 인쇄 PC 브라우저의 canvas 로 래스터해서 보내므로,
//    "인쇄 PC 에 설치된 글꼴" 또는 "이 사이트가 내려주는 웹폰트(WEB_FONTS)" 만 실제로 적용된다.
//    편집기에서 설치 여부를 확인해 경고를 띄운다 (isFontAvailable).
//    웹폰트는 app/layout.tsx 의 <link> 로 받아오고, 래스터 직전에 ensureFontsLoaded 로 기다린다.
// ============================================================
export const DEFAULT_FONT = 'NanumSquare';

/** 사이트가 직접 내려주는 웹폰트 — 인쇄 PC 에 설치돼 있지 않아도 쓸 수 있다 */
export const WEB_FONTS: string[] = ['NanumSquare'];

export const LABEL_FONTS: { key: string; label: string }[] = [
  { key: 'NanumSquare', label: '나눔스퀘어 (네이버 · 웹폰트)' },
  { key: 'Malgun Gothic', label: '맑은 고딕' },
  { key: 'Noto Sans KR', label: 'Noto Sans KR' },
  { key: 'NanumGothic', label: '나눔고딕' },
  { key: 'Gulim', label: '굴림' },
  { key: 'Dotum', label: '돋움' },
  { key: 'Batang', label: '바탕' },
  { key: 'Arial', label: 'Arial' },
  { key: 'Tahoma', label: 'Tahoma' },
  { key: 'Consolas', label: 'Consolas (고정폭)' },
];

/** canvas/CSS 용 폰트 스택 — 지정 글꼴 실패 시 한글 가능한 순서로 폴백 */
export function fontStack(family?: string): string {
  const base = '"NanumSquare", "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  return family ? `"${family}", ${base}` : base;
}

// ============================================================
// 텍스트 바인딩
// ============================================================

/** `{필드}` 자리표시자를 데이터로 치환 (알 수 없는 필드는 빈 문자열) */
export function interpolate(tpl: string, data: LabelData): string {
  return tpl.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key: string) => {
    const v = data[key];
    return v == null ? '' : String(v);
  });
}

/** 요소에서 실제 출력 문자열 뽑기 (field 우선, 없으면 text + 자리표시자) */
export function resolveElementText(el: BindableElement, data: LabelData): string {
  if (el.field) {
    const v = data[el.field];
    return v == null ? '' : String(v);
  }
  return el.text ? interpolate(el.text, data) : '';
}

/** 요소 목록에 보여줄 라벨 (name → 필드명 → 고정문구 → 타입) */
export function elementCaption(el: LabelElement): string {
  if (el.name) return el.name;
  if (isBindable(el)) {
    if (el.field) {
      return (
        PRODUCT_FIELDS.find((f) => f.key === el.field)?.label ??
        ACCOUNT_FIELDS.find((f) => f.key === el.field)?.label ??
        el.field
      );
    }
    if (el.text) return `"${el.text}"`;
  }
  if (el.type === 'image') return el.symbol ? `기호 ${el.symbol}` : '업로드 이미지';
  return ELEMENT_TYPE_LABEL[el.type];
}

export const ELEMENT_TYPE_LABEL: Record<LabelElement['type'], string> = {
  text: '텍스트',
  barcode: '바코드',
  qr: 'QR',
  box: '박스',
  line: '선',
  image: '이미지',
};

// ============================================================
// 텍스트 영역 헬퍼
// ============================================================

/** 영역 모드(텍스트 상자) 여부 */
export function isTextBox(el: TextElement): boolean {
  return typeof el.h_mm === 'number' && el.h_mm > 0;
}

/** 줄 높이 (mm) — pt × 줄간격 */
export function lineHeightMm(sizePt: number, lineGap = DEFAULT_LINE_GAP): number {
  return (sizePt * lineGap * 25.4) / 72;
}

/**
 * N줄이 "확실히" 들어가는 영역 높이 (mm, 0.1mm 단위 올림).
 *
 * 렌더러는 줄 높이를 dots 로 올림(ceil)해서 쓴다. mm 를 정확히 계산하면
 * 그 올림 때문에 1~2 dot 이 모자라 자동 축소가 한 단계 걸린다.
 * 그래서 같은 dpi 로 dots 를 먼저 구하고 0.1mm 단위로 올려 돌려준다.
 */
export function textLinesHeightMm(
  sizePt: number,
  lines: number,
  dpi: number,
  lineGap = DEFAULT_LINE_GAP
): number {
  const fontDots = Math.max(1, Math.round((sizePt / 72) * dpi));
  const lineDots = Math.max(1, Math.ceil(fontDots * lineGap));
  const mm = (lineDots * lines * 25.4) / dpi;
  return Math.ceil(mm * 10) / 10;
}

// ============================================================
// 새 요소 기본값
// ============================================================
export function createElement(type: 'text'): TextElement;
export function createElement(type: 'barcode'): BarcodeElement;
export function createElement(type: 'qr'): QrElement;
export function createElement(type: 'box'): BoxElement;
export function createElement(type: 'line'): LineElement;
export function createElement(type: 'image'): ImageElement;
export function createElement(type: LabelElement['type']): LabelElement;
export function createElement(type: LabelElement['type']): LabelElement {
  const base = { id: newElementId(), x_mm: 2, y_mm: 2, rotate: 0 as Rotation };
  switch (type) {
    case 'text':
      return {
        ...base,
        type: 'text',
        field: 'item_name',
        size_pt: 8,
        font_family: DEFAULT_FONT,
        align: 'left',
      };
    case 'barcode':
      return {
        ...base,
        type: 'barcode',
        field: 'barcode',
        symbology: '128',
        h_mm: 10,
        narrow: 2,
        wide: 2,
        human_readable: true,
      };
    case 'qr':
      return { ...base, type: 'qr', field: 'barcode', cell: 4, ecc: 'M' };
    case 'box':
      return { ...base, type: 'box', w_mm: 20, h_mm: 10, thickness_mm: 0.3 };
    case 'line':
      return { ...base, type: 'line', w_mm: 20, h_mm: 0.4 };
    case 'image':
      return { ...base, type: 'image', symbol: 'wash_30', w_mm: 5, h_mm: 5, keep_ratio: true };
  }
}

/** 요소 id 생성 — 복제/붙여넣기에서도 재사용 */
export function newElementId(): string {
  return `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
