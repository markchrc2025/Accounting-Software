import { z } from "zod";

/** Roles a user can hold in an organization (mirrors the DB user_role enum). */
export const USER_ROLES = ["maker", "verifier", "approver", "poster", "admin"] as const;
export type UserRoleName = (typeof USER_ROLES)[number];

/**
 * Invite a user onto the workspace allowlist. Authenticize authenticates them;
 * Sentire admits them iff their verified email matches a row like this. Email is
 * normalized to lowercase (the allowlist key is case-insensitive).
 */
export const zInviteUser = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required").max(160),
  fullName: z.string().trim().max(160).optional(),
  role: z.enum(USER_ROLES).default("maker"),
});
export type InviteUser = z.infer<typeof zInviteUser>;
