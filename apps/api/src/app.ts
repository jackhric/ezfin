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
  currentTokenHash,
  currentUser,
  endSession,
  hashPassword,
  requireAdmin,
  requireUser,
  startSession,
  validateCredentials,
  validatePassword,
  validateProfile,
  verifyPassword,
} from "./auth.ts";
import type { Db, User } from "./db.ts";
import { STARTED_AT, VERSION, dbPath, env } from "./env.ts";
import fs from "node:fs";
import { SimpleFinProvider } from "./providers/simplefin.ts";
import type { SecretStore } from "./secrets.ts";
import { syncLink, syncUser, type SyncDeps } from "./sync.ts";
import type { AiJob, AiScope } from "./ai/job.ts";
import type { Classifier } from "./ai/classifier.ts";

export interface AppDeps {
  db: Db;
  providers: SyncDeps["providers"];
  secrets: SecretStore;
  /** Optional local-model categorization. Absent when no classifier is configured. */
  ai?: { job: AiJob; classifier: Classifier; minConfidence: number };
}

type Env = { Variables: { user: User } };

const strip = <T extends { passwordHash?: string }>(u: T): Omit<T, "passwordHash"> => {
  const { passwordHash: _omit, ...rest } = u;
  return rest;
};

/**
 * The local JSON API. Every route reads from or writes to the local SQLite file,
 * and every financial route is scoped to the signed-in user. The server only
 * listens on loopback; see PRIVACY.md for the threat model.
 */
