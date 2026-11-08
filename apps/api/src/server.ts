import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { dbPath, env } from "./env.ts";
import { MockProvider, SimpleFinProvider } from "./providers/index.ts";
import { FileSecretStore } from "./secrets.ts";
import { LocalClassifier } from "./ai/classifier.ts";
import { AiJob } from "./ai/job.ts";

const db = openDb(dbPath());
const providers = { simplefin: new SimpleFinProvider(), demo: new MockProvider() };
const secrets = new FileSecretStore(env.dataDir);

// Local AI is always wired up; whether a model server is actually running is reported by /api/ai/status.
const classifier = new LocalClassifier({
  ...env.ai,
  extraLocalHosts: env.allowNonLocalBind ? ["host.docker.internal"] : [],
});
const ai = {
  classifier,
  job: new AiJob(db, classifier, {
    batchSize: env.ai.batchSize,
    minConfidence: env.ai.minConfidence,
  }),
  minConfidence: env.ai.minConfidence,
};

const app = createApp({ db, providers, secrets, ai });

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
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
