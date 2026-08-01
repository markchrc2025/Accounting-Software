/**
 * Portal error tracking (M1.3).
 *
 * Optional: with no `VITE_SENTRY_DSN` set, every function here is a no-op, so
 * local development and CI run unchanged and no network calls are made.
 *
 * Deliberately conservative about what leaves the browser — this is a
 * bookkeeping portal, so request bodies and headers can carry client financial
 * data and bearer tokens. We send the error and the route, not the payload.
 */
import * as Sentry from '@sentry/react';
import { scrubEventPii, scrubBreadcrumb } from './pii.js';

let enabled = false;

/** Mask anything secret-shaped that ends up in a message or stack. */
export function scrubSecrets(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/\b(postgres(?:ql)?:\/\/)[^\s"']*/gi, '$1[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '[REDACTED_JWT]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]');
}

export function initErrorTracking() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    // No session replay or performance tracing: both capture far more of a
    // bookkeeping screen than we want leaving the browser.
    tracesSampleRate: 0,
    // Never let the SDK attach IPs, cookies or bodies of its own accord.
    sendDefaultPii: false,
    // Two passes: secrets, then personal data. Sentry is a DPA sub-processor,
    // so tenant PII must not reach it.
    beforeSend(event) {
      if (event.message) event.message = scrubSecrets(event.message);
      for (const ex of event.exception?.values ?? []) {
        if (ex.value) ex.value = scrubSecrets(ex.value);
      }
      // The token lives in sessionStorage; never ship request headers/cookies.
      if (event.request) {
        delete event.request.headers;
        delete event.request.cookies;
        delete event.request.data;
      }
      return scrubEventPii(event);
    },
    // Breadcrumbs are the easiest leak to miss: console output and every fetch
    // URL are captured by default, and in this app both carry tenant data.
    beforeBreadcrumb(breadcrumb) {
      return scrubBreadcrumb(breadcrumb);
    },
  });
  enabled = true;
}

/** Attach the signed-in workspace/user so an error is traceable to a tenant. */
export function setErrorContext({ orgId, orgCode, userId, role } = {}) {
  if (!enabled) return;
  Sentry.setTag('org_id', orgId ?? 'none');
  if (orgCode) Sentry.setTag('org_code', orgCode);
  if (role) Sentry.setTag('role', role);
  Sentry.setUser(userId ? { id: userId } : null);
}

/** Report a handled error with context. */
export function reportError(error, context = {}) {
  if (!enabled) {
    // Still surface it locally — silence during development is worse.
    console.error('[error]', error, context);
    return;
  }
  Sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(context)) scope.setTag(k, String(v));
    scope.setTag('route', window.location?.pathname ?? 'unknown');
    Sentry.captureException(error);
  });
}

export function errorTrackingEnabled() {
  return enabled;
}
