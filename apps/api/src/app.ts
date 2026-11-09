import { Hono } from "hono";
import { requireAdmin, requireUser } from "./auth.ts";
import { registerAiRoutes } from "./routes/ai.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { buildContext, type AppDeps, type Env } from "./routes/context.ts";
import { registerFinanceRoutes } from "./routes/finance.ts";
import { registerLinksRoutes } from "./routes/links.ts";
import { registerMeRoutes } from "./routes/me.ts";
import { registerServerRoutes } from "./routes/server.ts";
import { registerUsersRoutes } from "./routes/users.ts";

export type { AppDeps } from "./routes/context.ts";

/**
 * The local JSON API. Every route reads from or writes to the local SQLite file,
 * and every financial route is scoped to the signed-in user. The server only
 * listens on loopback; see PRIVACY.md for the threat model.
 *
 * Middleware order matters in Hono: a handler only sees the middleware registered
 * before it. Keep it host check, public auth routes, requireUser, requireAdmin.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono<Env>();
  const ctx = buildContext(deps);

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

  // Public: status, first-time setup, login, logout.
  registerAuthRoutes(app, ctx);

  // Everything below requires a session.
  app.use("/api/*", requireUser(ctx.db));
  registerMeRoutes(app, ctx);

  // Administration requires the admin role.
  app.use("/api/server/*", requireAdmin());
  app.use("/api/users", requireAdmin());
  app.use("/api/users/*", requireAdmin());
  registerServerRoutes(app, ctx);
  registerUsersRoutes(app, ctx);

  // Per-user financial data, data-source links and the local model.
  registerFinanceRoutes(app, ctx);
  registerLinksRoutes(app, ctx);
  registerAiRoutes(app, ctx);

  return app;
}
