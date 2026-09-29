# 개인주문 동기화 개선 계획 (바코드 보존 · 매핑 테이블 · 서버 스케줄)

작성일: 2026-09-28
대상: `/personal-order` — `usePersonalOrder.ts`, `personalOrderService.ts`, `barcodeMatchingService.ts`, `invoiceService.ts`, `prodServer.js`, `coupangProxy.ts`

---

## 0. 확인된 현황 (운영 DB 실측, 2026-09-28)

메인 Supabase(`bzufmxzjanhihxahyvhb`)를 anon 키로 읽기 전용 조회한 결과. (Supabase MCP 는 주문 DB `mkcxpkblohioqboemmah` 에만 연결되어 있어 메인 DB 는 REST 로 조회했다.)

| 대상 | 건수 | 비고 |
|---|---|---|
| `coupang_personal_orders` | 1,955 | 사용자 3명. 상태: INSTRUCT 1,272 · FINAL_DELIVERY 632 · DEPARTURE 43 · DELIVERING 6 · ACCEPT 2 |
| ├ 사용자 f684… | 1,016 | 바코드 있음 1,015 |
| ├ 사용자 a5e9… | 794 | 바코드 있음 **0** (바코드 연결을 쓰지 않는 사용자) |
| └ 사용자 8ff2… | 145 | 바코드 있음 142 |
| 주문 `ordered_at` 범위 | 2026-08-28 ~ 09-28 | 조회 창(30/60일)과 일치 → DB 는 캐시 역할 |
| `(user_id, vendor_item_id)` → 바코드 | 467쌍 | **충돌(한 옵션에 바코드 2개 이상) 0건** → 매핑 표 설계 안전 |
| 유니크 키 중복 `(user_id, shipment_box_id, vendor_item_id)` | 0 | upsert 키 정상 |
| `barcode` 값이 NULL 인 행 | 0 | 빈 값은 전부 `''` 로 저장돼 있음 |
| `coupang_personal_orders_details` (비고) | 216 | note 있는 행 209, **고아(주문 없음) 180 (83%)** — 정리 코드 없음 |
| `si_personal_order_tracking` | 0 | 현재 미사용 (송장 xlsx 는 `pending_invoice_number` 컬럼으로 대체됨, pending 도 0건) |
| Storage `personal-order-invoices` | 802 PDF / 약 70MB | **전부 고아**. 업로드 시기 2026-04 ~ 07, 이후 업로드 없음 |
| `si_rg_items` | 32,176 | 바코드 매칭 후보(사용자별 barcode NOT NULL 조회, 1000건 루프 OK) |
| `si_users` | 3 | 전원 승인·쿠팡 키·`order_user_id` 보유 |

스키마 요점
- `coupang_personal_orders.barcode text NULL(default 없음)`, `note text default ''`, `pending_invoice_number text`, `release_stop bool NOT NULL default false`, `updated_at default now()` (트리거 여부 미확인 — upsert 시 갱신되는지 확인 필요).
- `coupang_personal_orders_details(user_id uuid NOT NULL, order_id text NOT NULL, vendor_item_id text NOT NULL, note text)`.
- `si_personal_order_tracking.user_id` 는 **text** (다른 표는 uuid) — 조인 시 캐스팅 주의.

배포 환경
- Railway 프로젝트 `stock_management` / 서비스 1개 / **replica 1** / 크론 없음 / 환경변수는 `VITE_*` 5개만. `prodServer.js` 는 Express 단일 프로세스.
- 메인 Supabase 의 RLS·pg_cron 상태는 MCP 미연결로 **확인 불가** → 계획 2·3 착수 전 대시보드에서 확인.

