/// <reference types="vite/client" />

declare module '*.css';

interface Window {
  qdnRequest?: <T = unknown>(request: Record<string, unknown>) => Promise<T>;
  _qdnBase?: string;
  _qdnService?: string;
  _qdnName?: string;
  _qdnIdentifier?: string;
}

interface ImportMetaEnv {
  readonly VITE_QORTIUM_QDN_SERVICE?: string;
  readonly VITE_QORTIUM_QDN_IMAGE_SERVICE?: string;
  readonly VITE_QORTIUM_QDN_IDENTIFIER?: string;
  readonly VITE_QAPP_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
