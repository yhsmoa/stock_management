/// <reference types="vite/client" />

/**
 * 렌더러에서 사용하는 환경변수 타입.
 * (CLAUDE.md 기준 — 렌더러가 읽는 env 는 아래 두 개뿐)
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