핵심 결함 재확인
- [`mapOrderToRows`](../src/renderer/services/personalOrderService.ts) 가 모든 행에 `barcode: ''` 를 넣고, [`savePersonalOrders`](../src/renderer/services/personalOrderService.ts) 의 upsert 가 이 컬럼을 그대로 덮어써서 **업데이트마다 바코드가 전부 지워진다**. 주석의 "보존된다"는 `pending_invoice_number` 에만 해당(payload 에 없음).
- 같은 원리로 `note: ''` 도 덮어쓰지만 비고는 별도 표를 쓰므로 실질 피해 없음(orders.note 는 전부 빈 값).

---

## 1. 계획 1 — 바코드 보존 + 정리 (즉시, 위험 낮음)

> **구현 상태 (2026-09-29): 코드 반영 + 운영 검증 완료 (sulon 계정, 개발 서버에서 실행).**
> - 결과: 주문 1,098 → 1,111 (신규 13, 전부 upsert 되어 `updated_at` 갱신), 바코드 1,097 → 1,097 **보존**, 비고 99 → 21 (고아 78 삭제, 잔여 고아 0), 콘솔 에러 0.
> - prune 안전장치는 발동하지 않음(정상 범위). 송장 PDF 고아 632건 confirm 은 **취소** — 삭제 여부는 사용자 결정 대기.
> - [바코드 재연결(선택)] 1행 실행: 매칭 1 / 변경 0 / DB 쓰기 0 (동일 값이면 쓰지 않음 확인).
> - `savePersonalOrders` 이월 + prune 안전장치, `cleanupStaleNotes`, `findOrphanInvoiceOrderIds`, [바코드 재연결(선택)] 반영.
> - 비고 고아 행은 업데이트 때 **자동** 삭제, 송장 PDF 고아는 **confirm 후** 삭제.
> - 운영 검증은 실제 계정으로 [주문 업데이트] 1회 실행 후 아래 1-4 절차로 확인한다.

### 1-1. 설계 선택: "컬럼 제외" 대신 "기존 값 이월(carry-forward)"

| 방식 | 내용 | 문제점 |
|---|---|---|
| A. payload 에서 `barcode` 제외 | 신규 행은 NULL, 기존 행은 유지 | `PersonalOrderRow.barcode: string` 타입과 어긋남(런타임 null 유입). `sendPersonalOrdersPre` 가 `ft_cart_items.barcode` 에 null 을 보냄. 현재 DB 는 `''` 로 통일돼 있어 `''`/`NULL` 혼재 발생 |
| **B. 기존 행 조회 → 이월 (채택)** | prune 용으로 이미 하는 `select id, shipment_box_id, vendor_item_id` 조회를 **upsert 앞으로 옮기고 `barcode` 를 함께 읽어** `payload.barcode = existing.get(key) ?? ''` | 추가 쿼리 없음(순서만 변경). `''` 규약 유지, 타입 변경 없음, DB 마이그레이션 없음. 계획 2 의 매핑 조회가 같은 자리에 들어감 |

### 1-2. 변경 내용

`personalOrderService.ts`
1. `savePersonalOrders`
   - STEP 0: 기존 행 전체 조회(1000건 루프) → `existingByKey: Map<key, {id, barcode}>`.
   - STEP 1: upsert 직전 `rows.map(r => ({...r, barcode: existingByKey.get(key)?.barcode || ''}))`.
   - STEP 2: prune 은 `existingByKey` 를 재사용(재조회 제거).
   - **prune 안전장치**: `idsToDelete.length > max(50, existing×30%)` 이면 삭제 전 중단하고 `{ success:false, error:'삭제 대상 과다 …' }` 반환 → 훅에서 `confirm()` 후 `force` 재호출. (쿠팡이 에러 없이 일부만 돌려주는 경우 대비. 최근 커밋 1734f7a 는 "에러 응답" 만 막는다.)
   - prune 삭제 실패를 `console.error` 로 삼키지 말고 결과에 `pruneErrors` 로 올려 진행 모달에 표시.
