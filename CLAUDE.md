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

There is no lint, test, or typecheck script. `tsc --noEmit` is not wired up; TypeScript errors only surface via Vite's build. If you add checks, wire them into `package.json` scripts rather than inventing ad-hoc commands.

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
- **Env vars**: Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are read by the renderer. The prod server uses `PORT`. No other env vars — if you think you need one, check if a header-based per-user key (Coupang pattern) fits better.

## Reference

Coupang Open API docs extracted from the official site are in `coupang_api_md/` (guide, product, CS, rocket_growth, etc.). Consult these before inventing new endpoint paths or parameters.

`README.md` and `SETUP-GUIDE.md` describe the original bootstrap (Supabase schema, approval flow). Note that the live `si_users` schema has drifted from the one documented in `supabase-setup.sql` (current columns include `username`, `seller_id`, `account_approval` as text, `order_user_id`) — trust the code over the SQL file.
