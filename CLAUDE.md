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

`si_users` has a separate `order_user_id` column that maps to an external `purchase_agent.ft_users.id`. `getOrderUserId()` in `supabase.ts` handles localStorage caching of this lookup — reuse it rather than re-querying.

### Electron main/preload
`src/main/main.ts` is minimal: create a `BrowserWindow`, load `VITE_DEV_SERVER_URL` in dev or `dist/index.html` in prod. `preload.ts` exists but exposes no bridge — the renderer talks to Supabase and the Coupang proxy directly via HTTP. If you need IPC, you're adding it from scratch.

Electron is built separately via `scripts/build-electron.mjs` (called manually; the `build` script only produces the web bundle). `electron.vite.config.mjs` defines the CJS output for `dist-electron/`.

## Conventions in this codebase

- **Language**: UI copy, code comments, and commit messages are Korean. Follow suit — don't translate existing Korean comments to English when editing nearby code.
- **Commit style**: Conventional Commits in Korean (`feat:`, `fix:`, `refactor:`, `style:` + Korean summary). See `git log` for examples.
- **Path alias**: `@/*` → `src/*` (configured in `tsconfig.json` and `vite.config.ts`).
- **TypeScript**: `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` are all on. Don't silence them with `// @ts-ignore`; fix the underlying issue.
- **Env vars**: The renderer reads `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. The prod server uses `PORT`, plus `QZ_CERTIFICATE` / `QZ_PRIVATE_KEY` (라벨 인쇄 서명 — 아래 절). The Vite dev server reads the same two QZ vars from `.env` (no `VITE_` prefix, so they never reach the browser). No other env vars — if you think you need one, check if a header-based per-user key (Coupang pattern) fits better.

### 라벨 출력 (내장 — QZ Tray)
라벨 양식 편집기(`/label-settings`, 사이드 메뉴 물류 › 라벨 설정)와 상품관리 [라벨출력] 모달이 이 앱 안에 있다. 원래 별도 서비스 label-service(Next.js, iframe)였는데 iframe 제약(저장소 분리·localhost 권한) 때문에 2026-09 에 옮겨 왔다 — label-service 는 아이엠몽 로켓용으로 남아 있고 **코드를 공유하지 않는 복사본**이다.
- **구조**: 엔진 `utils/label/` (labelTypes·labelRender·tspl·zpl·labelJob·qzTray·careSymbols·localPrinterMap), 문구 `utils/label/ko.json` + `i18n.ts`(`t()` — i18next 호출 모양만 흉내, 한국어만), 서비스 `services/labelTemplateService.ts`(템플릿·기록·계정) · `labelPrintService.ts`(인쇄) · `labelService.ts`(상품 행 → 인쇄 항목), 화면 `pages/LabelSettings.tsx` + `components/label-settings/*`, `components/label/*`(모달).
- **데이터**: 같은 Supabase 의 `label_templates`·`label_print_logs`. 이 앱은 `source='stock'` 만 읽고 쓴다(`APP_LABEL_SOURCE`) — 같은 표의 `rocket` 행은 label-service 것이니 건드리지 않는다. 권한 규칙(내 것+공용, `user_ids` 는 null 또는 [내 id], 기본 템플릿 그룹당 1개)은 서비스가 브라우저에서 강제한다(RLS 없음).
- **QZ 서명**: `/api/qz/cert`·`/api/qz/sign` 이 개발(`src/server/qzSignProxy.ts`)과 운영(`prodServer.js`) 두 곳에 있다 — 쿠팡 프록시처럼 **양쪽을 같이 고친다**. 인증서·키는 label-service 와 같은 값이라 인쇄 PC 의 `override.crt` 를 바꿀 필요가 없다.
- **프린터 지정**: 템플릿별로 이 PC 의 localStorage(`ls_local_printer_map_v1`). 라벨 설정 프린터 탭과 모달이 같은 값을 공유한다.
- **필드 규약**: `labelService.ts` 의 `toLabelPrintItems()` 가 만드는 data 키는 `SOURCE_PRODUCT_FIELDS.stock` 과 같아야 한다 — 바꾸면 양쪽을 같이 고친다.
- **사입관리 [라벨]**: 체크한 `si_rg_items` 행 → `services/purchaseLabelService.ts` 가 `vendor_item_id = si_coupang_items.option_id`(숫자 ID 만)로 상품관리 행을 찾아 같은 `toLabelPrintItems()` 로 변환 → `LabelPrintModal editableQty`(행별 장수 입력, 0장은 제외). 상품관리에 없는 행은 사입관리 값으로 채우고 출고코드는 비운다(모달 안내). 화면 상태는 `components/purchase/usePurchaseLabel.ts` — `usePurchaseManagement` 는 건드리지 않는다.
- **혼용률·권장연령**: `si_item_info` 테이블이 DB 에 아직 없어서 두 화면 모두 채우지 않는다 → 전부 성인 템플릿, 케어라벨 소재란 빈칸.
- **명령 언어**: 템플릿의 `printer_lang`(TSPL2/ZPL)이 프린터 기종과 맞아야 한다. BIXOLON(BPL-Z)에 TSPL 을 보내면 라벨 대신 프린터 정보 문구가 찍힌다.
- **진단**: 상품관리 URL 에 `?labelDebug=1` 을 붙이면 모달에 "인쇄 명령 저장" 버튼이 생긴다 (인쇄하지 않고 바이트를 파일로).

### 홈 — 상품 랭킹 (2026-10-02)
`/`(예전 '공지사항')는 로켓그로스 사입 화면의 값을 **상품(seller_product_id) 단위로 합쳐** 1~10위를 보여 준다.
- **구조**: `services/productRankingService.ts`(조회 + `buildProductRanking`) · `pages/useProductRanking.ts` · `components/home/ProductRankingCards.tsx`(한 줄 5장) · `pages/Index.tsx`.
- **보관(하루)**: 계산이 끝난 순위표(기준 넷 × 20위)와 이미지 주소를 localStorage `home_ranking_cache_v1` 에 둔다(`services/productRankingCache.ts`). 같은 계정 · 24시간 이내면 조회 없이 그대로 보여 주고, 지났거나 [새로고침] 을 누르면 새로 받는다. 원천 수만 행은 용량 때문에 보관하지 않는다. 보관 모양을 바꾸면 키의 버전을 올린다.
- **레이아웃**: `Layout` 의 `<main>` 이 `overflow: hidden` 이라 `Index` 가 직접 스크롤 영역(100vh)이다. 본문 래퍼가 `container-type: size` 이고 카드 줄 높이를 `100cqh` 로 잡아 두 줄이 한 화면에 꼭 맞는다(최소 330px). 이미지는 남는 높이만큼만, 원본(230px) 이내로 그린다.
- **[더보기]**: 처음 1~10위(`RANKING_SIZE`), 누르면 20위(`RANKING_MAX_SIZE`)까지. 이미지는 펼쳐진 순위 것만 받는다.
- **카드 클릭**: `/purchase-management` 로 가면서 `location.state.search`(`PurchaseManagementLocationState`)에 상품명을 넘기고, `usePurchaseManagement` 가 그 값을 검색어 초깃값으로 쓴다. 상품명에 콤마·탭이 있으면 사입관리 검색이 여러 검색어로 쪼개므로 그때는 상품 ID 를 넘긴다.
- **카드의 값**: 개인 · 기간 · 7일 · 30일 │ 🛒 · 주문 · C.in · 창고 + 합계(뒤의 넷을 더한 값). 순위 기준은 앞의 넷 중 하나(기본 7일 · 이 브라우저에 기억 `home_ranking_basis`).
- **이미지**: 순위에 든 상품만, 순위가 뜬 뒤에 받는다(`fetchProductImageUrls`). `si_rg_items.img_url`(상품 동기화 때 쿠팡 상세 API 에서 저장한 값)을 먼저 쓰고, 저장된 값이 없는 상품만 쿠팡 상품 상세 API(`/api/coupang/rg-product/:id`)를 부른다. 주소 형식은 `purchaseService.getRepresentativeImageUrl` 한 곳에서 만든다.
- **사입관리와 같은 규칙이어야 한다** — 비활성(`NOT_AVAILABLE`) 옵션 제외, 기준 값 0 인 상품 제외, 동점은 상품명. 사입관리의 열 계산(`renderCell`)이나 [상품기준] 합산을 바꾸면 여기도 같이 본다.
- **합칠 때 한 번씩만 더한다**: 개인·창고는 바코드 기준, 기간·7일·30일·C.in 은 옵션 ID 기준 값이라 한 상품 안에서 같은 키가 두 번 나오면 중복으로 더하지 않는다. 🛒·주문은 행에 저장된 값이라 행마다 더한다.
- **필요한 열만 받는다** (`select *` 아님) — 계정당 si_rg_items 1.6만 · si_rg_item_data 2.3만 행이라 홈 진입마다 전부 받으면 무겁다. 가장 큰 계정 기준 전체 로드 약 1.7초(실측).
- 창고 재고 조회(`fetchWarehouseQtyByBarcode`)는 `usePurchaseManagement` 안의 인라인 함수와 같은 일을 한다 — 그쪽은 아직 훅 안에 있다(중복). 합칠 때는 이 서비스 것을 쓰게 하면 된다.

## Reference

Coupang Open API docs extracted from the official site are in `coupang_api_md/` (guide, product, CS, rocket_growth, etc.). Consult these before inventing new endpoint paths or parameters.

`README.md` and `SETUP-GUIDE.md` describe the original bootstrap (Supabase schema, approval flow). Note that the live `si_users` schema has drifted from the one documented in `supabase-setup.sql` (current columns include `username`, `seller_id`, `account_approval` as text, `order_user_id`) — trust the code over the SQL file.
