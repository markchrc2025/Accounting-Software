import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations use the DIRECT (non-pooled) connection.
    url: process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? "",
  },
  // Hand-written trigger/constraint SQL lives in migrations/*.sql and is applied
  // alongside generated migrations; do not let drizzle-kit drop it.
  verbose: true,
  strict: true,
});