2. `mapOrderToRows` 의 `barcode: ''` 는 "기본값" 의미로 두되 주석으로 "저장 시 이월됨" 명시.
3. 신규 `cleanupStaleNotes(userId, validOrderIds)` — `coupang_personal_orders_details` 에서 `order_id ∉ valid` 삭제(1000건 루프 조회, 300건 `.in` 삭제). `cleanupStaleTracking` 과 동일 패턴.

`invoiceService.ts`
4. 신규 `cleanupOrphanInvoices(userId, validOrderIds)` — `fetchInvoiceOrderIds` 결과 중 `∉ valid` 를 `deleteInvoicesByOrderIds` 로 삭제. **최초 1회는 802건/70MB 삭제이므로 confirm 필수**(아래 결정 사항).

`usePersonalOrder.ts`
5. `handleUpdate` STEP 5.5 에 비고·PDF 정리 추가(진행 단계 라벨 추가). 정리 결과는 콘솔이 아니라 `progressStatus` 에 건수 표기.
6. 드롭다운에 **[바코드 재연결(선택)]** 추가 — 선택 행을 `barcode` 유무와 무관하게 재매칭·덮어쓰기. 매칭 실패 행은 **기존 값을 지우지 않고** 실패 건수만 보고. (보존이 되면 잘못 붙은 바코드도 남기 때문에 필요.)
7. `handleBarcodeLink` 대상은 기존대로 `!r.barcode` (증분).

### 1-3. 엣지 케이스 점검

| 상황 | 현재 | 계획 1 이후 |
|---|---|---|
| 업데이트 후 바코드 | 전부 삭제 | 유지 |
| 분리배송·합포장으로 `shipment_box_id` 변경 | 새 행 삽입, 옛 행 prune | 동일. 새 행은 바코드 없음 → [바코드 연결] 대상으로 자연 편입 (계획 2 에서 자동화) |
| 옵션이 로켓그로스에서 바코드 재등록됨 | 다음 업데이트 때 재매칭됨(전부 지워지므로) | 자동 반영 안 됨 → [재연결(선택)] 로 처리 |
| 두 탭/두 사람이 동시에 업데이트 | prune 경합 | 동일(이월 조회~upsert 사이에 다른 탭의 `saveBarcodes` 가 끼면 덮어씀). 계획 3 에서 서버 단일 실행으로 해소 |
| 쿠팡이 일부 상태를 빈 배열로 응답(에러 아님) | 그 상태 주문 전부 prune | 30% 안전장치로 중단·확인 |
| `updated_at` | upsert 시 갱신 여부 미확인 | 트리거 없으면 payload 에 `updated_at: new Date().toISOString()` 추가 |
| 비고 표 고아 180건 | 영구 누적 | 업데이트마다 정리 |
| PDF 고아 802건 | 영구 누적, 페이지 로드마다 목록 조회 | 최초 confirm 후 삭제, 이후 자동 |
| 사용자 a5e9(바코드 미사용) | 영향 없음 | 영향 없음 |

### 1-4. 검증
- `npm run typecheck`.
- 개발 서버(`npm run dev`)에서 f684 계정으로: ① 업데이트 전 `select count(*) filter (where barcode<>'')` 기록 → ② 업데이트 → ③ 동일 쿼리로 감소 0 확인 → ④ 비고 고아 0, PDF 고아 0 확인.
- 안전장치 테스트: `fetchAllOrdersheets` 를 임시로 빈 배열 반환하게 바꿔 confirm 이 뜨는지 확인 후 되돌림.

---

## 2. 계획 2 — 옵션 단위 바코드 매핑 테이블

### 2-1. 스키마 (신규)

