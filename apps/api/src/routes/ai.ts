import { requireAdmin } from "../auth.ts";
import type { AiScope } from "../ai/job.ts";
import type { Api, RouteContext } from "./context.ts";

/* ---- Local AI (loopback model server only; see ai/classifier.ts) ---- */

export function registerAiRoutes(app: Api, { db, ai, minConfidence, resolver }: RouteContext) {
  app.get("/api/ai/status", async (c) => {
    if (!ai) return c.json({ configured: false });
    const status = await ai.classifier.status();
    return c.json({
      configured: true,
      ...status,
      minConfidence: minConfidence(),
      batchSize: ai.service?.batchSize ?? null,
      editable: Boolean(ai.service),
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

  /* ---- Configuration and connection test (admins) ---- */

  app.use("/api/ai/config", requireAdmin());
  app.use("/api/ai/test", requireAdmin());

  app.get("/api/ai/config", (c) => {
    if (!ai?.service) return c.json({ error: "AI settings are fixed in this process" }, 400);
    return c.json({ config: ai.service.config });
  });

  app.put("/api/ai/config", async (c) => {
    if (!ai?.service) return c.json({ error: "AI settings are fixed in this process" }, 400);
    if (ai.job.state.running)
      return c.json({ error: "Wait for the running categorization to finish." }, 409);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const config = ai.service.reconfigure(body);
      return c.json({ config });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "invalid settings" }, 400);
    }
  });

  /** Reach the server, confirm the model, and time one real classification. */
  app.post("/api/ai/test", async (c) => {
    if (!ai?.service) return c.json({ error: "AI settings are fixed in this process" }, 400);
    const result = await ai.service.test();
    return c.json(result, result.ok ? 200 : 502);
  });

  /** Forget everything the model concluded and fall back to rules. User overrides are untouched. */
  app.delete("/api/ai/insights", (c) => {
    db.clearInsights();
    const recategorized = db.recategorize(resolver());
    return c.json({ ok: true, recategorized });
  });
}
