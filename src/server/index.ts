import express from "express";
import path from "node:path";

import { BossAdapter } from "./automation/boss-adapter";
import { initDb } from "./db";
import { createScheduler } from "./scheduler";
import { createBrowserRouter } from "./routes/browser";
import { createCandidatesRouter } from "./routes/candidates";
import { createDiagnosticsRouter } from "./routes/diagnostics";
import { createEventsRouter } from "./routes/events";
import { createExtensionRouter } from "./routes/extension";
import { createFilterRouter } from "./routes/filter";
import { createJobsRouter } from "./routes/jobs";
import { createLogsRouter } from "./routes/logs";
import { createScheduleRouter } from "./routes/schedule";
import { createSendRouter } from "./routes/send";
import { createStateRouter } from "./routes/state";
import { createTemplatesRouter } from "./routes/templates";
import { SendService } from "./services/send-service";

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const isProduction = process.env.NODE_ENV === "production";

const db = initDb();
const adapter = new BossAdapter();
const sendService = new SendService(db, adapter);
const scheduler = createScheduler({ db, adapter, sendService });

app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || origin.startsWith("chrome-extension://") || origin === "http://localhost:3000") {
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  }

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

app.use("/api/state", createStateRouter({ db }));
app.use("/api/candidates", createCandidatesRouter({ db }));
app.use("/api/jobs", createJobsRouter({ db }));
app.use("/api/templates", createTemplatesRouter({ db }));
app.use("/api/filter", createFilterRouter({ db, adapter }));
app.use("/api/send", createSendRouter({ sendService }));
app.use("/api/logs", createLogsRouter({ db }));
app.use("/api/schedule", createScheduleRouter({ db }));
app.use("/api/events", createEventsRouter());
app.use("/api/browser", createBrowserRouter({ adapter }));
app.use("/api/diagnostics", createDiagnosticsRouter());
app.use("/api/extension", createExtensionRouter({ db }));
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "recruitment-assistant" });
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  res.status(500).json({ ok: false, error: message });
});

if (isProduction) {
  app.use(express.static(path.resolve("dist")));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.resolve("dist/index.html"));
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa"
  });
  app.use(vite.middlewares);
}

const server = app.listen(port, host, () => {
  console.log(`Local recruitment tool running at http://${host}:${port}`);
});

function shutdown() {
  scheduler.stop();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);