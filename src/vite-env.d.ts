/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_UPDATER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