```sql
create table si_personal_order_barcode_map (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  vendor_item_id text not null,
  barcode        text not null,
  source         text not null check (source in ('auto','manual')) default 'auto',
  matched_rule   smallint,            -- 1~5 (6단계 규칙 중 채택 규칙), manual 은 null
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, vendor_item_id)
);
create index on si_personal_order_barcode_map (user_id);
-- 시드: 현재 주문 행에서 추출 (실측 467쌍, 충돌 0)
insert into si_personal_order_barcode_map (user_id, vendor_item_id, barcode)
select distinct user_id, vendor_item_id, barcode
from coupang_personal_orders
where barcode <> '' and vendor_item_id <> ''
on conflict do nothing;
```
- RLS 는 기존 `si_*` 표와 동일하게 맞춘다(대시보드에서 확인 후 결정).
- 규모: 옵션 수에 비례(현재 467, 상한은 `si_rg_items` 32k 이하). 주문 수와 무관 → 누적 문제 없음.

### 2-2. 서비스 변경

`services/barcodeMapService.ts` (신규)
- `fetchBarcodeMap(userId): Map<vendor_item_id, {barcode, source}>` (1000건 루프).
- `upsertBarcodeMap(userId, entries[])` (`onConflict: 'user_id,vendor_item_id'`, 500건 배치).
- `applyBarcodeToOrders(userId, vendor_item_id, barcode)` — `update … where user_id=? and vendor_item_id=?` (행 id 별 update 보다 요청 수가 467 vs 1,955 로 적음).

`personalOrderService.savePersonalOrders`
- 우선순위: `mapping.get(vid) || existing.get(key)?.barcode || ''`. 매핑이 있으면 새 `shipment_box_id` 로 들어온 행도 즉시 바코드가 채워진다.

`barcodeMatchingService.ts`
- `matchBarcodes` 와 `findRgItem` 이 **6단계 규칙을 두 번 구현**하고 있다. `matchBarcodes` 를 "vid 별 dedupe → `findRgItem`" 으로 재작성해 한 곳으로 합친다. `buildRgMatchIndex(rgItems, true)` 로 만들면 규칙별 `barcode` 체크가 동치임을 확인했다(인덱스 단계에서 바코드 없는 후보 제거).
- 반환형을 `Map<vendor_item_id, {barcode, rule}>` 로 바꾸고, 훅에서 (a) 매핑 upsert (b) `applyBarcodeToOrders` (c) 로컬 items 갱신.

`usePersonalOrder.ts`
- [바코드 연결]: 바코드 없는 행의 vid 중 ① 매핑에 있으면 적용만, ② 없으면 매칭 → 매핑 저장 → 적용. 진행 단계에 "매핑 적용 n / 신규 매칭 m" 표시.
- [재연결(선택)]: 선택 행의 vid 를 재매칭 → 매핑 덮어쓰기(source 유지 규칙: 사용자가 명시적으로 요청했으므로 manual 도 덮어씀) → 같은 vid 의 모든 행 갱신.
- [바코드 지우기(선택)] (선택 사항): 매핑 삭제 + 행 `''`. 잘못된 자동 매칭을 되돌릴 유일한 수단이므로 함께 두는 것을 권장.

### 2-3. 엣지 케이스

| 상황 | 처리 |
|---|---|
| `vendor_item_id` 가 빈 문자열 | 매핑 건너뛰고 행 단위 이월만 (실측 0건이지만 가드 유지) |
| 같은 vid 의 주문이 여러 상태에 걸쳐 있음 | `applyBarcodeToOrders` 가 vid 기준으로 전부 갱신 → 상태별 불일치 없음 |
| 로켓그로스에서 옵션의 바코드가 바뀜 | 자동 반영 안 됨(의도). [재연결] 로 갱신 → 전 행 반영 |
| 규칙 5(이름 기반)가 vid 가 다른 두 주문에 같은 rg 를 매칭 | 매핑은 vid 별 독립 행이므로 문제 없음 |
| 재매칭 결과가 없음 | 기존 매핑 유지 + 실패 건수 보고(무언 삭제 금지) |
| 시드 시 충돌 | 실측 0. 그래도 `on conflict do nothing` 으로 방어, 시드 후 건수 비교 |
| 사용자 a5e9(바코드 0) | 시드 0건, 기능 사용 시부터 채워짐 |
| 계획 1 의 이월 로직과의 관계 | 매핑 > 이월 > `''`. 매핑이 채워질수록 이월은 안전망으로만 남음 |

