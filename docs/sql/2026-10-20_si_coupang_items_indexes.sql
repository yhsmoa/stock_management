-- ════════════════════════════════════════════════════════════════
-- si_coupang_items — 상품관리 화면 조회용 인덱스 (2026-10-20)
--   계정당 7.8만 행에서 필터별 count · 정렬 페이지 · 마지막 동기화 시각 조회를 빠르게 한다.
--   (각 쿼리 0.3~0.8초 → 수십 ms). 없어도 동작은 하지만 한 화면에 쿼리가 10개 넘게 돌아 느리다.
--   Supabase 대시보드 › SQL Editor 에서 한 번 실행. (여러 번 실행해도 안전)
-- ════════════════════════════════════════════════════════════════

-- 목록 페이지 정렬 (user_id = ? order by item_id desc, option_id)
create index if not exists si_coupang_items_user_item_option_idx
  on public.si_coupang_items (user_id, item_id desc, option_id);

-- 판매상태 · 재고 0 · 출처 필터 count
create index if not exists si_coupang_items_user_sales_status_idx
  on public.si_coupang_items (user_id, sales_status);
create index if not exists si_coupang_items_user_stock_idx
  on public.si_coupang_items (user_id, stock);
create index if not exists si_coupang_items_user_channel_idx
  on public.si_coupang_items (user_id, channel);

-- 마지막 동기화 시각 (not null 인 행만 · 최신순) + "미수신 / 미확인" count
create index if not exists si_coupang_items_user_detail_synced_idx
  on public.si_coupang_items (user_id, detail_synced_at desc) where detail_synced_at is not null;
create index if not exists si_coupang_items_user_status_checked_idx
  on public.si_coupang_items (user_id, status_checked_at desc) where status_checked_at is not null;
create index if not exists si_coupang_items_user_excel_synced_idx
  on public.si_coupang_items (user_id, excel_synced_at desc) where excel_synced_at is not null;
