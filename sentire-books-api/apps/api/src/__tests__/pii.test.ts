/**
 * PII scrubbing for outbound error reports (M1 closeout / A2).
 *
 * Sentry is a DPA sub-processor. These tests assert that a realistic event —
 * one carrying a client's email, TIN, name, phone and a full request body —
 * leaves nothing personally identifying behind.
 */
import { describe, it, expect } from "vitest";
import {
  scrubPii,
  scrubDeep,
  scrubBreadcrumb,
  scrubEventPii,
  stripQuery,
  type ScrubbableEvent,
} from "../pii";

describe("scrubPii — free text", () => {
  it("redacts an email address", () => {
    const out = scrubPii("failed to invoice maria.santos@acmetrading.ph for August");
    expect(out).not.toContain("maria.santos@acmetrading.ph");
    expect(out).toContain("[REDACTED_EMAIL]");
  });

  it("redacts a dashed Philippine TIN, with and without a branch code", () => {
    expect(scrubPii("TIN 123-456-789")).toContain("[REDACTED_TIN]");
    expect(scrubPii("TIN 123-456-789-000")).toContain("[REDACTED_TIN]");
    expect(scrubPii("TIN 123-456-789")).not.toContain("123-456-789");
  });

  it("redacts a bare 12-digit TIN", () => {
    const out = scrubPii("tin on file: 123456789000");
    expect(out).not.toContain("123456789000");
    expect(out).toContain("[REDACTED_TIN]");
  });

  it("redacts a labelled TIN however it is formatted", () => {
    expect(scrubPii("tin=123456789")).not.toContain("123456789");
    expect(scrubPii("TIN: 123-456-789")).not.toContain("123-456-789");
  });

  it("redacts PH mobile and landline numbers", () => {
    expect(scrubPii("call +639171234567")).toContain("[REDACTED_PHONE]");
    expect(scrubPii("call 09171234567")).toContain("[REDACTED_PHONE]");
    expect(scrubPii("call (02) 8123-4567")).toContain("[REDACTED_PHONE]");
  });

  it("leaves ordinary accounting prose intact", () => {
    const msg = "voucher PV202608-0001 is out of balance by 5 centavos";
    expect(scrubPii(msg)).toBe(msg);
  });
});

describe("scrubDeep — structured data", () => {
  it("blanks values by key, whatever their shape", () => {
    const out = scrubDeep({
      contactName: "Maria Santos",
      tin: "123-456-789-000",
      email: "maria@acme.ph",
      phone: "09171234567",
      address: "12 Ayala Ave, Makati",
      amountCents: 150000,
      voucherNo: "PV202608-0001",
    }) as Record<string, unknown>;

    expect(out.contactName).toBe("[REDACTED_PII]");
    expect(out.tin).toBe("[REDACTED_PII]");
    expect(out.email).toBe("[REDACTED_PII]");
    expect(out.phone).toBe("[REDACTED_PII]");
    expect(out.address).toBe("[REDACTED_PII]");
    // Non-personal fields are the diagnostic value — they must survive.
    expect(out.amountCents).toBe(150000);
    expect(out.voucherNo).toBe("PV202608-0001");
  });

  it("recurses into nested structures", () => {
    const out = JSON.stringify(
      scrubDeep({ invoice: { client: { name: "Jose Rizal", tin: "111-222-333" } } }),
    );
    expect(out).not.toContain("Jose Rizal");
    expect(out).not.toContain("111-222-333");
  });

  it("scrubs PII inside array elements", () => {
    const out = JSON.stringify(scrubDeep([{ email: "a@b.ph" }, "contact ana@acme.ph"]));
    expect(out).not.toContain("a@b.ph");
    expect(out).not.toContain("ana@acme.ph");
  });

  it("is depth-limited so a pathological payload cannot hang the reporter", () => {
    let deep: Record<string, unknown> = { email: "x@y.ph" };
    for (let i = 0; i < 40; i++) deep = { nested: deep };
    expect(() => JSON.stringify(scrubDeep(deep))).not.toThrow();
    expect(JSON.stringify(scrubDeep(deep))).toContain("[TRUNCATED]");
  });
});

