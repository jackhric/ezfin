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

export interface AppDeps {
  db: Db;
  provider: Provider;
}

/**
 * The local JSON API. Every route reads from or writes to the local SQLite file.
 * There is no authentication because the server only listens on loopback;
 * see PRIVACY.md for the threat model.
 */
export function createApp({ db, provider }: AppDeps) {
  const app = new Hono();

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
      const overrides = db.getOverrides();
      recategorized = db.recategorize((t) => categorizeOne(t, { overrides }));
    }
    return c.json({ transaction: tx, recategorized });
  });

  app.delete("/api/rules/:merchant", (c) => {
    db.deleteOverride(decodeURIComponent(c.req.param("merchant")));
    const overrides = db.getOverrides();
    const recategorized = db.recategorize((t) => categorizeOne(t, { overrides }));
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
      const result = await runSync(db, provider);
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

  app.post("/api/disconnect", (c) => {
    if (provider instanceof SimpleFinProvider) provider.disconnect();
    db.clearData();
    db.deleteSetting("lastSyncAt");
    return c.json({ ok: true });
  });

  return app;
}
