# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 작업 규칙 (필수 준수)

이 프로젝트는 **현재 운영 중인 사이트**이므로 아래 네 가지 기준을 모든 코드 작성·수정 작업에 적용한다.

1. **시니어 개발자 기준으로 정확히 검증한다.** 요청받은 스크립트를 끝까지 읽고, 엣지 케이스·예외 경로를 빠짐없이 짚는다. "일반적인 경우는 동작함" 수준에서 작업을 마치지 않는다. 파일을 수정했다면 해당 변경이 불러올 수 있는 영향 범위(호출하는 쪽, 호출당하는 쪽, 데이터 흐름)를 반드시 확인한다.
2. **구조화가 필요한 부분은 구조화한다.** 한 파일·한 함수에 기능을 계속 쌓아 올리지 않는다. 페이지(`pages/`)가 비대해지면 `use*.ts` 훅이나 `components/<feature>/`로 분리하고, Supabase 호출은 `services/`로 끌어낸다. 기존 분리 패턴(예: `usePurchaseManagement.ts`, `purchaseService.ts`)을 따른다.
3. **섹션 단위 주석을 유지한다.** 이 코드베이스는 `// ═════…`, `// ── 소제목 ──` 스타일로 파일을 시각적 블록으로 나눈다. 새 코드를 추가할 때도 동일한 섹션 구분 주석을 달아 가독성을 유지한다. (주석 스타일 예: `src/server/prodServer.js`, `src/renderer/services/supabase.ts`.)
4. **임시방편·하드코딩 금지.** 매직 넘버·테스트용 고정 ID·"일단 동작하게 만드는" 우회는 운영 환경에서 그대로 문제가 된다. 사용자 키는 요청 헤더로, 설정값은 `theme.ts`/env로, 페이지네이션은 1000-row 루프 같은 기존 정석 패턴으로 처리한다. 지름길이 필요한 상황이면 코드로 몰래 넣지 말고 먼저 사용자에게 근거와 함께 확인받는다.
5. **Supabase 등 데이터 조회·수정·작업 시 1000건 limit 반드시 대응.** Supabase PostgREST는 한 번의 요청에 기본 1000행만 반환한다. 조회·수정·일괄 작업 스크립트를 작성할 때는 예외 없이 `.range(from, from+999)` 페이지네이션 루프(또는 그에 준하는 방식)로 전체 데이터를 처리해 단일 요청이 잘려 누락되는 일이 없도록 한다. 작업 착수 전에 요청자에게 **해당 테이블에 저장된 데이터가 몇 건인지** 먼저 확인한다 — 규모에 따라 배치 크기, 타임아웃, 중간 저장 전략이 달라지므로 건수를 모른 채로 구현하지 않는다. 기준 구현: `fetchCoupangItems`, `fetchCoupangReturns`, `fetchQBarcodesByUser` ([src/renderer/services/supabase.ts](src/renderer/services/supabase.ts)).

## Development commands

```bash
npm install                 # install deps (Windows: respects .npmrc which skips Electron download for CI)
npm run dev                 # Vite only, web-mode (http://localhost:5173) — uses Coupang proxy plugin
npm run dev:electron        # full Electron app: scripts/dev.js finds a free port from 5173, boots Vite, then launches Electron with VITE_DEV_SERVER_URL
npm run build               # Vite web build → dist/ (used by Railway)
npm run build:electron      # web build + electron-builder → release/ (Windows NSIS installer)
npm start                   # Node/Express prod server (src/server/prodServer.js) serving dist/ + Coupang proxy — this is what Railway runs
```

There is no lint or test script. `npm run typecheck` (`tsc --noEmit`, covers `src/` except `prodServer.js`) is the only static check — run it before committing. If you add checks, wire them into `package.json` scripts rather than inventing ad-hoc commands.

## Big picture

This app runs in **two deployment shapes from one codebase**: (1) a desktop Electron app for in-house use and (2) a Railway-hosted web app. The renderer (`src/renderer/`) is identical in both; only the host and the Coupang API proxy differ.

### The dual Coupang proxy (important gotcha)
Coupang Open API requires HMAC-SHA256 signatures and exposes the `SECRET_KEY`, so signing is done server-side. The exact same signing + endpoint logic exists **twice**:

- `src/server/coupangProxy.ts` — Vite plugin (`configureServer` middleware) used by `npm run dev` and `npm run dev:electron`.
- `src/server/prodServer.js` — Express app used by `npm start` on Railway.

When adding or changing a Coupang endpoint, update **both** files. Per-user keys (`x-coupang-access-key`, `x-coupang-secret-key`, `x-vendor-code`) are passed as request headers from the renderer — no env-var fallback. Base URL is `https://api-gateway.coupang.com`.

### Renderer architecture
- **Routing** (`src/renderer/App.tsx`) — React Router v6. `/login`, `/register` are public; everything else is wrapped in `<ProtectedRoute><Layout/></ProtectedRoute>`. `ProtectedRoute` reads the session from `localStorage['user']`; there is **no** Supabase Auth session integration — auth is bespoke against the `si_users` table.
- **Pages** (`src/renderer/pages/`) — one file per route, typically 300–800 lines. Some pages ship a companion `use*.ts` hook (`usePersonalOrder.ts`, `usePurchaseManagement.ts`) and a colocated `.css` file when inline styles aren't enough.
- **Services** (`src/renderer/services/`) — all Supabase reads/writes and Excel/PDF/barcode helpers live here. Pages should not call `supabase` directly; they call a service function. `supabase.ts` is the exception (it owns auth + shared lookup helpers like `getOrderUserId`, `fetchCoupangItems`).
- **Components** (`src/renderer/components/`) — `common/`, `inventory/`, `purchase/`, `shipment/`, `export/` folders group feature-specific pieces. `Layout.tsx` + `Sidebar.tsx` + `ProtectedRoute.tsx` are the app shell.
- **Styling** — design tokens in `src/renderer/styles/theme.ts` (import as `import { theme } from '.../styles/theme'`). Shared page chrome in `page-common.css`. Most component styling is inline `style={{}}` using `theme.*` tokens — follow that pattern rather than introducing a CSS framework.

### Supabase data model
All tables share the `si_` prefix and are queried via `@supabase/supabase-js` with anon key from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. Tables actually used by the code:

`si_users`, `si_stocks`, `si_coupang_items`, `si_coupang_returns`, `si_q_barcode`, `si_rg_items`, `si_rg_item_data`, `si_rg_views`, `si_shipment_list`, `si_shipment_scan`.

Most tables are keyed by `user_id` (= `si_users.id` UUID) so data is partitioned per logged-in user. Large reads page through in 1000-row batches (`.range(from, from+999)` in a loop) — see `fetchCoupangItems` for the canonical pattern.

