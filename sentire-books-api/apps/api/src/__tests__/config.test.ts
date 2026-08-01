/**
 * Unit tests for the fail-closed environment switches (M0.1).
 *
 * The regression these lock down: the workspace-reset guard used to disable
 * only on the literal string "false", so an unset variable left a full
 * production wipe reachable. Reset must now be OFF for every value except an
 * exact "true".
 */
import { describe, it, expect } from "vitest";
import {
  isWorkspaceResetEnabled,
  isProduction,
  workspaceResetBootNotice,
  authConfigErrors,
  authConfigWarnings,
} from "../config";

const PROD = { NODE_ENV: "production" } as const;
const SECRET = "a-real-signing-secret";

describe("isWorkspaceResetEnabled — fail-closed", () => {
  it("is enabled ONLY for an exact 'true'", () => {
    expect(isWorkspaceResetEnabled({ ALLOW_WORKSPACE_RESET: "true" })).toBe(true);
  });

  it.each([
    ["unset", undefined],
    ["empty string", ""],
    ["blank", "   "],
    ["the old disable token", "false"],
    ["uppercase TRUE", "TRUE"],
    ["mixed-case True", "True"],
    ["padded ' true '", " true "],
    ["numeric 1", "1"],
    ["yes", "yes"],
    ["on", "on"],
    ["typo'd tru", "tru"],
  ])("is disabled when %s", (_label, value) => {
    expect(isWorkspaceResetEnabled({ ALLOW_WORKSPACE_RESET: value })).toBe(false);
  });

  it("defaults to disabled on a completely empty environment", () => {
    expect(isWorkspaceResetEnabled({})).toBe(false);
  });
});

describe("isProduction", () => {
  it("is true only for NODE_ENV=production", () => {
    expect(isProduction({ NODE_ENV: "production" })).toBe(true);
    expect(isProduction({ NODE_ENV: "development" })).toBe(false);
    expect(isProduction({})).toBe(false);
  });
});

describe("workspaceResetBootNotice", () => {
  it("says DISABLED when off", () => {
    expect(workspaceResetBootNotice({})).toContain("DISABLED");
  });

  it("shouts when reset is enabled in production", () => {
    const msg = workspaceResetBootNotice({
      ALLOW_WORKSPACE_RESET: "true",
      NODE_ENV: "production",
    });
    expect(msg).toContain("ENABLED IN PRODUCTION");
  });

  it("notes it plainly when enabled outside production", () => {
    const msg = workspaceResetBootNotice({
      ALLOW_WORKSPACE_RESET: "true",
    });
    expect(msg).toContain("ENABLED");
    expect(msg).not.toContain("PRODUCTION");
  });
});

/* ── M0.2: production must refuse to boot with a weakened auth path ───────── */

describe("authConfigErrors — production boot assertion", () => {
  it("passes a correctly configured production environment", () => {
    expect(authConfigErrors({ ...PROD, AUTH_JWT_SECRET: SECRET })).toEqual([]);
  });

  it("passes when the bypass flag is explicitly off in production", () => {
    expect(
      authConfigErrors({ ...PROD, AUTH_JWT_SECRET: SECRET, AUTH_DEV_BYPASS: "false" }),
    ).toEqual([]);
  });

  it("is fatal in production when AUTH_JWT_SECRET is missing", () => {
    const errors = authConfigErrors(PROD);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("AUTH_JWT_SECRET");
  });

  it("is fatal in production when the dev bypass is enabled — even WITH a secret", () => {
    const errors = authConfigErrors({ ...PROD, AUTH_JWT_SECRET: SECRET, AUTH_DEV_BYPASS: "true" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("AUTH_DEV_BYPASS");
  });

  it("reports BOTH problems for the fully bypassable combination", () => {
    // No secret + bypass on = any x-user-id header authenticates. The worst case.
    const errors = authConfigErrors({ ...PROD, AUTH_DEV_BYPASS: "true" });
    expect(errors).toHaveLength(2);
    expect(errors.join(" ")).toContain("AUTH_JWT_SECRET");
    expect(errors.join(" ")).toContain("AUTH_DEV_BYPASS");
  });

  it("never blocks a non-production boot", () => {
    expect(authConfigErrors({ AUTH_DEV_BYPASS: "true" })).toEqual([]);
    expect(authConfigErrors({ NODE_ENV: "development", AUTH_DEV_BYPASS: "true" })).toEqual([]);
    expect(authConfigErrors({})).toEqual([]);
  });
});

describe("authConfigWarnings", () => {
  it("warns that AUTH_JWKS_URL is read nowhere", () => {
    const w = authConfigWarnings({ ...PROD, AUTH_JWT_SECRET: SECRET, AUTH_JWKS_URL: "https://x/jwks" });
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("IGNORED");
  });

  it("names both stale variables when both are set", () => {
    const w = authConfigWarnings({ AUTH_JWKS_URL: "https://x/jwks", AUTH_ISSUER: "https://x" });
    expect(w[0]).toContain("AUTH_JWKS_URL");
    expect(w[0]).toContain("AUTH_ISSUER");
  });

  it("flags an active dev bypass outside production", () => {
    const w = authConfigWarnings({ AUTH_DEV_BYPASS: "true" });
    expect(w.join(" ")).toContain("DEV BYPASS");
  });

  it("stays quiet when the bypass flag is set but a secret makes it unreachable", () => {
    expect(authConfigWarnings({ AUTH_DEV_BYPASS: "true", AUTH_JWT_SECRET: SECRET })).toEqual([]);
  });

  it("stays quiet on a clean environment", () => {
    expect(authConfigWarnings({ AUTH_JWT_SECRET: SECRET })).toEqual([]);
  });
});
