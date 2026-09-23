import { useCallback, useEffect, useState } from 'react';
import { listPrinterDetails, type PrinterInfo } from '../../utils/label/qzTray';
import { getAllLocalPrinters, setLocalPrinter } from '../../utils/label/localPrinterMap';

// ============================================================
// 이 PC 프린터 지정 — "이 템플릿을 이 PC 에서 어떤 프린터로"
//
// 저장은 utils/label/localPrinterMap.ts (이 앱의 localStorage) — [라벨 설정] 프린터 탭과
// 같은 저장소라 어느 쪽에서 지정해도 그대로 공유된다.
//
// QZ 연결은 모달이 열릴 때(active) 한 번 시도한다 — 연결마다 허용 창이 뜰 수 있어서.
// [다시 찾기] 는 프린터 목록만 다시 받고 지정값은 건드리지 않는다.
// ============================================================

export type PrinterMap = Record<string, string>;

export interface PrinterAssignments {
  /** null = 조회 중, false = QZ 연결 실패 */
  qzOk: boolean | null;
  printers: PrinterInfo[];
  /** 연결 실패 원문 (라이브러리 메시지) */
  errorDetail: string | null;
  /** 템플릿 id → 이 PC 프린터명 */
  map: PrinterMap;
  refresh: () => void;
  assign: (templateId: string, printerName: string) => void;
}

export function usePrinterAssignments(active: boolean): PrinterAssignments {
  const [qzOk, setQzOk] = useState<boolean | null>(null);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [map, setMap] = useState<PrinterMap>({});

  // ── 프린터 목록 (QZ Tray 왕복) ──
  const refresh = useCallback(async () => {
    setQzOk(null);
    setErrorDetail(null);
    try {
      setPrinters(await listPrinterDetails());
      setQzOk(true);
    } catch (err) {
      console.error('프린터 목록 조회 실패:', err);
      setPrinters([]);
      setQzOk(false);
      setErrorDetail(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // ── 열릴 때: 지정값 다시 읽기(라벨 설정에서 바꿨을 수 있음) + 프린터 목록 ──
  useEffect(() => {
    if (!active) return;
    setMap(getAllLocalPrinters());
    refresh();
  }, [active, refresh]);

  const assign = useCallback((templateId: string, printerName: string) => {
    setLocalPrinter(templateId, printerName);
    setMap(getAllLocalPrinters());
  }, []);

  return { qzOk, printers, errorDetail, map, refresh, assign };
}