`si_users.coupang_user_name` is the account's Coupang WING login ID, sent as `replyBy` when answering 고객문의 (`/cs/customer-inquiry`). Read it with `fetchCoupangUserName()` (always from DB — older login sessions in localStorage don't have the column).

`si_users` has a separate `order_user_id` column that maps to an external `purchase_agent.ft_users.id`. `getOrderUserId()` in `supabase.ts` handles localStorage caching of this lookup — reuse it rather than re-querying.

### Electron main/preload
`src/main/main.ts` is minimal: create a `BrowserWindow`, load `VITE_DEV_SERVER_URL` in dev or `dist/index.html` in prod. `preload.ts` exists but exposes no bridge — the renderer talks to Supabase and the Coupang proxy directly via HTTP. If you need IPC, you're adding it from scratch.

Electron is built separately via `scripts/build-electron.mjs` (called manually; the `build` script only produces the web bundle). `electron.vite.config.mjs` defines the CJS output for `dist-electron/`.

## Conventions in this codebase

- **Language**: UI copy, code comments, and commit messages are Korean. Follow suit — don't translate existing Korean comments to English when editing nearby code.
- **Commit style**: Conventional Commits in Korean (`feat:`, `fix:`, `refactor:`, `style:` + Korean summary). See `git log` for examples.
- **Path alias**: `@/*` → `src/*` (configured in `tsconfig.json` and `vite.config.ts`).
- **TypeScript**: `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` are all on. Don't silence them with `// @ts-ignore`; fix the underlying issue.
- **Env vars**: The renderer reads `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. The prod server uses `PORT`, plus `QZ_CERTIFICATE` / `QZ_PRIVATE_KEY` (라벨 인쇄 서명 — 아래 절) and `OPENAI_API_KEY` / `OPENAI_MODEL`(선택, 기본값은 `ai/inquiryReplyAi.js` 의 `DEFAULT_MODEL`) (고객문의 AI 답변 — 아래 절). The Vite dev server reads the same vars from `.env` (no `VITE_` prefix, so they never reach the browser). No other env vars — if you think you need one, check if a header-based per-user key (Coupang pattern) fits better.

### 고객문의 AI 답변 (2026-10-06)
`/cs/customer-inquiry` 표 우측 위 [AI 답변] → 미답변 행에 예상 답변 초안 → 담당자가 고쳐서 [확정] → 기존 답변 전송 경로로 쿠팡에 보낸다.
- **규칙서가 단일 기준**: `src/server/ai/customerInquiryGuide.md` — "이런 문의에는 이렇게" 템플릿 20묶음 + 톤 규칙 + 주문상태 분기 + 출력 JSON. 그대로 system prompt 에 들어간다. 답변 방식을 바꾸려면 이 파일만 고친다(서버 재시작 시 다시 읽음). 그룹 키는 `services/inquiryAiService.ts` 의 `INQUIRY_CATEGORY_LABELS` · 서버 `CATEGORY_KEYS` 와 셋이 같아야 한다.
- **서버**: 코어 `src/server/ai/inquiryReplyAi.js`(CJS, 검증·프롬프트·OpenAI 호출)를 개발 `src/server/aiProxy.ts` 와 운영 `prodServer.js` 가 공용으로 쓴다. 라우트 `POST /api/ai/inquiry-replies` 는 쿠팡 프록시처럼 **양쪽에** 있다. 10건씩 나눠 병렬 호출, 한 요청 최대 50건.
- **OpenAI 호출 규약 (2026-10 기준)**: Responses API `POST /v1/responses` (`instructions` + `input` + `text.format` json_schema strict + `reasoning.effort` + `store:false`). Chat Completions 는 구형이라 쓰지 않는다. 기본 모델 `gpt-6.1-sol`(현역: gpt-6-astra › gpt-6.1-sol › gpt-6-luna). 모델명은 자주 바뀌니 바꿀 때 https://developers.openai.com/api/docs/models 에서 현역 ID 를 확인한다.
- **화면 (디자인 v2, 2026-10-07)**: 문의 1건 = 카드 1장 — 왼쪽 168px 레일(날짜·주문·고객·보조 작업) | 본문(상품줄·질문 17px 볼드·답변·AI 초안). 색은 파랑 1개 + 앰버(담당자 확인) 1개, 칩은 테두리형. 전역 액션(새로고침·초안 모두 지우기·AI 답변 생성)은 헤더. 파일: 목록 `components/cs/CustomerInquiryList.tsx`, 초안 상태 `useInquiryAiDrafts.ts`, 박스 `InquiryAiDraftBox.tsx`(textarea 높이는 내용 줄 수에 맞춤), 스타일 `pages/CustomerInquiry.css`(.ci-, 토큰은 `.ci-page` 의 CSS 변수). 페이지 전체가 스크롤(Layout main 이 overflow hidden). 근거 문장 표시는 localStorage `cs_ai_show_reasoning`.
- 초안의 "처리 도와드렸습니다"는 담당자가 [확정] 전에 실제 취소/반품 접수를 해야 한다 → `requiredAction` 칩. `[담당자: …]` 자리표시가 남아 있으면 확정 버튼이 막힌다.
- 엔드포인트에 사용자 인증이 없다(앱 전체가 그렇다). 키 비용 보호가 필요하면 그때 헤더 검증을 넣는다.

### 라벨 출력 (내장 — QZ Tray)
라벨 양식 편집기(`/label-settings`, 사이드 메뉴 물류 › 라벨 설정)와 상품관리 [라벨출력] 모달이 이 앱 안에 있다. 원래 별도 서비스 label-service(Next.js, iframe)였는데 iframe 제약(저장소 분리·localhost 권한) 때문에 2026-09 에 옮겨 왔다 — label-service 는 아이엠몽 로켓용으로 남아 있고 **코드를 공유하지 않는 복사본**이다.
- **구조**: 엔진 `utils/label/` (labelTypes·labelRender·tspl·zpl·labelJob·qzTray·careSymbols·localPrinterMap), 문구 `utils/label/ko.json` + `i18n.ts`(`t()` — i18next 호출 모양만 흉내, 한국어만), 서비스 `services/labelTemplateService.ts`(템플릿·기록·계정) · `labelPrintService.ts`(인쇄) · `labelService.ts`(상품 행 → 인쇄 항목), 화면 `pages/LabelSettings.tsx` + `components/label-settings/*`, `components/label/*`(모달).
- **데이터**: 같은 Supabase 의 `label_templates`·`label_print_logs`. 이 앱은 `source='stock'` 만 읽고 쓴다(`APP_LABEL_SOURCE`) — 같은 표의 `rocket` 행은 label-service 것이니 건드리지 않는다. 권한 규칙(내 것+공용, `user_ids` 는 null 또는 [내 id], 기본 템플릿 그룹당 1개)은 서비스가 브라우저에서 강제한다(RLS 없음).
- **QZ 서명**: `/api/qz/cert`·`/api/qz/sign` 이 개발(`src/server/qzSignProxy.ts`)과 운영(`prodServer.js`) 두 곳에 있다 — 쿠팡 프록시처럼 **양쪽을 같이 고친다**. 인증서·키는 label-service 와 같은 값이라 인쇄 PC 의 `override.crt` 를 바꿀 필요가 없다.
- **프린터 지정**: 템플릿별로 이 PC 의 localStorage(`ls_local_printer_map_v1`). 라벨 설정 프린터 탭과 모달이 같은 값을 공유한다.
- **필드 규약**: `labelService.ts` 의 `toLabelPrintItems()` 가 만드는 data 키는 `SOURCE_PRODUCT_FIELDS.stock` 과 같아야 한다 — 바꾸면 양쪽을 같이 고친다.
- **사입관리 [라벨]**: 체크한 `si_rg_items` 행 → `services/purchaseLabelService.ts` 가 `vendor_item_id = si_coupang_items.option_id`(숫자 ID 만)로 상품관리 행을 찾아 같은 `toLabelPrintItems()` 로 변환 → `LabelPrintModal editableQty`(행별 장수 입력, 0장은 제외). 상품관리에 없는 행은 사입관리 값으로 채우고 출고코드는 비운다(모달 안내). 화면 상태는 `components/purchase/usePurchaseLabel.ts` — `usePurchaseManagement` 는 건드리지 않는다.
- **혼용률 (라벨 `composition`, 2026-10-20 연결)**: 출처 우선순위 ① 아이템관리 › 상품정보(`/item-info`, `si_item_info.composition`, 바코드 기준) 직접 입력값 ② 쿠팡 고시정보 "제품 소재"/"소재"(`si_coupang_items.composition`, [상세 받기] 때 저장). `toLabelPrintItems` 가 ②를 싣고 `applyManualComposition` 이 ①로 덮는다 — 두 라벨 화면(상품관리 [라벨출력] · 사입관리 [라벨])이 같이 부른다. "상세페이지 참조" 같은 안내 문구는 혼용률로 쓰지 않는다(`coupangNotices.isRealComposition`).
  - ①은 2026-10-20 에 작업 엑셀(`NEW_업로드_완성본` — 시트 작업리스트BZ = immong, BO = sulon, D열 상품명 → I열 제품소재)로 일괄 채웠다(immong 5,805 · sulon 10,971 바코드). 상품명 매칭: DB 이름의 `_숫자`/`-숫자` 뒤 이름이 엑셀 상품명과 같으면 일치, 아니면 낱말 단위 포함("오리아나" ⊂ "PT-오리아나SB_30", "프리미" ⊄ "프리미엄"). `model_name` 에 엑셀 상품명이 들어 있다. 같은 이름에 소재가 둘 이상 동률이면 넣지 않았다.
- **권장연령**: 값은 `si_item_info.recommended_age` 에 입력하지만 라벨은 아직 읽지 않는다 → 전부 성인 템플릿. 연결할 때 DB 칼럼은 `recommended_age`, 라벨 data 키는 `recommanded_age`(label-service 와 같은 철자)라 변환이 필요하다.
- **명령 언어**: 템플릿의 `printer_lang`(TSPL2/ZPL)이 프린터 기종과 맞아야 한다. BIXOLON(BPL-Z)에 TSPL 을 보내면 라벨 대신 프린터 정보 문구가 찍힌다.
- **진단**: 상품관리 URL 에 `?labelDebug=1` 을 붙이면 모달에 "인쇄 명령 저장" 버튼이 생긴다 (인쇄하지 않고 바이트를 파일로).

### 상품관리 — 쿠팡 일반상품 (2026-10-20)
`/coupang`(채널 › 쿠팡관리 › **일반판매자 상품** — 메뉴·제목 이름, 코드·문서에서는 여전히 '상품관리')는 쿠팡 상품을 **한 목록**에 보여 주고 상품마다 전체(로켓 + 일반) · 일반 · 로켓그로스를 구분한다. 2026-10-20 에 엑셀 전용 화면을 Open API 동기화 기반으로 전면 재작성했다 (디자인 시안: Claude Design 캔버스).
- **구조**: 타입 `types/coupangProduct.ts` · 서비스 `services/coupangProductService.ts`(조회·동기화·변경·엑셀) · 훅 `pages/useCoupangManagement.ts` · 화면 `components/coupang/*` + `pages/CoupangManagement.tsx` · 스타일 `pages/CoupangManagement.css`(.cp-, 토큰은 `.cp-page`) · 속도 제한 큐 `utils/rateLimitQueue.ts`(초당 5회 — `purchaseService.fetchDetailsFromApi` 의 인라인 큐와 같은 규칙, 그쪽은 아직 안 옮김).
- **데이터는 기존 `si_coupang_items`** (옵션 1행, PK option_id). 라벨·Q반품·출고·재고·입고·사입 라벨·홈 별점이 이 표를 읽어서 새 표를 만들지 않았다. 2026-10-20 추가 칼럼: `channel`('MP' 일반 / 'RG' 로켓, null 이면 바코드 유무로 판단 — 실측: 바코드 있는 행 = 전부 RG 옵션), `img_url`, `delivery_charge_type/delivery_charge/free_ship_over_amount`, 출처별 시각 `detail_synced_at`·`status_checked_at`·`app_changed_at`·`excel_synced_at`. SQL 은 `docs/sql/2026-10-20_*.sql`(칼럼 · 인덱스).
- **동기화 3단계**: ① [목록 받기] = 일반 목록(`/api/coupang/mp-products`, `businessTypes` 없음 → `registrationType NORMAL` 상품만, **옵션 없음**) + 로켓그로스 목록(`fetchAllRgProducts`, 하이브리드 상품은 `items[].marketPlaceItemData`(대문자 P) 로 일반 옵션 ID 가 같이 온다) → 옵션 행 upsert(바뀐 행만, `defaultToNull:false` 로 다른 칼럼 유지). 행이 없는 일반 상품·처음 들어온 RG 상품은 이어서 상세를 받는다. 쿠팡 목록에 없는 상품은 지우지 않는다(보고만). ② [상세 받기] = 상품당 1회 `rg-product/:id`(같은 seller-products 엔드포인트). 순수 일반은 `items[]` 가 평평하고, 하이브리드는 `items[].marketplaceItemData`(소문자 p) / `rocketGrowthItemData` + 배송은 `marketplaceShippingAndReturnInfo`. 바코드는 API 값이 비어 있지 않을 때만 쓴다(엑셀 값 보존). 범위는 "미수신·판매중 상품만 / 미수신 전체". ③ [판매상태] = 옵션당 1회 `vendor-item-inventory`. 전체는 수만 회라 **엑셀이 빠르다** — 화면은 선택 행·오래된 순 500개만.
- **고시정보 (2026-10-20)**: [상세 받기] 가 옵션마다 `notices`(jsonb, `[{category,name,content}]` — null = 미수신, [] = 없음)와 `composition`(혼용률)을 저장한다(`services/coupangNotices.ts`, SQL `docs/sql/2026-10-20_si_coupang_items_notices.sql`). 목록 · 내보내기는 고시정보 JSON 을 읽지 않는다(`ROW_COLUMNS` — 7.8만 행이면 수십 MB). 상세 패널 [정보] 탭이 상품 1개만 `fetchProductNotices` 로 받는다. 이 기능 전에 상세를 받은 상품은 [상세 받기] › "고시정보 받기" 범위로 다시 받는다.
- **끊겼을 때 · 진행률 (2026-10-20)**: 상세는 상품마다 받는 즉시 저장 → 창을 닫아도 받은 것은 남고, 미수신 · 고시정보 없는 범위로 다시 누르면 남은 것만 받는다. 목록은 쿠팡 목록 전체를 메모리로 받은 뒤 저장하므로 그 단계(1~2분)에서 끊기면 다음엔 목록부터 다시 받는다(바뀐 행만 저장). [중단]은 목록 단계에서도 바로 멈춘다 — `syncProductList`·`fetchAllMpProducts`·`fetchAllRgProducts` 가 signal 을 받아 페이지 사이에서 `throwIfAborted`, 진행 중인 요청은 fetch signal 로 끊는다(예전엔 목록 단계가 signal 을 안 받아 [중단]해도 목록을 끝까지 받았다). 목록 받기 중 끊긴 새 상품 상세는 다음 목록 받기에서 '새 상품'이 아니라서 [상세 받기] › 미수신으로 이어진다. 실행마다 `si_coupang_sync_runs`(SQL `docs/sql/2026-10-20_si_coupang_sync_runs.sql`, `services/coupangSyncRunService.ts`)에 시작 · 진행(3초마다) · 끝을 남겨 카드 맨 아래에 보여 준다 — `running` 인데 2분 넘게 갱신이 없으면 '끊김'. 다른 창에서 진행 중이면 동기화 버튼을 잠그고 5초마다 다시 읽는다. 진행 중 창을 닫으려 하면 브라우저가 묻는다. 상품 1개 다시 받기는 기록하지 않는다.
- **엑셀은 보조**: WING 가격/재고 엑셀(`price_inventory`, 3행 머리글·4행부터, A~O)로 가격·재고·판매상태·승인상태를 한 번에 반영한다. 기존 행은 분류·비고·시즌·채널을 건드리지 않고 새 행에만 분류 '출고'(예전엔 매번 '출고'로 덮어썼다 — 2026-10-20 수정). 상세정보 엑셀(Catalog Template)은 안 쓴다. 판매수량(`sales_data`)은 API 에 없고 앱도 안 쓴다.
- **변경 작업**(판매가·재고·할인율 기준가·판매 재개/중지)은 쿠팡 API 가 성공한 옵션만 DB 를 고치고 `app_changed_at` 을 기록. 판매가는 10원 단위, 한 번에 50% 초과 인하·100% 초과 인상은 `forceSalePriceUpdate` 체크가 있어야 간다.
- **목록 = 상품 단위 페이지 (커서)**: `fetchProductPage` 가 ① 필터에 맞는 행의 `item_id` 만 훑어 상품 50개(`PRODUCTS_PER_PAGE`)를 고르고 ② 그 상품들의 옵션 행을 받는다. 다음 페이지는 `item_id < 마지막 ID`(text 비교 — 정렬도 text 라 일치). 페이지 번호 건너뛰기는 없고 이전/다음만(훅의 커서 스택). 옵션 100행씩 자르던 예전 방식은 한 상품이 두 페이지에 걸쳐 접기가 안 돼서 바꿨다. 상품은 기본 접힘(옵션을 겨냥한 검색 — 옵션 ID·바코드·상품코드 — 은 펼쳐서), 같은 페이지 다시 읽기는 펼침 유지. 옵션은 `components/coupang/optionSort.ts` 순(색상끼리 · S→M→L→XL→2XL · FREE 뒤).
- **상품 수정 (2026-10-20, 계획 `docs/plan-coupang-product-edit.md`)** — 쿠팡 규칙대로 세 묶음:
  ① **즉시 반영(옵션)** 판매가·기준가·재고·판매상태 = 목록 칸 클릭(`CoupangInlineCell` · 훅 `applyInline` → `applyChanges` 1건). 칸 잠금 규칙은 `components/coupang/editRules.ts` 한 곳(승인완료 아닌 상품 · 로켓 재고). 로켓 옵션의 판매가·기준가·판매 중지/재개는 문서에 없지만 운영 시험으로 통하는 것을 확인했다(2026-10-20, `RG_OPTION_DIRECT_EDIT = true`). 가격 규칙(10원 단위 · -50%~+100%, 넘으면 강제 적용 확인)은 `priceRules.ts` — 선택 모달과 공용.
  ② **즉시 반영(상품 배송·반품)** = `PUT /api/coupang/seller-product-partial` (쿠팡 `seller-products/{id}/partial`, 허용 필드 `PARTIAL_UPDATE_FIELDS` 는 프록시 양쪽에 같은 목록). 임시저장·승인대기 상품은 쿠팡이 거절. 하이브리드는 일반 쪽만, 로켓 전용은 배송 정보가 없다.
  ③ **재승인(상품 전문)** = `PUT /api/coupang/seller-product`. 저장 직전에 상세를 **다시 받아** 바꾼 칸만 덮어쓴 전문을 보낸다(`mergeProductEdits` — 옵션은 등록옵션 ID 로 맞추고, 못 찾으면 멈춤). `requested:true` 로 승인요청 자동, 프록시가 `vendorId` 를 헤더 값으로 고정. 쿠팡은 임시저장 → 승인대기중 → (자동 승인이면) 승인완료 를 1초 안에 지나가기도 해서(실측: 노출상품명 변경이 즉시 승인), 임시저장을 지날 때까지 최대 ~10초 상태를 다시 본 뒤 상세를 저장한다. 수정 중에도 기존 승인본은 계속 판매된다(실측). **로켓·하이브리드 상품**은 `additionalInformationForRocketGrowth.legalAgreement='AGREE'` 가 없으면 쿠팡이 "로켓그로스 입고 불가 조건을 확인하시고 동의해주세요" 로 거절한다(실측) — 약관 동의라 자동으로 넣지 않고, 폼의 동의 체크를 사용자가 직접 해야 보낸다(`rocketGrowthAgreement`, 요청마다 해제). 화면은 상세 패널 [수정] 탭(`CoupangProductEditForm` · `useCoupangProductEdit` · `services/coupangProductEditService.ts`).
  바꿀 수 없는 값: 카테고리 · 상품상태 · 묶음정보 · 승인된 옵션 삭제. 이미지·상세 콘텐츠·고시정보·출고지/반품지 코드는 아직 안 만들었다(편집기 규모).
- **규모 주의**: immong 계정 옵션 78,012 · 상품 16,290 (하이브리드 5,387). 한 화면에서 count 쿼리를 동시에 10개 넘게 보내면 Supabase statement timeout 이 난다 → 페이지 → 요약 → 건수 **순서대로** 받는다. 쿠팡은 **등록 IP(Railway)만** 받으므로 로컬 dev 에서 쿠팡 호출은 403 — 새 프록시 경로는 배포 후에만 확인할 수 있다.
- 사입관리 [바코드 동기화]와 같은 상세 응답을 쓰므로, 하이브리드 상품은 한 호출로 `si_rg_items` 와 `si_coupang_items` 를 같이 채울 수 있다 — 아직 합치지 않았다(각자 호출).

### 로켓그로스 콘솔 (2026-10-27)
`/rocket-console`(물류 › 출고관리 › 로켓그로스 콘솔)은 쿠팡윙 로켓그로스 **입고 생성** 화면에 F12 › Console 로 붙여넣을 자동화 스크립트를 만든다. 쿠팡 API 나 DB 는 쓰지 않는다 — 엑셀을 읽어 문자열을 만들고 복사만 한다.
- **화면**: 맨 위 엑셀 드롭 영역(`components/rocket-console/InboundExcelDrop.tsx`)에서 한 번만 받고, 아래 보드(`ConsoleBoard.tsx`)들이 같은 엑셀로 각자 스크립트를 만든다. 보드는 `pages/useRocketConsole.ts` 의 `BOARD_DEFS` 배열 — 단계를 늘릴 때는 항목 하나 + 서비스 build 함수 하나 + 템플릿 하나. 예정 5단계 중 1~3단계가 있다.
- **엑셀 해석**: `parseInboundExcel` (`services/rocketConsoleService.ts`) — 시트 '로켓그로스 입고', '옵션 ID' 머리글 아래 · '예시 및 설명' 행 제외. 옵션 ID 가 숫자가 아니거나 입고 수량이 양의 정수가 아닌 행은 **모든 단계에서 함께 뺀다**(2단계가 화면 ↔ 엑셀을 대조하므로 단계마다 목록이 다르면 안 된다). 같은 옵션 ID 가 다시 나오면 첫 행만 쓰고 경고, 수량을 화면과 대조하는 2·3단계는 수량을 정할 수 없어 만들지 않는다. 바코드('상품바코드')·엑셀 사이즈('상품 사이즈') 열은 없어도 된다(빈 값).
- **스크립트 = 템플릿 원문**: `services/rocketConsoleScripts/*.console.js` 를 `?raw` 로 읽어 `@@FILE_NAME@@`·`@@COUNT@@`·데이터 줄(`    /*@@이름@@*/`)만 바꾼다. 운영자가 쓰던 콘솔과 글자 단위로 같다(첨부 엑셀로 대조 확인). 쿠팡윙 화면 선택자가 바뀌면 템플릿만 고치고 자리표시는 남긴다 — 빠진 자리표시가 있으면 서비스가 오류를 낸다. 템플릿은 tsc 대상이 아니다(allowJs 없음).
  - 1단계 상품 선택 = `selectProducts.console.js` (옵션 ID 20개씩 검색 → 체크) · 2단계 상품 확인·수량 입력 = `inputQuantities.console.js` (화면 상품 ↔ 엑셀 대조, 다르면 아무것도 입력하지 않고 정지 → 수량 입력 → 재검증) · 3단계 사이즈 분류 리포트 = `sizeReport.console.js` (2단계 화면의 윙 사이즈·규격·무게를 읽어 사이즈별 시트 .xlsx 다운로드 — 스크립트 안에서 zip 을 직접 만든다, `@@FILE_TAG@@` = 확장자 뗀 파일명).
  - 상품명 · 옵션명은 `jsString` 으로 이스케이프한다(`'` · `\` · 줄바꿈 · U+2028/2029).
