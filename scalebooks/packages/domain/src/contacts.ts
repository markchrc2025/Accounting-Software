/**
 * Contacts: vendors, customers, and employees referenced by vouchers and
 * journal lines. Validation shared by the API and the web apps.
 *
 * Two type vocabularies coexist:
 *   • `type`  — the canonical enum (vendor|customer|employee) that vouchers and
 *     filters key on.
 *   • `types` — the portal's richer multi-select labels. When supplied, the
 *     canonical `type` is derived from them (Customer→customer, Employee→
 *     employee, everything else→vendor) so both views stay consistent.
 */
import { z } from "zod";

export const CONTACT_TYPES = ["vendor", "customer", "employee"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const RICH_CONTACT_TYPES = [
  "Customer",
  "Supplier",
  "Employee",
  "Contractor",
  "Government",
  "Other",
] as const;
export type RichContactType = (typeof RICH_CONTACT_TYPES)[number];

/** Canonical enum for a set of portal labels (priority: customer > employee > vendor). */
export function canonicalContactType(types: readonly string[]): ContactType {
  if (types.includes("Customer")) return "customer";
  if (types.includes("Employee")) return "employee";
  return "vendor";
}

const optionalTrimmed = (max: number) => z.string().trim().max(max).optional();
const nullableTrimmed = (max: number) => z.string().trim().max(max).nullable().optional();

export const zContactAddress = z.object({
  street: z.string().trim().max(300).default(""),
  city: z.string().trim().max(120).default(""),
  zip: z.string().trim().max(20).default(""),
  country: z.string().trim().max(80).default(""),
});

export const zContactBank = z.object({
  bankCode: z.string().trim().max(40).default(""),
  branch: z.string().trim().max(120).default(""),
  accountNumber: z.string().trim().max(60).default(""),
  accountName: z.string().trim().max(160).default(""),
  swift: z.string().trim().max(20).default(""),
  isDefault: z.boolean().default(false),
});

export const zContactPerson = z.object({
  salutation: z.string().trim().max(20).default(""),
  firstName: z.string().trim().max(80).default(""),
  lastName: z.string().trim().max(80).default(""),
  email: z.string().trim().max(160).default(""),
  workPhone: z.string().trim().max(40).default(""),
  mobile: z.string().trim().max(40).default(""),
  role: z.string().trim().max(80).default(""),
});

const richFields = {
  types: z.array(z.enum(RICH_CONTACT_TYPES)).max(6).optional(),
  displayName: optionalTrimmed(160),
  parentId: z.string().uuid().nullable().optional(),
  costCenter: optionalTrimmed(40),
  category: optionalTrimmed(80),
  branch: optionalTrimmed(120),
  department: optionalTrimmed(120),
  arAccountCode: optionalTrimmed(40),
  apAccountCode: optionalTrimmed(40),
  paymentTerms: optionalTrimmed(40),
  currency: optionalTrimmed(8),
  creditLimitCents: z.number().int().nonnegative().optional(),
  openingBalanceCents: z.number().int().optional(),
  taxRef: nullableTrimmed(80),
  mobile: optionalTrimmed(40),
  website: optionalTrimmed(200),
  billingAddress: zContactAddress.nullable().optional(),
  shippingAddress: zContactAddress.nullable().optional(),
  banks: z.array(zContactBank).max(20).optional(),
  contactPersons: z.array(zContactPerson).max(50).optional(),
  notes: optionalTrimmed(2000),
  internalRemarks: optionalTrimmed(2000),
  needsCompletion: z.boolean().optional(),
};

export const zContactInput = z
  .object({
    // Either the canonical enum or the rich labels must identify the contact.
    type: z.enum(CONTACT_TYPES).optional(),
    name: z.string().trim().min(1, "Name is required").max(160),
    tin: optionalTrimmed(40),
    email: z.union([z.string().trim().email().max(160), z.literal("")]).optional(),
    phone: optionalTrimmed(40),
    address: optionalTrimmed(300),
    isActive: z.boolean().default(true),
    ...richFields,
  })
  .refine((v) => v.type || (v.types && v.types.length > 0), {
    message: "type (or types) is required",
    path: ["type"],
  });

export type ContactInput = z.infer<typeof zContactInput>;

/** Partial update: any omitted field is left unchanged. */
export const zContactUpdate = z.object({
  type: z.enum(CONTACT_TYPES).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  tin: nullableTrimmed(40),
  email: z.union([z.string().trim().email().max(160), z.literal("")]).nullable().optional(),
  phone: nullableTrimmed(40),
  address: nullableTrimmed(300),
  isActive: z.boolean().optional(),
  ...richFields,
});

export type ContactUpdate = z.infer<typeof zContactUpdate>;