### 2-4. 검증
- 시드 후 `select count(*) from si_personal_order_barcode_map` = 467.
- 특정 vid 의 바코드를 매핑에서 바꾸고 업데이트 → 해당 vid 전 행이 바뀌는지 확인.
- 기존 `matchBarcodes` 와 새 구현을 같은 입력(1,955행 × rg 후보)으로 돌려 결과 diff = 0 인지 확인 후 옛 구현 제거.

---

## 3. 계획 3 — 서버 스케줄 동기화 + 보관(archive) 정책

### 3-1. 실행 위치 비교

| 방식 | 장점 | 단점 |
|---|---|---|
| **A. `prodServer.js` 내부 `setInterval` (권장)** | replica 1 이라 단일 실행 보장, 배포 형태 불변, 추가 서비스 비용 없음 | 웹 프로세스와 자원 공유. 배포 재시작 시 진행 중 동기화 중단(다음 주기에 재실행되므로 허용) |
| B. Railway cron 서비스(별도) | 격리 | 서비스 추가·환경변수 이중 관리, 코드 진입점 추가 |
| C. Supabase Edge Function + pg_cron | 서버 무관 | Deno 로 쿠팡 서명·동기화 재작성(3번째 복제), 메인 프로젝트 MCP 미연결로 배포·검증 수단 부족 |

### 3-2. 필수 결정 사항 (착수 전 확인)

1. **서버의 Supabase 쓰기 권한.** 현재 브라우저는 anon 키로 모든 표를 읽고 쓴다(별도 Auth 세션 없음). 선택지:
   - (a) 서버도 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 재사용 → 새 env 없음. RLS 가 anon 에 열려 있어야 함(현재 브라우저가 동작하므로 사실상 열려 있음).
   - (b) `SUPABASE_SERVICE_ROLE_KEY` 신설 → CLAUDE.md "다른 env 금지" 예외 승인 필요. 보안상 정석.
2. **주기.** 제안 15분(사용자 3명 × 8 태스크). 쿠팡 응답이 느린 날을 고려해 "이전 실행이 끝나지 않으면 건너뜀".
3. **보관 정책.** 아래 3-4 규칙 확정.
4. **공유 코드 형태.** `mapOrderToRows`·상태 창(30/60일)·응답 검증·prune/archive 판정은 브라우저와 서버가 같은 코드를 써야 한다. `prodServer.js` 는 빌드 없이 `node` 로 실행되므로 TS 를 직접 require 할 수 없다. 선택지: `src/shared/personalOrderSync/*.js`(JSDoc 타입, CJS) 를 Vite(렌더러)와 Node(서버) 양쪽에서 import. 또는 서버용 빌드 단계 추가(`package.json` 스크립트).

### 3-3. 서버 구성

`src/server/personalOrderSync.js` (신규, CJS)
- `syncUser({ userId, accessKey, secretKey, vendorCode })` — 발주서·반품요청 조회(기존 `callCoupangAPI` 재사용, 동시성 2, 재시도 3) → 변환 → 매핑·이월 적용 → upsert → prune/archive → 비고·PDF 정리 → `si_personal_order_sync_runs` 기록.
- `runAll()` — `si_users` 중 승인·키 보유 사용자 순차 실행. 사용자별 in-memory 락.
- 스케줄러: 기동 60초 후 첫 실행, 이후 15분 간격. `SYNC_DISABLED` 같은 env 는 만들지 않는다(필요하면 `si_users` 컬럼이나 설정 표로).