- 클립보드 복사는 `utils/clipboard.ts`(`copyTextToClipboard`) — 다른 화면의 인라인 execCommand 복사는 아직 이걸로 안 옮겼다.

### 사입관리 — 상품 동기화 (2026-10-08)
`/purchase-management` 의 행은 `si_rg_items`(로켓그로스 옵션 1개 = 1행)다. 쿠팡 값과 직접 입력값(비고·주문수량·카트·상태·입력·가격수정시각)이 **같은 행**에 있다.
- **[리셋]·[업데이트]** = 상품 목록 API → `syncRgItemsFromList`(`purchaseService.ts`). 옵션 ID(`vendor_item_id`)로 맞춰 **목록 칼럼만** 고친다(`LIST_SYNC_COLUMNS`: 등록상품 ID·노출상품 ID·상태·상품명·판매시작·옵션명·등록옵션 ID). 리셋은 여기에 더해 목록에 없는 옵션을 지운다(저장 실패가 있으면 지우기를 건너뜀). 예전처럼 계정 행을 통째로 지우고 다시 넣으면 직접 입력값이 사라지니 그렇게 되돌리지 않는다.
- **갱신은 id 기준 upsert** — 한 배치의 행은 칼럼 구성이 같아야 한다(빠진 칼럼은 PostgREST 가 null 로 덮는다). 목록 값이 null 이면 기존 값을 유지.
- **승인 전 옵션은 옵션 ID 가 없다** — 예전 코드가 `String(null)` 로 `'null'` 글자를 저장했다(2026-10-08 DB 40행 정리). ID 는 `idString()` 으로만 만들고, 병합 키도 `'null'` 을 '없음'으로 본다. 키로 쓰면 승인 전 옵션들이 한 옵션으로 묶여 서로 다른 상품 값으로 덮인다.
- **[바코드 동기화]** = 상세 API(초당 5건). 바코드나 이미지가 빈 행이 대상이고, 바코드(비어 있을 때만)·대표 이미지·판매가·사이즈·노출상품명·SKU 를 한 번에 채운다(`fetchDetailsFromApi`). 목록 API 에는 이 값들이 없다.
- **노출상품 ID** = `si_rg_items.product_id` ← 목록 API `productId`(승인된 상품만). 상세 API 응답에는 없다. 재고 SKU 엑셀의 'Inventory ID'(`si_rg_item_data.item_id`)는 **등록상품 ID** 다. `si_coupang_items.product_id` 도 일부 행이 칸이 밀려 있어 믿을 수 없다. 상세 패널의 쿠팡 링크는 `product_id` 가 있을 때만 보인다.
- **API 로 엑셀을 대체하지 않은 이유**: 로켓창고 재고 API·로켓그로스 주문 API 는 분당 50회 제한에 페이지 크기가 문서에 없다. 재고 API 는 주문가능수량·30일 판매수량만 주고(7일·아이템위너·입고예정·보관료·재고기간·반품 없음), 주문 API 는 판매자배송을 주지 않아 재고 SKU·기간판매량 엑셀이 계속 필요하다.

