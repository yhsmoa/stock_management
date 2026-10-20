-- ================================================================
-- si_coupang_items — 고시정보 · 혼용률 (2026-10-20)
--   쿠팡 상품 조회 API 의 items[].notices[] 를 [상세 받기] 때 옵션 행마다 저장한다.
--   · notices     : [{ "category": 고시정보 분류, "name": 항목명, "content": 값 }, ...]
--                   null = 아직 받은 적 없음 / [] = 받았지만 고시정보 없음
--   · composition : notices 에서 뽑은 혼용률 ("제품 소재" · "소재"). "상세페이지 참조" 같은 값은 null
--                   라벨 data.composition 이 이 값을 쓴다 (si_item_info 직접 입력값이 있으면 그쪽 우선)
-- ================================================================

alter table public.si_coupang_items add column if not exists notices jsonb;
alter table public.si_coupang_items add column if not exists composition text;

comment on column public.si_coupang_items.notices is '고시정보 (쿠팡 상품 조회 items[].notices) — null = 미수신, [] = 없음';
comment on column public.si_coupang_items.composition is '혼용률 — 고시정보 "제품 소재"/"소재" 값 (라벨 소재란)';
