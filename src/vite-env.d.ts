/// <reference types="vite/client" />

/**
 * 렌더러에서 사용하는 환경변수 타입.
 * (CLAUDE.md 기준 — Supabase 두 개 + 라벨 서비스 주소)
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** 라벨 서비스(label-service) 주소 — 라벨 설정 링크 · 라벨출력 iframe 에 쓴다 */
  readonly VITE_LABEL_SERVICE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
