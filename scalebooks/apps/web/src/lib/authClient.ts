import { createAuthClient } from "better-auth/react";

const authUrl = import.meta.env.VITE_AUTH_URL as string | undefined;

/**
 * Better Auth client pointed at Authenticize (our OIDC / identity provider).
 * Created only when VITE_AUTH_URL is set; otherwise the app runs in the local
 * dev-bypass mode (no login screen, x-user-id header).
 *
 * Requests are cross-origin, so cookies must be included — which means the app
 * and Authenticize have to share a registrable root domain (e.g.
 * books.example.com + auth.example.com) for the session cookie to flow.
 */
export const authClient = authUrl
  ? createAuthClient({
      baseURL: authUrl,
      fetchOptions: { credentials: "include" },
    })
  : null;

export const authEnabled = authClient !== null;
export const AUTH_URL = authUrl ?? "";