`prodServer.js` · `coupangProxy.ts` (양쪽 동일하게)
- `POST /api/personal-orders/sync` — 수동 트리거. 인증은 기존 쿠팡 프록시와 같은 3개 헤더 + `x-user-id`. 서버는 헤더 키가 DB 키와 일치할 때만 실행(다른 사용자 트리거 방지). 실행 중이면 409.
- `GET /api/personal-orders/sync-status` — 마지막 실행 결과.
- 개발 서버(Vite 플러그인)에도 같은 엔드포인트를 두되 스케줄러는 켜지 않는다.

`si_personal_order_sync_runs` (신규)
```sql
create table si_personal_order_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running','ok','error')),
  fetched int, upserted int, pruned int, archived int,
  notes_deleted int, invoices_deleted int,
  error text
);
```
30일 이상 지난 로그는 다음 실행 때 삭제(이 표 자체가 누적되지 않게).

### 3-4. 보관(archive) 규칙 — prune 대체

`coupang_personal_orders` 에 `archived_at timestamptz null` 추가 + 인덱스 `(user_id, archived_at)`, `(user_id, order_id)`.

이번 조회에 **안 온** 기존 행 처리:

| 조건 | 처리 | 근거 |
|---|---|---|
| `status` 가 이번에 조회한 상태 집합에 없음 (예: NONE_TRACKING, 조회 비활성) | **보관** | 조회하지 않았으니 없어졌다고 볼 수 없음 |
| `ordered_at` 이 해당 상태의 조회 창 밖 (FINAL_DELIVERY/DELIVERING 30일, 나머지 60일) | **보관** | 창을 벗어나 나이 든 것 |
| `ordered_at` 이 null | **보관** | 안전 쪽 |
| 위 어느 것도 아님 (창 안인데 안 옴) | **삭제** | 분리배송 재편성 등으로 `shipment_box_id` 가 실제 소멸 |
| 이번에 온 행 | upsert, payload 에 `archived_at: null` 포함 | 어떤 이유로든 다시 오면 보관 해제 |

부속 데이터
- 비고: 주문이 (보관 포함) 존재하면 유지. 주문이 삭제된 경우만 정리 → 주문 수에 종속되어 누적 상한 있음.
- PDF: **보관 전환 시점에 삭제** (배송완료 후 라벨은 불필요) + 삭제된 주문의 PDF 삭제. 기존 [송장 업데이트] 규칙(출고중지·배송완료 라벨 삭제)은 그대로.
- tracking: 기존 `cleanupStaleTracking` 의 valid 집합을 "미보관 주문" 으로 유지(현재 0건).

조회
- `fetchPersonalOrders` 기본 `.is('archived_at', null)` → 화면·페이지 로드 규모는 지금과 같다(월 2,000행 수준).
- `csService.fetchPersonalOrderDetailsMap` 은 필터 없이 조회 → CS 가 취소·반품·과거 주문을 로컬에서 찾을 수 있게 됨(현재 주석의 목적과 일치).
- 화면에 "보관 포함" 토글은 검색과 함께만 허용(전체 로드 금지).

성장 추정: 사용자 3명 기준 월 약 2,000행 → 연 24,000행. Postgres 규모로는 문제 없음. 인덱스만 확보.

### 3-5. 클라이언트 변경
- [주문 업데이트] 버튼 → 서버 트리거 호출 + 상태 폴링(2초)로 진행 모달 갱신. 세부 단계 표시는 "조회 → 저장 → 정리" 3단계로 축소된다(서버가 단계별 콜백을 줄 수 없음).
- 헤더에 "마지막 동기화 hh:mm (n건)" 표시. 다른 곳에서 동기화가 끝나면 새로고침 안내 배너.
- 브라우저 측 `fetchAllOrdersheets`·`savePersonalOrders` 는 제거하지 않고 서버 장애 시 폴백으로 남기되, **prune/archive 판정 함수는 공유 모듈 하나만** 쓴다.

