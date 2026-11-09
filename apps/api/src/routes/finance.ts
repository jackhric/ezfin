import {
  CATEGORIES,
  CATEGORY_BY_ID,
  addDays,
  detectRecurring,
  netWorth,
  summarizeByMonth,
  toISODate,
  totalsByCategory,
} from "@ezfin/core";
import { syncUser } from "../sync.ts";
import type { Api, RouteContext } from "./context.ts";

/* ---- Financial data, always scoped to the signed-in user ---- */

export function registerFinanceRoutes(app: Api, { db, ai, syncDeps, resolver }: RouteContext) {
  app.get("/api/status", (c) => {
    const user = c.get("user");
    const links = db.listLinks(user.id);
    const lastSyncAt = links.reduce<string | null>(
      (m, l) => (l.lastSyncedAt && (!m || l.lastSyncedAt > m) ? l.lastSyncedAt : m),
      null,
    );
    return c.json({
      links: links.length,
      demoOnly: links.length > 0 && links.every((l) => l.provider === "demo"),
      lastSyncAt,
      lastSyncWarnings: links.flatMap((l) => l.warnings),
      accounts: db.listAccounts(user.id).length,
      transactions: db.listTransactions(user.id).length,
    });
  });

  app.get("/api/accounts", (c) => {
    const accounts = db.listAccounts(c.get("user").id);
    return c.json({ accounts, netWorth: netWorth(accounts) });
  });

  app.get("/api/categories", (c) =>
    c.json({ categories: CATEGORIES, overrides: Object.fromEntries(db.getOverrides()) }),
  );

  app.get("/api/transactions", (c) => {
    const q = c.req.query();
    const txs = db.listTransactions(c.get("user").id, {
      from: q.from,
      to: q.to,
      accountId: q.accountId,
      categoryId: q.categoryId,
      q: q.q,
    });
    const limit = q.limit ? Math.max(1, Math.min(5000, Number(q.limit))) : undefined;
    const offset = Math.max(0, Number(q.offset ?? 0) || 0);
    const page = limit ? txs.slice(offset, offset + limit) : txs.slice(offset);
    return c.json({
      transactions: page,
      total: txs.length,
      offset,
      hasMore: offset + page.length < txs.length,
    });
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
    const tx = db.setCategory(c.get("user").id, id, body.categoryId);
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
    const userId = c.get("user").id;
    const months = Math.max(1, Math.min(36, Number(c.req.query("months") ?? 12)));
    const today = toISODate(new Date());
    const from = `${addDays(today, -31 * (months - 1)).slice(0, 7)}-01`;
    const txs = db.listTransactions(userId, { from });
    const byMonth = summarizeByMonth(txs);
    const accounts = db.listAccounts(userId);
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
    const txs = db.listTransactions(c.get("user").id, {
      from: addDays(toISODate(new Date()), -400),
    });
    const series = detectRecurring(txs);
    const active = series.filter((s) => !s.possiblyCancelled);
    return c.json({
      series,
      monthlyTotal: Math.round(active.reduce((s, r) => s + r.monthlyEquivalent, 0) * 100) / 100,
      activeCount: active.length,
    });
  });

  /** Sync every link the signed-in user has. */
  app.post("/api/sync", async (c) => {
    const { results, errors } = await syncUser(db, c.get("user").id, syncDeps);
    // Optionally let the local model fill in whatever the rules could not.
    if (ai && results.length > 0 && db.getSetting("aiAuto") === "1") ai.job.start("uncategorized");
    const summary = {
      accounts: results.reduce((n, r) => n + r.accounts, 0),
      transactions: results.reduce((n, r) => n + r.transactions, 0),
      syncedAt: new Date().toISOString(),
      warnings: results.flatMap((r) => r.warnings),
      errors,
    };
    if (results.length === 0 && errors.length > 0)
      return c.json({ ...summary, error: errors.map((e) => e.error).join("; ") }, 502);
    return c.json(summary);
  });
}
