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
  profile: z.record(z.unknown()).nullable().optional(),
});
export type InviteUser = z.infer<typeof zInviteUser>;

/** Admin edit of an existing user (email is immutable — it is the allowlist key). */
export const zUserUpdate = z.object({
  fullName: z.string().trim().max(160).nullable().optional(),
  role: z.enum(USER_ROLES).optional(),
  profile: z.record(z.unknown()).nullable().optional(),
});
export type UserUpdate = z.infer<typeof zUserUpdate>;
