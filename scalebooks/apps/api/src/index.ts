import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { journalRoutes } from "./routes/journal";
import { accountRoutes } from "./routes/accounts";
import { reportRoutes } from "./routes/reports";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, service: "scalebooks-api" }));

app.route("/accounts", accountRoutes);
app.route("/journal-entries", journalRoutes);
app.route("/reports", reportRoutes);

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`scalebooks-api listening on http://localhost:${port}`);

export type AppType = typeof app;
