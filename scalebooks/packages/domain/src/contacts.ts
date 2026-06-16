/**
 * Contacts: vendors, customers, and employees referenced by vouchers and
 * journal lines. Validation shared by the API and the web app.
 */
import { z } from "zod";

export const CONTACT_TYPES = ["vendor", "customer", "employee"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

const optionalTrimmed = (max: number) => z.string().trim().max(max).optional();

export const zContactInput = z.object({
  type: z.enum(CONTACT_TYPES),
  name: z.string().trim().min(1, "Name is required").max(160),
  tin: optionalTrimmed(40),
  email: z.union([z.string().trim().email().max(160), z.literal("")]).optional(),
  phone: optionalTrimmed(40),
  address: optionalTrimmed(300),
  isActive: z.boolean().default(true),
});

export type ContactInput = z.infer<typeof zContactInput>;
