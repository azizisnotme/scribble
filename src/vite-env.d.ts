/// <reference types="vite/client" />

/** Extend env keys here (also covered by vite/client base types). */
interface ImportMetaEnv {
  /** When `"1"`, use Python sidecar (Tauri `py_call` or launcher `/rpc`) instead of the built-in engine. */
  readonly VITE_USE_PYTHON_RPC?: string
  /** Public Supabase project URL. */
  readonly VITE_SUPABASE_URL?: string
  /** Public Supabase publishable (or legacy anon) key. Never use a service-role key here. */
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
