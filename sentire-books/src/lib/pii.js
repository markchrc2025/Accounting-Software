/**
 * Personal-data scrubbing for outbound error reports (M1 closeout / A2).
 *
 * Mirror of sentire-books-api/apps/api/src/pii.ts. The portal is a separate npm
 * project and cannot import the pnpm workspace, so this is a deliberate copy —
 * keep the two in step; a shared test asserts the same cases on both sides.
 *
 * Sentry is a **DPA sub-processor**. Under the Philippine Data Privacy Act we
 * are the processor of our tenants' data, and their clients' personal
 * information must not leave the application boundary just because something
 * threw. Secrets scrubbing (logger.ts) is a different concern — this module is
 * about PERSONAL data: names, emails, TINs, phones, addresses.
 *
 * The data at risk is real: `contacts` carries name, tin, email, phone,
 * address and display_name; `app_users` carries email and full_name; checks
 * carry payee_name. Any of those can land in an error message, a request body,
 * or — most easily missed — a Sentry BREADCRUMB, which by default captures
 * console output and every fetch/XHR URL.
 *
 * Approach, in order of reliability:
 *   1. Drop whole payloads that are structurally unsafe (request bodies,
 *      console breadcrumbs, query strings). You cannot regex your way to
 *      safety over arbitrary tenant data.
 *   2. Blank values by KEY for anything named like personal data.
 *   3. Regex free text for the patterns that are recognisable (email, TIN).
 *
 * Names are deliberately NOT regexed — no pattern distinguishes a person's
 * name from ordinary prose. They are handled by (1) and (2) instead.
 */

/** RFC-ish, deliberately greedy — over-matching an email is the safe direction. */
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** Philippine TIN: 123-456-789 or 123-456-789-000 (branch code). */
const TIN_DASHED = /\b\d{3}-\d{3}-\d{3}(?:-\d{3,5})?\b/g;

/** Bare 12-digit TIN (9 + 3 branch), written without separators. */
const TIN_BARE_12 = /\b\d{12}\b/g;

/** `tin: 123456789`, `TIN=123-456-789` — a labelled value, however formatted. */
const TIN_LABELLED = /\b(tin)\s*[:=]\s*["']?[\d-]{9,17}["']?/gi;

/** PH mobile / landline shapes: +639171234567, 09171234567, (02) 8123-4567. */
const PHONE = /(?:\+63|\b0)9\d{9}\b|\(\d{2,4}\)\s*\d{3,4}-?\d{4}\b/g;

/** Object keys whose VALUE is personal data regardless of its shape. */
const PII_KEYS = new Set([
  "email",
  "emails",
  "useremail",
  "contactemail",
  "name",
  "fullname",
  "full_name",
  "displayname",
  "display_name",
  "contactname",
  "contact_name",
  "payeename",
  "payee_name",
  "firstname",
  "lastname",
  "tin",
  "tinnumber",
  "tin_number",
  "phone",
  "mobile",
  "telephone",
  "contactnumber",
  "address",
  "billingaddress",
  "billing_address",
  "shippingaddress",
  "contactpersons",
  "contact_persons",
]);

/** Mask the personal-data patterns that are reliably recognisable in text. */
export function scrubPii(value) {
  return value
    .replace(TIN_LABELLED, "tin=[REDACTED_TIN]")
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(TIN_DASHED, "[REDACTED_TIN]")
    // Phones BEFORE the bare 12-digit TIN rule: +639171234567 is twelve digits,
    // so the TIN rule would otherwise claim it and mislabel a phone number.
    // (Either way it is redacted — but the label should be right.)
    .replace(PHONE, "[REDACTED_PHONE]")
    .replace(TIN_BARE_12, "[REDACTED_TIN]");
}

const MAX_DEPTH = 6;

/**
 * Walk a structure, blanking PII-keyed values and scrubbing free text.
 * Depth-limited so a cyclic or pathological payload cannot hang the reporter.
 */
export function scrubDeep(input, depth = 0) {
  if (depth > MAX_DEPTH) return "[TRUNCATED]";
  if (typeof input === "string") return scrubPii(input);
  if (Array.isArray(input)) return input.map((v) => scrubDeep(v, depth + 1));
  if (input && typeof input === "object") {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = PII_KEYS.has(k.toLowerCase().replace(/[^a-z_]/g, "")) ? "[REDACTED_PII]" : scrubDeep(v, depth + 1);
    }
    return out;
  }
  return input;
}


/** Strip a URL's query string — it routinely carries emails and ids. */
export function stripQuery(url) {
  const cut = url.indexOf("?");
  return cut === -1 ? scrubPii(url) : `${scrubPii(url.slice(0, cut))}?[REDACTED]`;
}

/**
 * Scrub one breadcrumb, or drop it entirely when it cannot be made safe.
 * Returns null to drop.
 *
 * Console breadcrumbs are dropped outright: they capture whatever was logged,
 * which in a bookkeeping app is arbitrary tenant data.
 */
export function scrubBreadcrumb(bc) {
  if (!bc) return null;
  if (bc.category === "console") return null;

  const out = { ...bc };
  if (out.message) out.message = scrubPii(out.message);
  if (out.data) {
    const data = { ...out.data };
    // fetch/xhr breadcrumbs carry the URL, and sometimes the body.
    if (typeof data.url === "string") data.url = stripQuery(data.url);
    delete data.body;
    delete data.input;
    delete data.response;
    out.data = scrubDeep(data);
  }
  return out;
}

/**
 * Scrub a whole outbound event. Applied in `beforeSend`, after the secret
 * scrubber, as the last thing before it leaves the process.
 */
export function scrubEventPii(event) {
  if (event.message) event.message = scrubPii(event.message);

  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubPii(ex.value);
  }

  if (event.request) {
    // A request body in a bookkeeping app is tenant financial + personal data.
    // There is no version of this we want in a third-party service.
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.cookie;
      event.request.headers = scrubDeep(event.request.headers);
    }
    if (event.request.url) event.request.url = stripQuery(event.request.url);
  }

  // Keep the opaque user id (that is the point of it); drop everything that
  // identifies a human directly.
  if (event.user) {
    delete event.user.email;
    delete event.user.username;
    delete event.user.ip_address;
  }

  if (event.extra) event.extra = scrubDeep(event.extra);
  if (event.contexts) event.contexts = scrubDeep(event.contexts);
  if (event.tags) event.tags = scrubDeep(event.tags);

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .map((b) => scrubBreadcrumb(b))
      .filter((b) => b !== null);
  }

  return event;
}
