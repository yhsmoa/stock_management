-- ════════════════════════════════════════════════════════════════
-- si_coupang_items — 일반판매자 상품(/coupang) 검색 · 건수 속도 (2026-11-26)
--
--   실측 (immong · 옵션 87,886행, 고치기 전):
--     · 상품명 검색 — 목록이 뜰 때까지 0.8~8.6초, 가끔 statement timeout
--       ('%검색어%' 는 기존 btree 인덱스를 못 써서 계정의 행을 전부 읽는다)
--     · 바코드 검색 — 약 1초 (바코드 인덱스 없음)
--     · 판매상태 칩 건수 — count 5번을 차례로 (기본 약 5초 · 상품명 검색 중 13초 이상)
--     · 같은 count 가 0.6초일 때와 5~8초(가끔 timeout)일 때가 있다 — 행이 굵어서(고시정보 JSON 이 행 안에 있다)
--       표를 직접 읽는 조회는 DB 캐시가 식으면 디스크를 읽는다. 인덱스만 읽고 끝나는 조회로 바꾸는 것이 핵심.
--
--   이 파일이 하는 일:
--     1) 상품명 · 업체상품코드 부분 검색용 trigram 인덱스
--     2) 바코드 인덱스
--     3) 목록 · 건수 · 카드 숫자가 인덱스만 읽고 끝나게 하는 인덱스 3개
--     4) 판매상태 칩 건수 5개를 한 번에 세는 함수 (화면: services/coupangProductService.fetchSalesCounts)
--
--   실행: Supabase 대시보드 › SQL Editor 에서 한 번. 여러 번 실행해도 안전하다.
--     · 인덱스를 만드는 동안(수 초 ~ 수십 초) 이 표에 **쓰기가 잠긴다**(읽기는 된다)
--       → [목록 받기] · [상세 받기] · 엑셀 업로드가 돌고 있지 않을 때 실행한다.
--     · 화면 코드는 4) 함수가 없으면 예전 방식(5번 세기)으로 동작한다 — 실행 순서에 묶이지 않는다.
--
--   한계: trigram 은 검색어가 **3글자 이상**일 때 쓰인다. 2글자 검색어("바지")는 여전히 전체를 읽는다
--         (그래도 건수는 5번 → 1번으로 준다).
--
--   되돌리기: 맨 아래 주석.
-- ════════════════════════════════════════════════════════════════

-- ── 1) 부분 검색용 trigram 인덱스 ────────────────────────────────
--   상품명 검색 = item_name ilike '%…%' or product_name ilike '%…%'
--   상품코드 검색 = item_code ilike '%…%'
create extension if not exists pg_trgm with schema extensions;

create index if not exists si_coupang_items_name_code_trgm_idx
  on public.si_coupang_items
  using gin (item_name gin_trgm_ops, product_name gin_trgm_ops, item_code gin_trgm_ops);

-- ── 2) 바코드 인덱스 ─────────────────────────────────────────────
--   바코드 검색(user_id = ? and barcode = ?) · 라벨 · 재고 화면의 바코드 조회.
--   바코드는 로켓그로스 옵션에만 있어 값이 있는 행만 담는다.
create index if not exists si_coupang_items_user_barcode_idx
  on public.si_coupang_items (user_id, barcode)
  where barcode is not null;

-- ── 3) 인덱스만 읽고 끝나는 조회용 ────────────────────────────────
--   a. 목록 첫 단계(판매상태 칩을 고른 상태에서 상품 고르기:
--        user_id = ? and sales_status = ? order by item_id desc, option_id)와
--      칩 건수(sales_status · stock)를 이 인덱스 하나로 끝낸다.
--      기존 si_coupang_items_user_sales_status_idx (user_id, sales_status) 는 이 인덱스의 앞부분과 같다
--      — 효과를 확인한 뒤 지워도 된다 (이 파일에서는 지우지 않는다).
create index if not exists si_coupang_items_user_sales_item_idx
  on public.si_coupang_items (user_id, sales_status, item_id desc, option_id)
  include (stock);

--   b. 카드 숫자 — 상세 미수신 · 고시정보 미수신 행만 담는 작은 인덱스
--      (기존 인덱스는 "받은 행" 쪽만 있어서 미수신 건수는 표를 전부 읽었다)
create index if not exists si_coupang_items_user_detail_missing_idx
  on public.si_coupang_items (user_id)
  where detail_synced_at is null;

create index if not exists si_coupang_items_user_notices_missing_idx
  on public.si_coupang_items (user_id)
  where notices is null;

