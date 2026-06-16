import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { journalRoutes } from "./routes/journal";
import { accountRoutes } from "./routes/accounts";
import { reportRoutes } from "./routes/reports";
import { contactRoutes } from "./routes/contacts";
import { voucherRoutes } from "./routes/vouchers";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, service: "scalebooks-api" }));

app.route("/accounts", accountRoutes);
app.route("/journal-entries", journalRoutes);
app.route("/reports", reportRoutes);
app.route("/contacts", contactRoutes);
app.route("/vouchers", voucherRoutes);

// Render (and most PaaS) inject PORT; fall back to API_PORT for local dev.
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.log(`scalebooks-api listening on :${port}`);

export type AppType = typeof app;
