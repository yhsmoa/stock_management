
import { useEffect, useState } from 'react';
import { subscribeRaster } from '../../utils/label/labelRender';

// ============================================================
// 이미지가 늦게 읽혔을 때 미리보기·캔버스를 다시 그리게 하는 신호
//   래스터 엔진이 notify 하면 숫자가 하나 올라간다 → 의존성에 넣어 재계산
// ============================================================

export function useRasterVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeRaster(() => setVersion((v) => v + 1)), []);
  return version;
}
