// ============================================================
// 인쇄 명령 생성 — 템플릿의 printer_lang 에 따라 TSPL / ZPL 렌더러로 보낸다
//
// 인쇄·테스트 출력·진단 다운로드가 전부 여기를 거친다. 렌더러를 직접 부르지 말 것 —
// 언어를 잘못 고르면 프린터가 라벨 대신 자기 정보 문구를 찍는다 (utils/label/zpl.ts 상단 참고).
// ============================================================

import { printerLangOf, type LabelData, type LabelTemplate } from './labelTypes';
import { buildTsplBatch, buildTsplJob } from './tspl';
import { buildZplBatch, buildZplJob } from './zpl';

/** 템플릿 + 데이터 → 인쇄 작업 1건 */
export function buildLabelJob(tpl: LabelTemplate, data: LabelData, copies: number): Uint8Array {
  return printerLangOf(tpl) === 'ZPL' ? buildZplJob(tpl, data, copies) : buildTsplJob(tpl, data, copies);
}

/** 여러 항목을 한 번의 전송으로 */
export function buildLabelBatch(
  tpl: LabelTemplate,
  rows: { data: LabelData; copies: number }[]
): Uint8Array {
  return printerLangOf(tpl) === 'ZPL' ? buildZplBatch(tpl, rows) : buildTsplBatch(tpl, rows);
}

/** 진단 다운로드 파일 확장자 */
export function labelJobExt(tpl: Pick<LabelTemplate, 'printer_lang'>): string {
  return printerLangOf(tpl) === 'ZPL' ? 'zpl' : 'tspl';
}