### 홈 — 상품 랭킹 (2026-10-02)
`/`(예전 '공지사항')는 로켓그로스 사입 화면의 값을 **상품(seller_product_id) 단위로 합쳐** 1~10위를 보여 준다.
- **구조**: `services/productRankingService.ts`(조회 + `buildProductRanking`) · `pages/useProductRanking.ts` · `components/home/ProductRankingCards.tsx`(한 줄 5장) · `pages/Index.tsx`.
- **보관(하루)**: 계산이 끝난 순위표(기준 넷 × 20위)와 이미지 주소를 localStorage `home_ranking_cache_v1` 에 둔다(`services/productRankingCache.ts`). 같은 계정 · 24시간 이내면 조회 없이 그대로 보여 주고, 지났거나 [새로고침] 을 누르면 새로 받는다. 원천 수만 행은 용량 때문에 보관하지 않는다. 보관 모양을 바꾸면 키의 버전을 올린다.
- **레이아웃**: `Layout` 의 `<main>` 이 `overflow: hidden` 이라 `Index` 가 직접 스크롤 영역(100vh)이다. 본문 래퍼가 `container-type: size` 이고 카드 줄 높이를 `100cqh` 로 잡아 두 줄이 한 화면에 꼭 맞는다(최소 330px). 이미지는 남는 높이만큼만, 원본(230px) 이내로 그린다.
- **[더보기]**: 처음 1~10위(`RANKING_SIZE`), 누르면 20위(`RANKING_MAX_SIZE`)까지. 이미지는 펼쳐진 순위 것만 받는다.
- **카드 클릭**: `/purchase-management` 로 가면서 `location.state.search`(`PurchaseManagementLocationState`)에 상품명을 넘기고, `usePurchaseManagement` 가 그 값을 검색어 초깃값으로 쓴다. 상품명에 콤마·탭이 있으면 사입관리 검색이 여러 검색어로 쪼개므로 그때는 상품 ID 를 넘긴다.
- **카드의 값**: 개인 · 기간 · 7일 · 30일 │ 🛒 · 주문 · C.in · 창고 + 합계(뒤의 넷을 더한 값). 순위 기준은 앞의 넷 중 하나(기본 7일 · 이 브라우저에 기억 `home_ranking_basis`).
- **이미지**: 순위에 든 상품만, 순위가 뜬 뒤에 받는다(`fetchProductImageUrls`). `si_rg_items.img_url`(사입관리 [바코드 동기화]가 쿠팡 상세 API 에서 저장한 값)을 먼저 쓰고, 저장된 값이 없는 상품만 쿠팡 상품 상세 API(`/api/coupang/rg-product/:id`)를 부른다. 주소 형식은 `purchaseService.getRepresentativeImageUrl` 한 곳에서 만든다.
- **쿠팡 별점**: 순위 숫자 옆 `⭐ 4.5 (338)`. 이 앱에는 별점을 받아 오는 경로가 없어서(쿠팡 Open API 에 없음), 아이엠몽 로켓 앱(immongRK_scan)이 Wing 광고센터에서 수집해 둔 `rk_coupang_info`(같은 DB)를 **노출상품 ID** 로 빌려 쓴다 — `si_rg_items.vendor_item_id → si_coupang_items.option_id → product_id → rk_coupang_info.product_id` (`fetchProductRatings`). 로켓 앱이 수집한 상품과 노출상품 ID 가 겹치는 상품에만 나온다(계정에 따라 0건일 수 있음). 이미지처럼 순위가 뜬 뒤에 받고 하루 보관본에 같이 둔다.
- **사입관리와 같은 규칙이어야 한다** — 비활성(`NOT_AVAILABLE`) 옵션 제외, 기준 값 0 인 상품 제외, 동점은 상품명. 사입관리의 열 계산(`renderCell`)이나 [상품기준] 합산을 바꾸면 여기도 같이 본다.
- **합칠 때 한 번씩만 더한다**: 개인·창고는 바코드 기준, 기간·7일·30일·C.in 은 옵션 ID 기준 값이라 한 상품 안에서 같은 키가 두 번 나오면 중복으로 더하지 않는다. 🛒·주문은 행에 저장된 값이라 행마다 더한다.
- **필요한 열만 받는다** (`select *` 아님) — 계정당 si_rg_items 1.6만 · si_rg_item_data 2.3만 행이라 홈 진입마다 전부 받으면 무겁다. 가장 큰 계정 기준 전체 로드 약 1.7초(실측).
- 창고 재고 조회(`fetchWarehouseQtyByBarcode`)는 `usePurchaseManagement` 안의 인라인 함수와 같은 일을 한다 — 그쪽은 아직 훅 안에 있다(중복). 합칠 때는 이 서비스 것을 쓰게 하면 된다.

