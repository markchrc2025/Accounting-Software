import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL ?? "";
if (!connectionString) {
  // Don't throw at import time — that would break test collection. Queries will
  // fail clearly once attempted if the URL is genuinely missing.
  console.warn("[db] DATABASE_URL not set — queries will fail until it is configured.");
}

// Single shared pool for the app (use the pooled connection string here).
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
export { schema };
export type Db = typeof db;
export * from "./schema";
export * from "./context";
export * from "./demo";