-- ── 4) 판매상태 칩 건수 — 한 번 훑어서 5개 ────────────────────────
--   조건은 화면의 applyFilters (services/coupangProductService.ts) 와 **같아야 한다** — 한쪽을 바꾸면 같이 바꾼다.
--     p_channel      : 'all' | 'MP' | 'RG'      (channel 우선, 없으면 바코드 유무)
--     p_approval     : 'all' | 'pending'        (승인완료가 아닌 것)
--     p_search_field : 'name' | 'optionId' | 'barcode' | 'itemCode' | 'itemId'
--     p_search       : 검색어 (화면에서 앞뒤 공백을 뗀 값. 비면 검색 없음)
--   조건이 있는 부분만 붙여 실행한다 — 고정된 "(값이 없거나 조건)" 꼴은 인덱스를 못 탄다.
create or replace function public.si_coupang_items_sales_counts(
  p_user_id      uuid,
  p_channel      text default 'all',
  p_approval     text default 'all',
  p_search_field text default 'name',
  p_search       text default ''
)
returns table (total bigint, on_sale bigint, off_sale bigint, zero_stock bigint, unchecked bigint)
language plpgsql
stable
as $$
declare
  v_where   text := 'user_id = $1';
  v_search  text := coalesce(p_search, '');
  -- PostgREST 의 ilike 는 '*' 도 '%' 로 읽는다 — 목록 조회와 같은 결과가 되게 맞춘다
  v_pattern text := '%' || replace(coalesce(p_search, ''), '*', '%') || '%';
begin
  -- 출처
  if p_channel = 'MP' then
    v_where := v_where || ' and (channel = ''MP'' or (channel is null and (barcode is null or barcode = '''')))';
  elsif p_channel = 'RG' then
    v_where := v_where || ' and (channel = ''RG'' or (channel is null and barcode is not null and barcode <> ''''))';
  elsif p_channel <> 'all' then
    raise exception 'si_coupang_items_sales_counts: 알 수 없는 p_channel "%"', p_channel;
  end if;

  -- 승인상태
  if p_approval = 'pending' then
    v_where := v_where || ' and (coupang_approval <> ''승인완료'' or coupang_approval is null)';
  elsif p_approval <> 'all' then
    raise exception 'si_coupang_items_sales_counts: 알 수 없는 p_approval "%"', p_approval;
  end if;

  -- 검색
  if v_search <> '' then
    case p_search_field
      when 'name'     then v_where := v_where || ' and (item_name ilike $3 or product_name ilike $3)';
      when 'optionId' then v_where := v_where || ' and option_id = $2';
      when 'barcode'  then v_where := v_where || ' and barcode = $2';
      when 'itemCode' then v_where := v_where || ' and item_code ilike $3';
      when 'itemId'   then v_where := v_where || ' and item_id = $2';
      else raise exception 'si_coupang_items_sales_counts: 알 수 없는 p_search_field "%"', p_search_field;
    end case;
  end if;

  return query execute
    'select count(*),'
    || ' count(*) filter (where sales_status = ''판매중''),'
    || ' count(*) filter (where sales_status = ''판매중지''),'
    || ' count(*) filter (where stock = 0),'
    || ' count(*) filter (where sales_status is null)'
    || ' from public.si_coupang_items where ' || v_where
    using p_user_id, v_search, v_pattern;
end;
$$;

comment on function public.si_coupang_items_sales_counts(uuid, text, text, text, text)
  is '일반판매자 상품 화면 — 판매상태 칩 건수(전체 · 판매중 · 판매중지 · 재고 0 · 미확인)를 한 번에';

grant execute on function public.si_coupang_items_sales_counts(uuid, text, text, text, text) to anon, authenticated, service_role;

-- PostgREST 가 새 함수를 바로 알게 한다
notify pgrst, 'reload schema';

-- ── 확인 ─────────────────────────────────────────────────────────
--   한글이 trigram 으로 쪼개지는지 (결과가 빈 배열 {} 이면 이 DB 에서는 한글 검색에 인덱스가 안 쓰인다)
-- select show_trgm('오리아나');
--   함수 (계정 id 를 넣어서)
-- select * from public.si_coupang_items_sales_counts('<si_users.id>'::uuid, 'all', 'all', 'name', '오리아나');

-- ── 되돌리기 ─────────────────────────────────────────────────────
-- drop function if exists public.si_coupang_items_sales_counts(uuid, text, text, text, text);
-- drop index if exists public.si_coupang_items_name_code_trgm_idx;
-- drop index if exists public.si_coupang_items_user_barcode_idx;
-- drop index if exists public.si_coupang_items_user_sales_item_idx;
-- drop index if exists public.si_coupang_items_user_detail_missing_idx;
-- drop index if exists public.si_coupang_items_user_notices_missing_idx;
-- (pg_trgm 확장은 다른 곳에서 쓸 수 있어 지우지 않는다)