### 개인주문 — 표 정리 · [배송준비] 송장 등록 · 분리배송 (2026-11-11)
`/personal-order` 표에서 '상태'·'합배송' 열을 없애고 각각 상품정보·수취인 칸에 합쳤다. 표 위 [배송준비] 는 송장 엑셀로 상품준비중 주문을 쿠팡 배송지시로 바꾼다(WING 엑셀 송장등록과 같은 일).
- **표**: 상품정보 칸의 상품명 바로 뒤 = fulfillment 상태 점/🛒(`.po-product-cell` flex — 칸 끝에 고정하지 않는다. 상품명만 '…' 로 잘리고 상태는 그 뒤에 남는다), 수취인 칸 = 이름 + 합배송 배지(같은 주문번호 2줄 이상일 때만). 둘 다 `data-no-copy` 장식이라 셀 복사(Ctrl+C)는 복제본에서 지운 글자만 들어간다. 장식을 새로 넣으면 같은 속성을 단다.
- **입고준비 표시**: `InboundAlloc` 의 `displayStr`(`SHHI261107 [HI-P-01 - 1] SHHI261108 [..]`, shipment 번호별 묶음 · `추가★` 는 마지막 묶음 안)은 화면 전용이고, `boxStr`(`[HI-P-01 - 1, ..]`)은 입고엑셀 등록상품명 접두라 형식을 바꾸지 않는다.
- **구조**: 택배사표 `services/coupangCarriers.ts`(코드·표시 이름·별칭·운송장 자릿수, 업체직송 미지원) · 서비스 `services/deliveryInstructService.ts`(엑셀 파싱 → `buildDeliveryInstructPlan` 순수 함수 → 순차 전송 → DB 반영) · 훅 `components/personal-order/useDeliveryInstruct.ts` · 모달 `DeliveryInstructModal.tsx`. `usePersonalOrder` 는 `items` · `applyRowPatches`(성공 줄에 서비스가 정한 값 덮기 — [출고중지] 와 공용) · `handleUpdate` 만 내준다. 줄 단위 DB 반영은 `personalOrderService.saveOrderRowPatches`, 두 모달의 공용 부품(요약 칸 · 스크롤 표 · 진행 막대)은 `components/personal-order/modalParts.tsx`.
- **엑셀**: DeliveryList 머리글(묶음배송번호·주문번호·택배사·운송장번호·옵션ID, 선택 '분리배송 Y/N'·'분리배송 출고예정일')을 이름으로 찾고 그 머리글이 있는 시트를 모두 읽는다(입고엑셀은 Delivery·합배송). 숫자 셀이 안전한 정수·15자리를 넘으면 행 오류(자릿수 손실 — 틀린 ID 로 보내지 않음). 운송장은 공백·하이픈 제거. 날짜 칸은 글자(2026-11-20 등)·숫자 20261120·Excel 일련번호를 YYYY-MM-DD 로 읽는다.
- **방식 3가지** (묶음마다 판정, `DeliveryMode`): ① **일반** — 묶음 전체를 한 송장으로. ② **분리 시작** — 엑셀 그 묶음의 모든 행 '분리배송 Y/N' 이 Y. 묶음의 모든 옵션을 한 번에 보내되 운송장이 있는 옵션은 지금, 없는 옵션은 출고예정일(엑셀 '분리배송 출고예정일' 칸 → 없으면 주문에 등록된 `estimated_shipping_date`)로 나중에. ③ **분리 이어 보내기** — DB `split_shipping` 이 'Y'(쿠팡 `splitShipping=true`)인 묶음은 엑셀 표시와 무관하게 이 방식: 남은 옵션 중 운송장이 있는 것만 보낸다. 값은 `personalOrderService.SPLIT_SHIPPING`. 운송장이 일부만 있다고 자동으로 분리배송하지 않는다(되돌릴 수 없어서 Y 표시를 요구).
- **사전 검사**: 운송장이 하나도 없는 묶음 = 제외(실패 아님) → 행 검사(셀 형식 · DB 에 묶음+옵션 없음 · 주문번호 불일치 · 상품준비중(INSTRUCT) 아님 · 출고중지 · 취소 상품 · 택배사 · 운송장 자릿수) → 같은 옵션 중복(같으면 하나로, 다르면 실패) → 방식별 묶음 검사. 일반: 취소 안 된 옵션이 모두 있고 택배사·운송장이 같아야 한다(쿠팡 `NOT_FOUND_VENDOR_ITEM`). 분리 시작: 옵션 2개 이상 · 쿠팡이 분리배송불가로 표시하지 않음 · 모든 옵션 행이 있음 · Y 가 묶음 안에서 일치 · 송장이 전부 같지 않음 · 나중 줄의 택배사(비면 지금 줄의 택배사가 하나일 때 이어받음)와 출고예정일을 정할 수 있음. **일반·분리 시작은 한 행이라도 걸리면 묶음 전체를 보내지 않고, 분리 이어 보내기만 걸린 행을 빼고 보낸다**(옵션마다 따로 접수되므로 — 예전 엑셀의 이미 보낸 상품 행 때문에 막히지 않게). 검사 기준은 화면이 가진 `items` 라 오래됐으면 [주문 업데이트] 후 다시 올린다. 분리배송 묶음은 모달에서 줄별로 보여 주고 확인 체크를 받아야 등록된다(지난 출고예정일은 경고 표시).
- **전송**: `POST /api/coupang/orders-invoices` → 쿠팡 `v4/vendors/{vendorId}/orders/invoices`. 줄마다 `splitShipping`(분리 여부) · `preSplitShipped`(이어 보내기) · `estimatedShippingDate` 를 보내고 프록시가 조합을 다시 검증한다(일반: 송장 필수 / 분리: 송장과 날짜 중 하나만 / 이어 보내기: 송장 필수). 요청당 최대 50줄(`INVOICE_UPLOAD_MAX_DTOS` = 프록시 `INVOICE_UPLOAD_MAX_ITEMS`, 문서엔 최대값 없음), 묶음은 쪼개지 않고 한 번에 1요청 · 200ms 간격 · 중단은 요청 사이에서만. 프록시는 `{ success, data: 쿠팡 본문, coupangStatus: 쿠팡 HTTP 상태 }` 를 주고, **쿠팡 HTTP 400 일 때만** 묶음 하나씩 다시 보낸다(인증 401 과 송장 형식 400 의 본문이 같은 모양이라 상태로만 가른다 — 401·403·429 등은 그대로 실패). 기존 라우트는 그대로 `callCoupangAPI`(본문만), 이 라우트만 `callCoupangAPIWithStatus` 를 쓴다. 응답을 못 받았거나(네트워크·5xx) 한 묶음 안에서 성공·실패가 섞이면 **자동 재시도하지 않고** '확인 필요' — 반영됐을 수 있으니 [주문 업데이트] 로 확인 후 남은 건만 다시 올린다.
- **반영**: 성공 줄(묶음배송번호+옵션ID)마다 `toInstructedRows` 가 정한 값을 화면 `items` 와 `coupang_personal_orders` 에 똑같이 쓴다 — 송장이 나간 줄은 `status='DEPARTURE'`·`invoice_number`·`delivery_company_name`, 분리배송의 나중 줄은 상태 그대로 + `planned_shipping_date`, 분리배송 줄은 `split_shipping='Y'`(`pending_invoice_number` 는 안 건드림). **분리배송 뒤에는 먼저 보낸 옵션의 묶음배송번호가 쿠팡에서 바뀌므로** 결과 화면의 [닫고 주문 업데이트] 로 맞춘다(그 전까지 예전 번호로 남지만 배송지시 상태라 다시 보내지 않고, 남은 옵션은 예전 번호 그대로 이어 보낸다). DB 반영 실패 묶음은 결과에 "쿠팡에는 등록됨 · 화면 반영 실패" 로 안내.
- 프록시는 쿠팡 프록시 규칙대로 **양쪽**(`coupangProxy.ts` · `prodServer.js`)에 있다. 쿠팡은 등록 IP(Railway)만 받으므로 실제 등록은 배포 후에만 확인할 수 있다.

