import {
  LoginLimiter,
  currentUser,
  endSession,
  hashPassword,
  startSession,
  validateCredentials,
  verifyPassword,
} from "../auth.ts";
import { strip, type Api, type RouteContext } from "./context.ts";

/* ---- Accounts (the people kind): the only routes that work without a session ---- */

export function registerAuthRoutes(app: Api, { db }: RouteContext) {
  const limiter = new LoginLimiter();

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
}
