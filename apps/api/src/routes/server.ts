import fs from "node:fs";
import { STARTED_AT, VERSION, dbPath, env } from "../env.ts";
import { readSchedule, validTimes, writeSchedule } from "../scheduler.ts";
import type { Api, RouteContext } from "./context.ts";

/* ---- Server administration (admins only; `requireAdmin` is applied in createApp) ---- */

export function registerServerRoutes(app: Api, { db, scheduler, requestLimit }: RouteContext) {
  app.get("/api/server/info", (c) => {
    let dbBytes = 0;
    try {
      dbBytes = fs.statSync(dbPath()).size;
    } catch {
      /* in-memory or missing */
    }
    return c.json({
      version: VERSION,
      node: process.version,
      startedAt: STARTED_AT,
      bind: `${env.host}:${env.port}`,
      dataDir: env.dataDir,
      database: { path: dbPath(), bytes: dbBytes },
      ai: { provider: env.ai.provider, url: env.ai.url, model: env.ai.model },
      container: env.allowNonLocalBind,
      users: db.countUsers(),
    });
  });

  /* ---- Scheduled sync ---- */

  app.get("/api/server/sync-schedule", (c) =>
    c.json({
      ...(scheduler
        ? scheduler.status()
        : {
            config: readSchedule(db),
            running: false,
            nextRunAt: null,
            lastRun: null,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
      requestLimit: requestLimit(),
      providerCeiling: 24,
    }),
  );

  app.put("/api/server/sync-schedule", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      enabled?: boolean;
      times?: unknown;
      requestLimit?: unknown;
    };
    const current = readSchedule(db);
    const times = body.times === undefined ? current.times : validTimes(body.times);
    if (!times) return c.json({ error: "Times must be 1 to 6 entries like 05:00." }, 400);
    if (body.requestLimit !== undefined) {
      const n = Number(body.requestLimit);
      if (!Number.isInteger(n) || n < 1 || n > 24)
        return c.json({ error: "Request limit must be a whole number from 1 to 24." }, 400);
      db.setSetting("sync.requestLimit", String(n));
    }
    writeSchedule(db, { enabled: body.enabled ?? current.enabled, times });
    return c.json({
      ...(scheduler ? scheduler.status() : { config: readSchedule(db) }),
      requestLimit: requestLimit(),
    });
  });

  /** Sync every link of every user right now. */
  app.post("/api/server/sync-schedule/run", async (c) => {
    if (!scheduler) return c.json({ error: "No scheduler in this process" }, 400);
    if (scheduler.running) return c.json({ error: "A scheduled sync is already running." }, 409);
    const run = await scheduler.runAll("manual");
    return c.json({ run });
  });
}
