import { Hono } from "hono";
import {
  CATEGORIES,
  CATEGORY_BY_ID,
  categorizeOne,
  detectRecurring,
  netWorth,
  summarizeByMonth,
  totalsByCategory,
  addDays,
  toISODate,
} from "@ezfin/core";
import type { Db } from "./db.ts";
import type { Provider } from "./providers/types.ts";
import { SimpleFinProvider } from "./providers/simplefin.ts";
import { runSync } from "./sync.ts";
import type { AiJob, AiScope } from "./ai/job.ts";
import type { Classifier } from "./ai/classifier.ts";

export interface AppDeps {
  db: Db;
  provider: Provider;
  /** Optional local-model categorization. Absent when no classifier is configured. */
  ai?: { job: AiJob; classifier: Classifier; minConfidence: number };
}

/**
 * The local JSON API. Every route reads from or writes to the local SQLite file.
 * There is no authentication because the server only listens on loopback;
 * see PRIVACY.md for the threat model.
 */
export function createApp({ db, provider, ai }: AppDeps) {
  const app = new Hono();
  const minConfidence = ai?.minConfidence ?? 0.6;
  const resolver = () => {
    const overrides = db.getOverrides();
    const insights = db.getInsights();
    return (t: Parameters<typeof categorizeOne>[0]) =>
      categorizeOne(t, { overrides, insights, minConfidence });
  };

  // Belt and braces: refuse requests that did not originate from this machine.
  app.use("*", async (c, next) => {
    const host = c.req.header("host") ?? "";
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) {
      return c.json({ error: "ezfin only serves localhost" }, 403);
    }
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    await next();
  });

  app.get("/api/status", async (c) => {
    const status = await provider.describe();
    return c.json({
      provider: status,
      lastSyncAt: db.getSetting("lastSyncAt") ?? null,
      lastSyncWarnings: JSON.parse(db.getSetting("lastSyncWarnings") ?? "[]") as string[],
      accounts: db.listAccounts().length,
      transactions: db.listTransactions().length,
    });
  });

  app.get("/api/accounts", (c) => {
    const accounts = db.listAccounts();
    return c.json({ accounts, netWorth: netWorth(accounts) });
  });

  app.get("/api/categories", (c) =>
    c.json({ categories: CATEGORIES, overrides: Object.fromEntries(db.getOverrides()) }),
  );

  app.get("/api/transactions", (c) => {
    const q = c.req.query();
    const txs = db.listTransactions({
      from: q.from,
      to: q.to,
      accountId: q.accountId,
      categoryId: q.categoryId,
      q: q.q,
    });
    const limit = q.limit ? Math.max(1, Math.min(5000, Number(q.limit))) : undefined;
    return c.json({ transactions: limit ? txs.slice(0, limit) : txs, total: txs.length });
  });

  /** Change one transaction's category. With applyToMerchant=true, also learn a rule for that merchant. */
  app.patch("/api/transactions/:id/category", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as {
      categoryId?: string;
      applyToMerchant?: boolean;
    };
    if (!body.categoryId || !CATEGORY_BY_ID.has(body.categoryId))
      return c.json({ error: "unknown categoryId" }, 400);
    const tx = db.setCategory(id, body.categoryId);
    if (!tx) return c.json({ error: "not found" }, 404);
    let recategorized = 0;
    if (body.applyToMerchant) {
      db.setOverride(tx.merchant, body.categoryId);
      recategorized = db.recategorize(resolver());
    }
    return c.json({ transaction: tx, recategorized });
  });

  app.delete("/api/rules/:merchant", (c) => {
    db.deleteOverride(decodeURIComponent(c.req.param("merchant")));
    const recategorized = db.recategorize(resolver());
    return c.json({ ok: true, recategorized });
  });

  app.get("/api/summary", (c) => {
    const months = Math.max(1, Math.min(36, Number(c.req.query("months") ?? 12)));
    const today = toISODate(new Date());
    const from = `${addDays(today, -31 * (months - 1)).slice(0, 7)}-01`;
    const txs = db.listTransactions({ from });
    const byMonth = summarizeByMonth(txs);
    const accounts = db.listAccounts();
    const currentMonth = today.slice(0, 7);
    const current = byMonth.find((m) => m.month === currentMonth) ?? {
      month: currentMonth,
      income: 0,
      spending: 0,
      net: 0,
      byCategory: [],
    };
    return c.json({
      netWorth: netWorth(accounts),
      current,
      months: byMonth,
      categoryTotals: totalsByCategory(byMonth),
      uncategorized: txs.filter((t) => t.categoryId === "uncategorized" && !t.pending).length,
    });
  });

  app.get("/api/recurring", (c) => {
    const txs = db.listTransactions({ from: addDays(toISODate(new Date()), -400) });
    const series = detectRecurring(txs);
    const active = series.filter((s) => !s.possiblyCancelled);
    return c.json({
      series,
      monthlyTotal: Math.round(active.reduce((s, r) => s + r.monthlyEquivalent, 0) * 100) / 100,
      activeCount: active.length,
    });
  });

  app.post("/api/sync", async (c) => {
    try {
      const result = await runSync(db, provider, minConfidence);
      // Optionally let the local model fill in whatever the rules could not.
      if (ai && db.getSetting("aiAuto") === "1") ai.job.start("uncategorized");
      return c.json(result);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "sync failed" }, 502);
    }
  });

  /** Connect SimpleFIN by claiming a setup token. Only available when the API runs with EZFIN_PROVIDER=simplefin. */
  app.post("/api/connect/simplefin", async (c) => {
    if (!(provider instanceof SimpleFinProvider)) {
      return c.json(
        { error: "Start the API with EZFIN_PROVIDER=simplefin to connect real accounts." },
        400,
      );
    }
    const body = (await c.req.json().catch(() => ({}))) as { setupToken?: string };
    if (!body.setupToken) return c.json({ error: "setupToken required" }, 400);
    try {
      await provider.claim(body.setupToken);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "claim failed" }, 502);
    }
  });

  /* ---- Local AI ---- */

  app.get("/api/ai/status", async (c) => {
    if (!ai) return c.json({ configured: false });
    const status = await ai.classifier.status();
    return c.json({
      configured: true,
      ...status,
      minConfidence,
      auto: db.getSetting("aiAuto") === "1",
      insights: db.getInsights().size,
      job: ai.job.state,
    });
  });

  app.post("/api/ai/categorize", async (c) => {
    if (!ai) return c.json({ error: "No local model configured" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { scope?: AiScope };
    const scope: AiScope = body.scope === "all" ? "all" : "uncategorized";
    const status = await ai.classifier.status();
    if (!status.reachable)
      return c.json(
        {
          error: `Local model server not reachable at ${status.url}: ${status.error ?? "unknown"}`,
        },
        502,
      );
    if (!status.modelAvailable)
      return c.json(
        {
          error: `Model "${status.model}" is not available. Pull it first (for Ollama: ollama pull ${status.model}).`,
        },
        400,
      );
    const started = ai.job.start(scope);
    return c.json({ started, job: ai.job.state }, started ? 202 : 409);
  });

  app.post("/api/ai/auto", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean };
    db.setSetting("aiAuto", body.enabled ? "1" : "0");
    return c.json({ auto: Boolean(body.enabled) });
  });

  /** Forget everything the model concluded and fall back to rules. User overrides are untouched. */
  app.delete("/api/ai/insights", (c) => {
    db.clearInsights();
    const recategorized = db.recategorize(resolver());
    return c.json({ ok: true, recategorized });
  });

  app.post("/api/disconnect", (c) => {
    if (provider instanceof SimpleFinProvider) provider.disconnect();
    db.clearData();
    db.deleteSetting("lastSyncAt");
    db.deleteSetting("lastSyncWarnings");
    return c.json({ ok: true });
  });

  return app;
}
