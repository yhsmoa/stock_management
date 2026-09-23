// ============================================================
// 세탁 기호 라이브러리 — 케어라벨용 내장 이미지
//
// KS K 0021 계열의 흔한 기호를 단순 선화 SVG 로 들고 있다.
// 어린이제품 KC 마크(키즈 라벨 필수 표기)도 같은 방식으로 들고 있다.
// 이미지 요소가 symbol 키로 참조하므로 템플릿(JSON)에는 키만 저장된다.
// 100×100 viewBox, 검정 선. 인쇄 시 1비트로 변환되므로 회색·안티앨리어싱은 쓰지 않는다.
// ============================================================

export interface CareSymbol {
  key: string;
  label: string;
  svg: string;
}

const STROKE = 'fill="none" stroke="#000" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"';

/** 세탁조(물결 상단 + 사다리꼴) */
const TUB = `<path ${STROKE} d="M8 36 q10 -9 21 0 t21 0 t21 0 t21 0"/><path ${STROKE} d="M12 40 L24 88 H76 L88 40"/>`;
/** 금지 X */
const CROSS = `<path ${STROKE} d="M16 16 L84 84 M84 16 L16 84"/>`;
/** 정사각형 (건조) */
const SQUARE = `<rect x="12" y="12" width="76" height="76" ${STROKE}/>`;
/** 원 (드라이) */
const CIRCLE = `<circle cx="50" cy="50" r="38" ${STROKE}/>`;
/** 다리미 */
const IRON = `<path ${STROKE} d="M20 72 H88 Q86 46 60 44 H36 L30 56 Q18 58 20 72 Z"/><path ${STROKE} d="M36 44 L40 30 H66"/>`;

const text = (t: string, y: number, size = 26, weight = 'bold') =>
  `<text x="50" y="${y}" font-family="Malgun Gothic, Arial, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="middle" fill="#000">${t}</text>`;

const wrap = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${inner}</svg>`;

/** 손 (손세탁) — 세탁조 안 */
const HAND = `<path ${STROKE} d="M44 70 V52 M52 70 V46 M60 70 V50 M68 70 V56 M40 70 Q40 84 54 84 Q70 84 70 70"/>`;

export const CARE_SYMBOLS: CareSymbol[] = [
  { key: 'wash_30', label: '세탁 30℃', svg: wrap(`${TUB}${text('30', 78, 30)}`) },
  { key: 'wash_40', label: '세탁 40℃', svg: wrap(`${TUB}${text('40', 78, 30)}`) },
  { key: 'wash_60', label: '세탁 60℃', svg: wrap(`${TUB}${text('60', 78, 30)}`) },
  { key: 'hand_wash_30', label: '손세탁 30℃', svg: wrap(`${TUB}${HAND}${text('30', 96, 22)}`) },
  { key: 'wash_separate', label: '단독 세탁', svg: wrap(`${TUB}${text('단독', 76, 26)}`) },
  { key: 'wash_weak', label: '약하게 세탁', svg: wrap(`${TUB}${text('약', 76, 28)}`) },
  { key: 'no_wash', label: '물세탁 금지', svg: wrap(`${TUB}${CROSS}`) },
  { key: 'no_bleach', label: '표백 금지', svg: wrap(`<path ${STROKE} d="M50 12 L92 88 H8 Z"/>${CROSS}`) },
  { key: 'bleach_ok', label: '표백 가능', svg: wrap(`<path ${STROKE} d="M50 12 L92 88 H8 Z"/>`) },
  { key: 'no_tumble_dry', label: '건조기 금지', svg: wrap(`${SQUARE}<circle cx="50" cy="50" r="28" ${STROKE}/>${CROSS}`) },
  { key: 'tumble_dry_low', label: '건조기 약하게', svg: wrap(`${SQUARE}<circle cx="50" cy="50" r="28" ${STROKE}/><circle cx="50" cy="50" r="5" fill="#000"/>`) },
  { key: 'dry_flat', label: '뉘어서 건조', svg: wrap(`${SQUARE}<path ${STROKE} d="M26 50 H74"/>`) },
  { key: 'line_dry', label: '옷걸이 건조', svg: wrap(`${SQUARE}<path ${STROKE} d="M50 26 V74"/>`) },
  { key: 'dry_shade', label: '그늘 건조', svg: wrap(`${SQUARE}<path ${STROKE} d="M20 12 L88 80 M40 12 L88 60 M60 12 L88 40"/>`) },
  { key: 'iron_low', label: '다림질 약하게', svg: wrap(`${IRON}<circle cx="54" cy="60" r="5" fill="#000"/>`) },
  { key: 'iron_mid', label: '다림질 중간', svg: wrap(`${IRON}<circle cx="46" cy="60" r="5" fill="#000"/><circle cx="62" cy="60" r="5" fill="#000"/>`) },
  { key: 'no_iron', label: '다림질 금지', svg: wrap(`${IRON}${CROSS}`) },
  { key: 'dry_clean', label: '드라이클리닝', svg: wrap(`${CIRCLE}`) },
  { key: 'dry_clean_p', label: '드라이클리닝 P', svg: wrap(`${CIRCLE}${text('P', 62, 40)}`) },
  { key: 'no_dry_clean', label: '드라이클리닝 금지', svg: wrap(`${CIRCLE}${CROSS}`) },
  // ── 인증 마크 ──
  // KC 마크 — 굵은 C 안에 K. 감열 인쇄에서 뭉개지지 않게 선을 두껍게 잡는다
  {
    key: 'kc_mark',
    label: 'KC 마크 (어린이제품)',
    svg: wrap(
      `<path fill="none" stroke="#000" stroke-width="13" stroke-linecap="round" d="M80 22 A40 40 0 1 0 80 78"/>` +
        `<path fill="none" stroke="#000" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" d="M46 30 V70 M46 51 L70 30 M46 51 L70 70"/>`
    ),
  },
];

const byKey = new Map(CARE_SYMBOLS.map((s) => [s.key, s]));

export function careSymbol(key: string): CareSymbol | undefined {
  return byKey.get(key);
}

/** 캔버스 <img> 에 바로 넣을 수 있는 data URL */
export function careSymbolDataUrl(key: string): string | null {
  const s = byKey.get(key);
  if (!s) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.svg)}`;
}
