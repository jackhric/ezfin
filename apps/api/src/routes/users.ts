import { hashPassword, validateCredentials, validatePassword, validateProfile } from "../auth.ts";
import type { Api, RouteContext } from "./context.ts";

/* ---- User management (admins only; `requireAdmin` is applied in createApp) ---- */

export function registerUsersRoutes(app: Api, { db, secrets }: RouteContext) {
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
}