export function createApp({ db, providers, secrets, ai }: AppDeps) {
  const app = new Hono<Env>();
  const minConfidence = ai?.minConfidence ?? 0.6;
  const syncDeps: SyncDeps = { providers, secrets, minConfidence };
  const linkView = (userId: string) =>
    db.listLinks(userId).map((l) => ({
      ...l,
      accounts: db.listAccounts(userId).filter((a) => a.linkId === l.id),
      detail:
        l.provider === "simplefin"
          ? `SimpleFIN Bridge at ${SimpleFinProvider.host(secrets.get(l.id) ?? "")}`
          : "Synthetic accounts and transactions generated locally, no real financial data",
    }));
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
      role: "admin",
    });
    startSession(c, db, user.id);
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
    return c.json({ user: strip(user) });
  });

  app.post("/api/auth/logout", (c) => {
    endSession(c, db);
    return c.json({ ok: true });
  });

  // Everything below requires a session.
  app.use("/api/*", requireUser(db));

  /* ---- Account settings (the signed-in person) ---- */

  /** The signed-in user plus the financial accounts that belong to them. */
  app.get("/api/me", (c) => {
    const user = c.get("user");
    const accounts = db.listAccounts(user.id);
    return c.json({ user, accounts, netWorth: netWorth(accounts) });
  });

  app.patch("/api/me", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const v = validateProfile(body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const me = c.get("user");
    if (v.username && v.username.toLowerCase() !== me.username.toLowerCase()) {
      if (db.getUserByUsername(v.username))
        return c.json({ error: "That username is taken." }, 409);
    }
    const user = db.updateUser(me.id, { username: v.username, email: v.email });
    return c.json({ user: user });
  });

  app.post("/api/me/password", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { current?: string; next?: string };
    const me = db.getUserById(c.get("user").id)!;
    if (!(await verifyPassword(String(body.current ?? ""), me.passwordHash)))
      return c.json({ error: "Current password is wrong." }, 400);
    const bad = validatePassword(body.next);
    if (bad) return c.json({ error: bad }, 400);
    db.setPassword(me.id, await hashPassword(String(body.next)));
    // Changing a password invalidates every other session.
    db.deleteSessionsForUser(me.id, currentTokenHash(c));
    return c.json({ ok: true });
  });

  /** Sign out everywhere except here. */
  app.delete("/api/me/sessions", (c) => {
    db.deleteSessionsForUser(c.get("user").id, currentTokenHash(c));
    return c.json({ ok: true });
  });

  /* ---- Server administration (admins only) ---- */

  app.use("/api/server/*", requireAdmin());
  app.use("/api/users", requireAdmin());
  app.use("/api/users/*", requireAdmin());

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

  app.get("/api/users", (c) => c.json({ users: db.listUsers() }));

  app.post("/api/users", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const v = validateCredentials(body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    if (db.getUserByUsername(v.username)) return c.json({ error: "That username is taken." }, 409);
    const user = db.createUser({
      username: v.username,
      email: v.email,
      passwordHash: await hashPassword(v.password),
      role: body.role === "admin" ? "admin" : "member",
    });
    return c.json({ user }, 201);
  });

  app.patch("/api/users/:id", async (c) => {
    const id = c.req.param("id");
    const target = db.getUserById(id);
    if (!target) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const v = validateProfile(body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const role = body.role === "admin" ? "admin" : body.role === "member" ? "member" : undefined;
    if (
      role === "member" &&
      target.role === "admin" &&
      db.listUsers().filter((u) => u.role === "admin").length === 1
    )
      return c.json({ error: "There must be at least one administrator." }, 400);
    if (
      v.username &&
      v.username.toLowerCase() !== target.username.toLowerCase() &&
      db.getUserByUsername(v.username)
    )
      return c.json({ error: "That username is taken." }, 409);
    const user = db.updateUser(id, { username: v.username, email: v.email, role });
    return c.json({ user: user });
  });

  /** Admin reset of someone's password. Signs them out everywhere. */
  app.post("/api/users/:id/password", async (c) => {
    const id = c.req.param("id");
    if (!db.getUserById(id)) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { password?: string };
    const bad = validatePassword(body.password);
    if (bad) return c.json({ error: bad }, 400);
    db.setPassword(id, await hashPassword(String(body.password)));
    db.deleteSessionsForUser(id);
    return c.json({ ok: true });
  });

  app.delete("/api/users/:id", (c) => {
    const id = c.req.param("id");
    if (id === c.get("user").id) return c.json({ error: "You cannot delete yourself." }, 400);
    if (!db.getUserById(id)) return c.json({ error: "not found" }, 404);
    for (const l of db.listLinks(id)) secrets.delete(l.id);
    db.deleteUser(id);
    return c.json({ ok: true });
  });

  /* ---- Financial data ---- */

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

  /* ---- Data-source links ---- */

  app.get("/api/links", (c) => c.json({ links: linkView(c.get("user").id) }));

  /** Link SimpleFIN: claim the one-time setup token, store the credential, import everything. */
  app.post("/api/links/simplefin", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as { setupToken?: string; label?: string };
    if (!body.setupToken) return c.json({ error: "setupToken required" }, 400);
    let accessUrl: string;
    try {
      accessUrl = await SimpleFinProvider.claim(body.setupToken);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "claim failed" }, 502);
    }
    const label =
      String(body.label ?? "").trim() || `SimpleFIN (${SimpleFinProvider.host(accessUrl)})`;
    const link = db.createLink(user.id, "simplefin", label);
    secrets.set(link.id, accessUrl);
    try {
      const result = await syncLink(db, link, syncDeps);
      return c.json({ link: linkView(user.id).find((l) => l.id === link.id), result }, 201);
    } catch (e) {
      // Keep the link so the user can retry sync; surface the failure.
      return c.json(
        {
          link: linkView(user.id).find((l) => l.id === link.id),
          error: e instanceof Error ? e.message : "sync failed",
        },
        502,
      );
    }
  });

  /** Add synthetic demo accounts. Safe to do on any install; nothing real is involved. */
  app.post("/api/links/demo", async (c) => {
    const user = c.get("user");
    if (db.listLinks(user.id).some((l) => l.provider === "demo"))
      return c.json({ error: "Demo data is already linked." }, 409);
    const link = db.createLink(user.id, "demo", "Demo data");
    const result = await syncLink(db, link, syncDeps);
    return c.json({ link: linkView(user.id).find((l) => l.id === link.id), result }, 201);
  });

  app.post("/api/links/:id/sync", async (c) => {
    const user = c.get("user");
    const link = db.getLink(user.id, c.req.param("id"));
    if (!link) return c.json({ error: "not found" }, 404);
    try {
      const result = await syncLink(db, link, syncDeps);
      if (ai && db.getSetting("aiAuto") === "1") ai.job.start("uncategorized");
      return c.json({ result });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "sync failed" }, 502);
    }
  });

  /** Unlink: removes the credential and every account and transaction imported through it. */
  app.delete("/api/links/:id", (c) => {
    const user = c.get("user");
    const link = db.getLink(user.id, c.req.param("id"));
    if (!link) return c.json({ error: "not found" }, 404);
    secrets.delete(link.id);
    db.deleteLink(user.id, link.id);
    return c.json({ ok: true });
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

  /** Remove every link, credential, account and transaction belonging to the signed-in user. */
  app.post("/api/disconnect", (c) => {
    const user = c.get("user");
    for (const l of db.listLinks(user.id)) secrets.delete(l.id);
    db.clearData(user.id);
    return c.json({ ok: true });
  });

  return app;
}