### 개인주문 — [출고중지] 상품준비중 주문 취소 (2026-11-12)
`/personal-order` 상품준비중 탭에서 줄을 체크하고 표 위 [출고중지] → 확인 모달 → 쿠팡에서 취소한다 (WING 의 주문취소 → 출고중지요청 › 출고중지완료와 같은 일).
- **쿠팡 API 3개** (developers.coupang.com 2026-11-12 확인): ① 주문 상품 취소 처리 `POST v5/vendors/{vendorId}/orders/{orderId}/cancel` ② 반품요청 단건 조회 `GET v6/.../returnRequests/{receiptId}` ③ 출고중지완료 처리 `PATCH v4/.../returnRequests/{receiptId}/stoppedShipment`. 문서상 상품준비중 주문은 ①만으로 출고중지 접수 + 완료가 된다(`receiptType=STOP_SHIPMENT` = 출고중지완료 접수 번호). WING 은 2단계라 **①이 접수되면 ②로 접수 건을 확인하고, 출고중지요청으로 남아 있으면(`RELEASE_STOP_UNCHECKED` 또는 `releaseStatus=N`) ③까지 부른다** — 어느 쪽이든 같은 코드로 끝난다. 결과 화면이 "취소 접수로 완료 / 출고중지완료 처리까지 실행"을 구분해 보여 준다. **실측(2026-11-12, hilili 1건): ① 한 번으로 끝났다** — 1초 뒤 ②가 `RETURNS_COMPLETED` · `releaseStatus=S` 라 ③은 부르지 않았다. 응답 모양은 문서와 다르다: 성공 본문의 `receiptMap` 은 접수번호를 키로 묶은 꼴(`{"<receiptId>": {…}}`), 거절은 HTTP 200 + 본문 `code: 400`(문서는 HTTP 400) — 둘 다 코드가 읽는다.
- **API 로는 귀책·사유를 고를 수 없다**: 코드가 `CANERR` + `CCTTER/CCPNER/CCPRER` 뿐이고, 상품준비중 취소는 입력과 무관하게 '품절'(판매자 사유 · 상세 "파트너 API 강제 취소")로 고정되며 판매자 점수(주문이행)가 내려간다. 그래서 사유 선택 UI 가 없고(`CCTTER` 고정) 모달에서 확인 체크를 받는다. 실측 기록: `faultByType=VENDOR` · `reasonCode=OOSSELLER`(업체 품절) · 사유 카테고리 '오류' › '재고연동오류'(보낸 `CCTTER` 의 뜻 — 카테고리는 보낸 코드를 따라간 것으로 보인다. 다른 두 코드는 안 보내 봤다) · 상세 '파트너 API 강제 취소'. 고객 사유로 처리할 건은 WING 에서 한다. **고객 사유 코드는 Open API 가 거절한다(실측 2026-11-12)**: WING 화면이 쓰는 `bigCancelCode=CUSTOMER` + `CHANGEMIND` → "취소사유 대분류 코드를 확인해 주세요", `CANERR` + `CHANGEMIND` → "취소사유 중분류 코드를 확인해 주세요" (둘 다 HTTP 200 + 본문 `code: 400`, 주문 변화 없음). WING 의 사유 코드(고객 `CHANGEMIND`·`WRONGOPT`·`DELIVERYLATER`·`DIFFERENTOPT`·`CHEAPER` / 판매자 `OOSSELLER` 등 10개)는 로그인 세션용 내부 주소(`/tenants/sfl-portal/refund/return/{orderId}`)에서만 통한다. 그래서 고객문의 취소 드로어(`orderCancelService`)의 고객사유 선택지는 고르면 항상 거절된다 — 아직 안 고쳤다.
- **구조**: 서비스 `services/shipmentStopService.ts`(`buildShipmentStopPlan` 순수 함수 → `runShipmentStop` 순차 실행 → `toStoppedRowPatches` → `saveShipmentStopped`) · 훅 `components/personal-order/useShipmentStop.ts` · 모달 `ShipmentStopModal.tsx`. WING 로그인 ID(`userId`)는 모달을 열 때마다 `fetchCoupangUserName()` — 없으면 실행 버튼이 막힌다.
- **대상**: 체크한 줄의 **남은 수량 전체**(`shipping_count − cancel_count`), 묶음배송번호마다 요청 1회(문서: 묶음이 여럿인 주문은 묶음별로). 제외: 상품준비중이 아님 · 이미 취소 · **고객이 먼저 취소를 요청한 건(`release_stop`)** — 그 건은 접수번호를 찾아 ③만 부르는 다른 흐름이라 아직 안 만들었다(WING). 부분 수량 취소도 없다.
- **결과 5종**(`StopOutcome`): `completed` · `needsCheck`(취소는 접수됨 — 완료 미확인 또는 일부 옵션 거절. **화면·DB 는 취소로 반영**) · `failed`(바뀐 것 없음) · `unknown`(응답 없음 · 5xx · 412 시간 초과 · "롤백에 실패" 거절 — 반영하지 않고 자동 재시도도 안 함) · `notSent`(중단). 중단은 묶음 사이에서만 — 접수한 묶음은 확인까지 마친다.
- **반영**: 접수된 줄에 `canceled=true` · `cancel_count=shipping_count` 를 화면과 `coupang_personal_orders` 에 같이 쓴다(다음 [주문 업데이트] 가 쿠팡 값으로 덮는다). 취소된 줄은 상품명 앞 빨간 '취소' 표시(`.po-canceled-chip`, `data-no-copy`)가 붙고 [배송준비] · 사입관리 '개인' 수량 · **입고준비 재고 할당**에서 빠진다(입고준비는 2026-11-12 부터 `canceled` 줄 제외).
- **프록시**: `POST /api/coupang/order-cancel`(기존 라우트 — body 를 숫자로 검증하고 `coupangStatus` 를 같이 준다. 고객문의 드로어는 `data` 만 쓴다) · `GET /api/coupang/return-request-detail?receiptId=` · `PATCH /api/coupang/return-request-stop`. 셋 다 **양쪽**에 있다.

## Reference

Coupang Open API docs extracted from the official site are in `coupang_api_md/` (guide, product, CS, rocket_growth, etc.). Consult these before inventing new endpoint paths or parameters.

`README.md` and `SETUP-GUIDE.md` describe the original bootstrap (Supabase schema, approval flow). Note that the live `si_users` schema has drifted from the one documented in `supabase-setup.sql` (current columns include `username`, `seller_id`, `account_approval` as text, `order_user_id`) — trust the code over the SQL file.
