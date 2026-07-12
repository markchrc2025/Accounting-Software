/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Base URL of the Sentire Books API.
  readonly VITE_API_BASE_URL?: string;
  // Local dev only: bypass auth by sending this as x-user-id (pairs with the
  // API's AUTH_DEV_BYPASS). When set, the login screen is skipped.
  readonly VITE_DEV_USER_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
