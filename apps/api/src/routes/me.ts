import { netWorth } from "@ezfin/core";
import {
  currentTokenHash,
  hashPassword,
  validatePassword,
  validateProfile,
  verifyPassword,
} from "../auth.ts";
import type { Api, RouteContext } from "./context.ts";

/* ---- Account settings (the signed-in person) ---- */

export function registerMeRoutes(app: Api, { db }: RouteContext) {
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
}
