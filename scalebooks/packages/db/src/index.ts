import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — see .env.example");
}

// Single shared pool for the app (use the pooled connection string here).
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
export { schema };
export type Db = typeof db;
export * from "./schema";
