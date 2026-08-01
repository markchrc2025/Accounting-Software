/**
 * Unit tests for the fail-closed environment switches (M0.1).
 *
 * The regression these lock down: the workspace-reset guard used to disable
 * only on the literal string "false", so an unset variable left a full
 * production wipe reachable. Reset must now be OFF for every value except an
 * exact "true".
 */
import { describe, it, expect } from "vitest";
import { isWorkspaceResetEnabled, isProduction, workspaceResetBootNotice } from "../config";

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
