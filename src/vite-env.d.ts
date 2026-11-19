/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_LOCALE?: string;
  readonly VITE_STALENESS_HOURS?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
