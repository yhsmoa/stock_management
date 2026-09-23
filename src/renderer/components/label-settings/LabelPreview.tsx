
import React, { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from '../../utils/label/i18n';
import type { LabelData, LabelTemplate } from '../../utils/label/labelTypes';
import { renderLabelCanvas } from '../../utils/label/labelRender';
import { useRasterVersion } from './useRasterVersion';

// ============================================================
// 라벨 미리보기 (읽기 전용)
//
// 인쇄에 쓰는 것과 "완전히 같은" 래스터를 화면에 확대해 그린다.
//   1) utils/label/labelRender.renderLabelCanvas 로 프린터 도트 해상도 캔버스 생성
//   2) 화면 배율(px/mm)로 확대 → 사용자가 보는 것이 곧 인쇄 결과
//
// 확대 시에는 스무딩을 끈다 — 프린터의 실제 도트가 보여야
// "이 크기로는 글씨가 뭉갠다" 를 편집 중에 알 수 있다.
// ============================================================

interface LabelPreviewProps {
  template: LabelTemplate;
  data: LabelData;
  /** px per mm — 화면 확대율 */
  scale: number;
  className?: string;
}

const LabelPreview: React.FC<LabelPreviewProps> = ({
  template,
  data,
  scale,
  className,
}) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLCanvasElement>(null);
  // 이미지가 늦게 읽히면 다시 그린다
  const rasterVersion = useRasterVersion();

  // 레이아웃/규격/데이터가 바뀔 때만 다시 그린다
  const renderKey = useMemo(
    () =>
      JSON.stringify({
        w: template.width_mm,
        h: template.height_mm,
        dpi: template.dpi,
        layout: template.layout,
        data,
      }),
    [template.width_mm, template.height_mm, template.dpi, template.layout, data]
  );

  const cssW = Math.max(1, template.width_mm * scale);
  const cssH = Math.max(1, template.height_mm * scale);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const source = renderLabelCanvas(template, data);
    if (!source) return;

    // 화면 밀도가 프린터 밀도보다 낮을 때만 부드럽게 축소한다
    const screenDotsPerMm = scale * dpr;
    const printDotsPerMm = template.dpi / 25.4;
    ctx.imageSmoothingEnabled = screenDotsPerMm < printDotsPerMm;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey, cssW, cssH, scale, rasterVersion]);

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ width: `${cssW}px`, height: `${cssH}px`, display: 'block' }}
      role="img"
      aria-label={t('labelSettings.canvas.previewAria', { w: template.width_mm, h: template.height_mm })}
    />
  );
};

export default LabelPreview;
