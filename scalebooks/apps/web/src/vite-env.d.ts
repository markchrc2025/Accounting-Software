/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DEV_USER_ID?: string;
  // Authenticize (Better Auth / OIDC) base URL, e.g. https://auth.example.com
  readonly VITE_AUTH_URL?: string;
  // Optional demo-credentials affordance on the login screen.
  readonly VITE_DEMO_EMAIL?: string;
  readonly VITE_DEMO_PASSWORD?: string;
  readonly VITE_DEMO_COMPANY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
