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
import {
  LoginLimiter,
  currentUser,
  endSession,
  hashPassword,
  requireUser,
  startSession,
  validateCredentials,
  verifyPassword,
} from "./auth.ts";
import type { Db, User } from "./db.ts";
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

type Env = { Variables: { user: User } };

/**
 * The local JSON API. Every route reads from or writes to the local SQLite file,
 * and every financial route is scoped to the signed-in user. The server only
 * listens on loopback; see PRIVACY.md for the threat model.
 */
export function createApp({ db, provider, ai }: AppDeps) {
  const app = new Hono<Env>();
  const minConfidence = ai?.minConfidence ?? 0.6;
  const limiter = new LoginLimiter();
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

  /* ---- Accounts (the people kind) ---- */

  /** Who am I, and does this install still need its first account created? */
  app.get("/api/auth/status", (c) => {
    const user = currentUser(c, db);
    return c.json({ setupRequired: db.countUsers() === 0, user: user ?? null });
  });

  /** One-time setup: creates the first user. Later users are created from Settings by a signed-in user. */
  app.post("/api/auth/setup", async (c) => {
    if (db.countUsers() > 0)
      return c.json({ error: "Setup is already done. Sign in instead." }, 409);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const v = validateCredentials(body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const user = db.createUser({
      username: v.username,
      email: v.email,
      passwordHash: await hashPassword(v.password),
    });
    startSession(c, db, user.id);
    // Demo mode: give the new user something to look at right away.
    if (provider.id === "mock") await runSync(db, provider, user.id, minConfidence);
    return c.json({ user }, 201);
  });

  app.post("/api/auth/login", async (c) => {
    if (limiter.blocked())
      return c.json({ error: "Too many failed attempts. Wait 15 minutes." }, 429);
    const body = (await c.req.json().catch(() => ({}))) as { username?: string; password?: string };
    const user = db.getUserByUsername(String(body.username ?? "").trim());
    const ok = user ? await verifyPassword(String(body.password ?? ""), user.passwordHash) : false;
    if (!user || !ok) {
      limiter.fail();
      await new Promise((r) => setTimeout(r, 300));
      return c.json({ error: "Wrong username or password." }, 401);
    }
    limiter.reset();
    startSession(c, db, user.id);
    const { passwordHash: _omit, ...safe } = user;
    return c.json({ user: safe });
  });

  app.post("/api/auth/logout", (c) => {
    endSession(c, db);
    return c.json({ ok: true });
  });

  // Everything below requires a session.
  app.use("/api/*", requireUser(db));

  /** The signed-in user plus the financial accounts that belong to them. */
  app.get("/api/me", (c) => {
    const user = c.get("user");
    const accounts = db.listAccounts(user.id);
    return c.json({ user, accounts, netWorth: netWorth(accounts) });
  });

  /** A signed-in user may add another person to this install. */
  app.post("/api/auth/users", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const v = validateCredentials(body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    if (db.getUserByUsername(v.username)) return c.json({ error: "That username is taken." }, 409);
    const user = db.createUser({
      username: v.username,
      email: v.email,
      passwordHash: await hashPassword(v.password),
    });
    return c.json({ user }, 201);
  });

  /* ---- Financial data ---- */

  app.get("/api/status", async (c) => {
    const user = c.get("user");
    const status = await provider.describe(user.id);
    return c.json({
      provider: status,
      lastSyncAt: db.getSetting(`lastSyncAt:${user.id}`) ?? null,
      lastSyncWarnings: JSON.parse(
        db.getSetting(`lastSyncWarnings:${user.id}`) ?? "[]",
      ) as string[],
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

  app.post("/api/sync", async (c) => {
    try {
      const result = await runSync(db, provider, c.get("user").id, minConfidence);
      // Optionally let the local model fill in whatever the rules could not.
      if (ai && db.getSetting("aiAuto") === "1") ai.job.start("uncategorized");
      return c.json(result);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "sync failed" }, 502);
    }
  });

  /** Link SimpleFIN to the signed-in user by claiming a setup token. Needs EZFIN_PROVIDER=simplefin. */
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
      await provider.claim(c.get("user").id, body.setupToken);
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

  /** Remove the bank link and every account and transaction belonging to the signed-in user. */
  app.post("/api/disconnect", (c) => {
    const user = c.get("user");
    if (provider instanceof SimpleFinProvider) provider.disconnect(user.id);
    db.clearData(user.id);
    db.deleteSetting(`lastSyncAt:${user.id}`);
    db.deleteSetting(`lastSyncWarnings:${user.id}`);
    return c.json({ ok: true });
  });

  return app;
}
