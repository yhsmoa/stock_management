-- ================================================================
-- si_coupang_sync_runs — 일반판매자 상품 동기화 실행 기록 (2026-10-20)
--   [목록 받기] · [상세 받기] · [판매상태 확인] 을 실행할 때마다 1행.
--   진행 중에는 done/total/message 를 몇 초마다 갱신하고, 끝나면 status · finished_at 을 기록한다.
--   창을 닫아 중간에 끊기면 status 가 'running' 인 채로 updated_at 이 멈춘다
--   → 화면은 updated_at 이 오래된 running 을 '중단됨' 으로 보여 준다 (coupangSyncRunService.RUN_STALE_MS).
--   카드 맨 아래 "어디까지 받았는지" 와, 다른 창에서 진행 중일 때 버튼 잠금에 쓴다.
-- ================================================================

create table if not exists public.si_coupang_sync_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  kind        text not null check (kind in ('list', 'detail', 'status')),
  title       text,
  status      text not null default 'running' check (status in ('running', 'done', 'aborted', 'failed')),
  done        integer not null default 0,
  total       integer not null default 0,
  message     text,
  started_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists si_coupang_sync_runs_user_kind_started
  on public.si_coupang_sync_runs (user_id, kind, started_at desc);

comment on table public.si_coupang_sync_runs is '일반판매자 상품 동기화 실행 기록 (목록 · 상세 · 판매상태)';
