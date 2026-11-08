import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { dbPath, env } from "./env.ts";
import { MockProvider, SimpleFinProvider, type Provider } from "./providers/index.ts";
import { runSync } from "./sync.ts";

const db = openDb(dbPath());
const provider: Provider =
  env.provider === "simplefin"
    ? new SimpleFinProvider(env.dataDir, env.simplefinAccessUrl)
    : new MockProvider();

// Demo mode: make sure there is something to look at.
if (env.provider === "mock" && db.listAccounts().length === 0) {
  const r = await runSync(db, provider);
  console.log(`[ezfin] seeded demo data: ${r.accounts} accounts, ${r.transactions} transactions`);
}

const app = createApp({ db, provider });

serve({ fetch: app.fetch, hostname: env.host, port: env.port }, (info) => {
  console.log(
    `[ezfin] api listening on http://${info.address}:${info.port} (provider: ${env.provider}, data: ${dbPath()})`,
  );
  if (env.host !== "127.0.0.1" && env.host !== "localhost" && env.host !== "::1") {
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
