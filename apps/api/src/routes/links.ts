import { SimpleFinProvider } from "../providers/simplefin.ts";
import { budgetFor, syncLink } from "../sync.ts";
import type { Api, RouteContext } from "./context.ts";

/* ---- Data-source links ---- */

export function registerLinksRoutes(
  app: Api,
  { db, secrets, ai, syncDeps, linkView, providers, requestLimit }: RouteContext,
) {
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

  /** Test a link without importing: one balances-only request for SimpleFIN, a no-op for demo. */
  app.post("/api/links/:id/test", async (c) => {
    const user = c.get("user");
    const link = db.getLink(user.id, c.req.param("id"));
    if (!link) return c.json({ error: "not found" }, 404);
    if (link.provider === "demo")
      return c.json({
        ok: true,
        provider: "demo",
        accounts: linkView(user.id).find((l) => l.id === link.id)?.accounts.length ?? 0,
        warnings: [],
        latencyMs: 0,
      });
    const started = Date.now();
    try {
      const r = await providers.simplefin.probe(
        secrets.get(link.id),
        budgetFor(db, link.id, requestLimit()),
      );
      return c.json({ ok: true, provider: "simplefin", ...r, latencyMs: Date.now() - started });
    } catch (e) {
      return c.json(
        {
          ok: false,
          provider: "simplefin",
          error: e instanceof Error ? e.message : String(e),
          latencyMs: Date.now() - started,
        },
        502,
      );
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

  /** Remove every link, credential, account and transaction belonging to the signed-in user. */
  app.post("/api/disconnect", (c) => {
    const user = c.get("user");
    for (const l of db.listLinks(user.id)) secrets.delete(l.id);
    db.clearData(user.id);
    return c.json({ ok: true });
  });
}
