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
}
