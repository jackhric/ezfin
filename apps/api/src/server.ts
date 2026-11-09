import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.ts";
import { openDb } from "./db/index.ts";
import { dbPath, env } from "./env.ts";
import { MockProvider, SimpleFinProvider } from "./providers/index.ts";
import { FileSecretStore } from "./secrets.ts";
import { SyncScheduler } from "./scheduler.ts";
import { DEFAULT_REQUEST_LIMIT } from "./sync.ts";
import { AiJob } from "./ai/job.ts";
import { AiService } from "./ai/service.ts";

const db = openDb(dbPath());
const providers = { simplefin: new SimpleFinProvider(), demo: new MockProvider() };
const secrets = new FileSecretStore(env.dataDir);

// Local AI is always wired up; whether a model server is actually running is reported by /api/ai/status.
// Env gives the defaults; admins can change provider, URL, model and thresholds from Settings.
const aiService = new AiService(
  db,
  {
    provider: env.ai.provider,
    url: env.ai.url,
    model: env.ai.model,
    minConfidence: env.ai.minConfidence,
    batchSize: env.ai.batchSize,
  },
  {
    allowRemote: env.ai.allowRemote,
    extraLocalHosts: env.allowNonLocalBind ? ["host.docker.internal"] : [],
  },
);
const ai = {
  service: aiService,
  job: new AiJob(
    db,
    () => aiService.classifier,
    () => ({ batchSize: aiService.batchSize, minConfidence: aiService.minConfidence }),
  ),
  get classifier() {
    return aiService.classifier;
  },
  get minConfidence() {
    return aiService.minConfidence;
  },
};

const scheduler = new SyncScheduler(db, {
  providers,
  secrets,
  get minConfidence() {
    return aiService.minConfidence;
  },
  get requestLimit() {
    return Number(db.getSetting("sync.requestLimit") ?? DEFAULT_REQUEST_LIMIT);
  },
});
scheduler.start();

const app = createApp({ db, providers, secrets, ai, scheduler });

// Production mode: serve the built UI from the same process (see `vp run start`).
const indexFile = path.join(env.staticDir, "index.html");
if (fs.existsSync(indexFile)) {
  const root = path.relative(process.cwd(), env.staticDir) || ".";
  app.use("/assets/*", serveStatic({ root }));
  const index = fs.readFileSync(indexFile, "utf8");
  app.get("*", (c) => c.html(index));
  console.log(`[ezfin] serving web app from ${env.staticDir}`);
} else {
  console.log(
    "[ezfin] no web build found; run the UI with `vp run dev:web` or build it with `vp run web#build`",
  );
}

serve({ fetch: app.fetch, hostname: env.host, port: env.port }, (info) => {
  console.log(`[ezfin] api listening on http://${info.address}:${info.port} (data: ${dbPath()})`);
  const aiCfg = aiService.config;
  console.log(`[ezfin] local AI: ${aiCfg.provider} at ${aiCfg.url}, model ${aiCfg.model}`);
  if (db.countUsers() === 0)
    console.log("[ezfin] no account yet: open the app to create the first one");
  const sched = scheduler.status();
  console.log(
    `[ezfin] scheduled sync ${sched.config.enabled ? `at ${sched.config.times.join(", ")} ${sched.timezone}` : "disabled"}; next ${sched.nextRunAt ?? "never"}`,
  );
  if (
    !env.allowNonLocalBind &&
    env.host !== "127.0.0.1" &&
    env.host !== "localhost" &&
    env.host !== "::1"
  ) {
    console.warn(
      "[ezfin] WARNING: EZFIN_HOST is not loopback. Your financial data would be reachable from the network.",
    );
  }
});

const shutdown = () => {
  scheduler.stop();
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