### 3-6. 함께 고칠 소소한 결함
- `daysAgo()`·`today()` 가 UTC 날짜에 `+09:00` 을 붙여 창 경계가 최대 9시간 어긋남 → KST 기준 날짜로 계산. 보관 로직과 같은 창 계산 함수를 공유 모듈에 둔다.
- `handleAcknowledge` 의 로컬 상태 선반영은 유지(다음 동기화가 쿠팡 실제 상태로 덮음).

### 3-7. 엣지 케이스

| 상황 | 처리 |
|---|---|
| 서버 동기화 중 사용자가 [바코드 연결] 실행 | 매핑 표에 먼저 쓰고 행을 갱신하므로, 서버가 그 사이 upsert 해도 다음 실행에서 매핑으로 복구. 행 단위 경합은 최대 1주기 지연 |
| 쿠팡 일부 상태 조회 실패 | 해당 사용자 실행 전체 중단(저장·정리 없음), `error` 기록. 다음 주기 재시도 |
| 안전장치(삭제/보관 대상 30% 초과) | 서버는 confirm 이 없으므로 **삭제만 건너뛰고** 보관·upsert 는 수행, `error` 에 사유 기록. 수동 트리거 응답에 표시 |
| 배포 재시작으로 실행 중단 | `status='running'` 인 채 남은 로그는 다음 기동 시 `error('중단')` 처리 |
| 사용자 키 만료·IP 미허용 | 최근 커밋의 응답 검증으로 에러 처리 → 로그. UI 에서 마지막 실패 사유 노출 |
| 여러 사용자 동시 처리로 쿠팡 rate limit | 사용자 순차 + 사용자 내 동시성 2 유지. 실측 8 태스크/사용자 |
| 로컬 dev 에서 스케줄러 | 꺼둔다. 수동 엔드포인트로만 테스트 |

### 3-8. 검증
- 스테이징 없음 → 배포 전 로컬 `npm start`(prod 서버)로 실제 계정 1개 동기화 1회 실행, `sync_runs` 와 행 수 확인.
- 배포 후 첫 두 주기 로그 확인(Railway 로그 + `sync_runs`).
- 보관 전환 확인: 배포 다음날 `select count(*) filter (where archived_at is not null)` 가 창을 벗어난 FINAL_DELIVERY 수와 일치.

---

## 4. 실행 순서와 의존성

1. **계획 1** (코드만, DB 변경 없음) → 커밋 1개. 최초 PDF/비고 정리는 confirm 대화상자로 사용자가 결정.
2. **계획 2** → 마이그레이션 SQL(표 생성·시드) 먼저 대시보드에서 실행 → 코드 커밋. 계획 1 의 이월 로직 위에 매핑 조회를 얹는 구조라 1 이 선행되어야 한다.
3. **계획 3** → 결정 사항 4개(3-2) 확정 후 착수. `archived_at` 컬럼·`sync_runs` 표 마이그레이션 → 공유 모듈 추출 → 서버 → 클라이언트 순. 쿠팡 프록시 규칙대로 `prodServer.js` 와 `coupangProxy.ts` 를 함께 수정.

각 단계 후 `npm run typecheck` 와 위 검증 절차를 수행하고, 커밋 메시지는 한국어 Conventional Commits.

## 5. 사용자 확인이 필요한 항목 (요약)

- [ ] 계획 1: 이월(B) 방식 채택 동의. 고아 PDF 802건(70MB, 2026-04~07 업로드)·비고 180건을 첫 업데이트 때 삭제해도 되는지.
- [ ] 계획 2: 표 이름 `si_personal_order_barcode_map`, RLS 정책(기존 `si_*` 와 동일), [바코드 지우기] 포함 여부.
- [ ] 계획 3: 서버 DB 키(anon 재사용 vs service role 신설), 주기(15분), 보관 규칙(3-4), 공유 모듈 형태(JS+JSDoc vs 서버 빌드 추가), 실행 위치(A 권장).
