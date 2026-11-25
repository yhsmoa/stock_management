-- ================================================================
-- coupang_personal_orders.extra_ship_qty — 개인주문 '추가발송' 남은 수량 (2026-11-25)
--   출고준비에서 수량이 모자랐던 줄(추가★)의 "다음에 들어오면 더 보낼 수량".
--   배정된 수량은 그날 출고하고(쿠팡 송장 등록), 남은 수량만 여기에 적어 둔다.
--     null · 0 = 추가발송 없음
--     > 0     = 그만큼 더 보내야 함 (화면: 노란 [추가발송 N] 표시, 눌러서 해제)
--   쿠팡에는 없는 값이다 — [주문 업데이트] 는 이 칸을 이월한다(savePersonalOrders).
--   기존 행은 그대로 null (추가발송 없음).
-- ================================================================

alter table public.coupang_personal_orders
  add column if not exists extra_ship_qty integer;

comment on column public.coupang_personal_orders.extra_ship_qty is
  '추가발송 남은 수량 — 출고준비에서 모자라 다음 입고 때 더 보낼 수량 (null·0 = 없음)';
