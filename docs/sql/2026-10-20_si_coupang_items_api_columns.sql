-- ════════════════════════════════════════════════════════════════
-- si_coupang_items — 쿠팡 Open API 동기화용 칼럼 추가 (2026-10-20)
--   상품관리(/coupang) 를 엑셀 업로드 → API 기본 + 엑셀 보조로 바꾸면서 필요한 칼럼.
--   모두 nullable 추가라 기존 행·기존 코드(엑셀 업로드, 라벨, Q반품 등)에 영향 없음.
--   Supabase 대시보드 › SQL Editor 에서 한 번 실행한다. (여러 번 실행해도 안전)
-- ════════════════════════════════════════════════════════════════

-- ── 출처 구분 ───────────────────────────────────────────────────
-- 'MP' = 판매자배송(일반) 옵션, 'RG' = 로켓그로스 옵션.
-- null = 엑셀로만 들어온 예전 행 → 화면은 바코드 유무로 판단 (바코드 있음 = 로켓그로스, 2026-10-20 실측 일치)
alter table public.si_coupang_items add column if not exists channel text;

-- ── 상세 API 에서만 오는 값 ─────────────────────────────────────
alter table public.si_coupang_items add column if not exists img_url text;                  -- 대표 이미지 (purchaseService.getRepresentativeImageUrl 형식)
alter table public.si_coupang_items add column if not exists delivery_charge_type text;     -- FREE / NOT_FREE / CHARGE_RECEIVED / CONDITIONAL_FREE
alter table public.si_coupang_items add column if not exists delivery_charge integer;       -- 기본 배송비
alter table public.si_coupang_items add column if not exists free_ship_over_amount integer; -- 조건부 무료배송 기준 금액

-- ── 출처별 마지막 반영 시각 (엑셀 ↔ API 중 최근 값 판단용) ─────────
alter table public.si_coupang_items add column if not exists detail_synced_at timestamptz;  -- 상품 상세 API 로 받은 시각
alter table public.si_coupang_items add column if not exists status_checked_at timestamptz; -- 판매상태 API(inventories) 로 확인한 시각
alter table public.si_coupang_items add column if not exists app_changed_at timestamptz;    -- 이 앱에서 가격·재고·판매상태를 바꾼 시각
alter table public.si_coupang_items add column if not exists excel_synced_at timestamptz;   -- 가격/재고 엑셀 업로드로 반영된 시각

-- ── 화면 조회용 인덱스 (계정 + 등록상품 ID 로 묶어 보여 준다) ─────────
create index if not exists si_coupang_items_user_item_idx
  on public.si_coupang_items (user_id, item_id);
