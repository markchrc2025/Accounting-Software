import { describe, it, expect } from "vitest";
import { zContactInput, CONTACT_TYPES } from "./contacts";

describe("contacts", () => {
  it("accepts a minimal valid contact", () => {
    expect(zContactInput.safeParse({ type: "vendor", name: "Acme Corp" }).success).toBe(true);
  });

  it("requires a name and a valid type", () => {
    expect(zContactInput.safeParse({ type: "vendor", name: "" }).success).toBe(false);
    expect(zContactInput.safeParse({ type: "alien", name: "X" }).success).toBe(false);
  });

  it("rejects a malformed email but allows blank", () => {
    expect(
      zContactInput.safeParse({ type: "customer", name: "X", email: "not-an-email" }).success,
    ).toBe(false);
    expect(zContactInput.safeParse({ type: "customer", name: "X", email: "" }).success).toBe(true);
    expect(
      zContactInput.safeParse({ type: "customer", name: "X", email: "a@b.com" }).success,
    ).toBe(true);
  });

  it("exposes the three contact types", () => {
    expect(CONTACT_TYPES).toEqual(["vendor", "customer", "employee"]);
  });
});
