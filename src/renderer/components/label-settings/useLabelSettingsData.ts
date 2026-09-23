import { useCallback, useEffect, useMemo, useState } from 'react';
import { listPrinterDetails, type PrinterInfo } from '../../utils/label/qzTray';
import type { LabelTemplate } from '../../utils/label/labelTypes';
import {
  fetchLabelTemplates,
  fetchLabelUser,
  type LabelUser,
} from '../../services/labelTemplateService';
import { getCurrentLabelAccount } from '../../services/labelService';

export type { LabelUser };

// ============================================================
// 라벨 설정 화면의 데이터
//   · 템플릿 목록      labelTemplateService — 이 앱(stock)의 "내 것 + 공용"
//   · 로그인 계정      si_users 1행 (민감 컬럼 제외) — users 는 [나] 하나뿐이다
//   · QZ Tray 프린터   localhost 웹소켓 — "지금 이 PC" 에 설치된 프린터와 해상도
//
// 프린터를 "어떤 템플릿에 쓸지" 는 서버가 아니라 브라우저에 로컬로 저장한다
// (utils/label/localPrinterMap.ts, LocalPrinterPanel.tsx 가 직접 읽고 쓴다).
// ============================================================

/** 목록·체크리스트 표기: "immong · 김덕준" */
export const userLabel = (u: LabelUser) => [u.username, u.name].filter(Boolean).join(' · ');

export interface LabelSettingsData {
  templates: LabelTemplate[];
  /** 로그인 계정 — 0개(조회 전/실패) 또는 1개 */
  users: LabelUser[];
  loading: boolean;
  qzOk: boolean | null;
  /** 이 PC 의 프린터 (이름 + 해상도) */
  qzPrinters: PrinterInfo[];
  reloadTemplates: () => Promise<void>;
  refreshQz: () => Promise<void>;
}

export function useLabelSettingsData(): LabelSettingsData {
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [users, setUsers] = useState<LabelUser[]>([]);
  const [loading, setLoading] = useState(false);

  const [qzOk, setQzOk] = useState<boolean | null>(null);
  const [qzPrinters, setQzPrinters] = useState<PrinterInfo[]>([]);

  const myId = getCurrentLabelAccount()?.id ?? '';

  // ── 템플릿 ──
  const reloadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      setTemplates(await fetchLabelTemplates(myId));
    } catch (err) {
      console.error('템플릿 조회 오류:', err);
    } finally {
      setLoading(false);
    }
  }, [myId]);

  // ── 로그인 계정 ──
  const reloadUsers = useCallback(async () => {
    try {
      const me = await fetchLabelUser(myId);
      setUsers(me ? [me] : []);
    } catch (err) {
      console.error('계정 조회 오류:', err);
    }
  }, [myId]);

  useEffect(() => {
    reloadTemplates();
    reloadUsers();
  }, [reloadTemplates, reloadUsers]);

  // ── QZ 연결 확인 + 프린터 목록(해상도 포함) ──
  //    실제 왕복 통신 1회로 "연결 여부" 와 "목록" 을 동시에 판정한다.
  const refreshQz = useCallback(async () => {
    setQzOk(null);
    try {
      const printers = await listPrinterDetails();
      setQzPrinters(printers);
      setQzOk(true);
    } catch (err) {
      console.error('QZ Tray 연결/프린터 조회 실패:', err);
      setQzPrinters([]);
      setQzOk(false);
    }
  }, []);

  useEffect(() => {
    refreshQz();
  }, [refreshQz]);

  return useMemo(
    () => ({ templates, users, loading, qzOk, qzPrinters, reloadTemplates, refreshQz }),
    [templates, users, loading, qzOk, qzPrinters, reloadTemplates, refreshQz]
  );
}