describe("scrubBreadcrumb", () => {
  it("DROPS console breadcrumbs entirely — they capture arbitrary tenant data", () => {
    expect(scrubBreadcrumb({ category: "console", message: "client ana@acme.ph owes 5000" })).toBeNull();
  });

  it("strips the query string from a fetch URL", () => {
    const out = scrubBreadcrumb({
      category: "fetch",
      data: { url: "https://api/contacts?email=ana@acme.ph&tin=123-456-789" },
    });
    const s = JSON.stringify(out);
    expect(s).not.toContain("ana@acme.ph");
    expect(s).not.toContain("123-456-789");
    expect(s).toContain("[REDACTED]");
  });

  it("drops request/response bodies from network breadcrumbs", () => {
    const out = scrubBreadcrumb({
      category: "xhr",
      data: { url: "https://api/invoices", body: '{"clientName":"Maria Santos"}', response: "{...}" },
    });
    expect(JSON.stringify(out)).not.toContain("Maria Santos");
    expect(out?.data?.body).toBeUndefined();
    expect(out?.data?.response).toBeUndefined();
  });

  it("scrubs a navigation breadcrumb's message", () => {
    const out = scrubBreadcrumb({ category: "navigation", message: "to /contacts/ana@acme.ph" });
    expect(out?.message).not.toContain("ana@acme.ph");
  });
});

describe("stripQuery", () => {
  it("keeps the path and removes the query", () => {
    expect(stripQuery("https://api/x?tin=123-456-789")).toBe("https://api/x?[REDACTED]");
  });
  it("leaves a query-less URL alone", () => {
    expect(stripQuery("https://api/x")).toBe("https://api/x");
  });
});

/* ── The headline case the DPA boundary depends on ────────────────────────── */

describe("scrubEventPii — a realistic event carrying an email and a TIN", () => {
  const build = (): ScrubbableEvent => ({
    message: "Failed to post invoice for maria.santos@acmetrading.ph (TIN 123-456-789-000)",
    exception: {
      values: [{ value: "ValidationError: contact ana.cruz@client.ph has TIN 987-654-321" }],
    },
    request: {
      url: "https://api.sentire.solutions/service-invoices?clientEmail=maria.santos@acmetrading.ph",
      data: { clientName: "Maria Santos", tin: "123-456-789-000", amountCents: 5000000 },
      headers: { authorization: "Bearer secret-token", "x-org-id": "org-1" },
      cookies: { session: "abc" },
      query_string: "clientEmail=maria.santos@acmetrading.ph",
    },
    user: { id: "user-uuid-1", email: "admin@tenant.ph", username: "admin", ip_address: "203.0.113.9" },
    extra: { contactName: "Jose Rizal", note: "phone 09171234567", voucherNo: "PV202608-0001" },
    contexts: { invoice: { payeeName: "Maria Santos", totalCents: 5000000 } },
    tags: { org_id: "org-1", email: "admin@tenant.ph" },
    breadcrumbs: [
      { category: "console", message: "logging maria.santos@acmetrading.ph" },
      { category: "fetch", data: { url: "https://api/contacts?tin=123-456-789", body: '{"tin":"123-456-789"}' } },
    ],
  });

  it("removes every trace of the email, TIN, name and phone", () => {
    const serialized = JSON.stringify(scrubEventPii(build()));

    for (const pii of [
      "maria.santos@acmetrading.ph",
      "ana.cruz@client.ph",
      "admin@tenant.ph",
      "123-456-789-000",
      "123-456-789",
      "987-654-321",
      "Maria Santos",
      "Jose Rizal",
      "09171234567",
      "203.0.113.9",
    ]) {
      expect(serialized, `leaked: ${pii}`).not.toContain(pii);
    }
  });

  it("keeps what makes the error diagnosable", () => {
    const out = scrubEventPii(build());
    const serialized = JSON.stringify(out);
    expect(serialized).toContain("ValidationError");
    expect(serialized).toContain("org-1");
    expect(serialized).toContain("PV202608-0001");
    expect(serialized).toContain("5000000");
    expect(out.user?.id).toBe("user-uuid-1"); // opaque id survives — that is the point
  });

  it("drops the request body, cookies and query string outright", () => {
    const out = scrubEventPii(build());
    expect(out.request?.data).toBeUndefined();
    expect(out.request?.cookies).toBeUndefined();
    expect(out.request?.query_string).toBeUndefined();
    expect(out.request?.url).toContain("[REDACTED]");
  });

  it("drops identifying user fields but keeps the opaque id", () => {
    const out = scrubEventPii(build());
    expect(out.user?.email).toBeUndefined();
    expect(out.user?.username).toBeUndefined();
    expect(out.user?.ip_address).toBeUndefined();
    expect(out.user?.id).toBe("user-uuid-1");
  });

  it("drops the console breadcrumb and keeps a scrubbed fetch one", () => {
    const out = scrubEventPii(build());
    expect(out.breadcrumbs).toHaveLength(1);
    expect(out.breadcrumbs![0]!.category).toBe("fetch");
    expect(JSON.stringify(out.breadcrumbs)).not.toContain("123-456-789");
  });
});
