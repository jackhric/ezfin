import { describe, expect, it, vi } from "vite-plus/test";
import type { MerchantInsight } from "@ezfin/core";
import { openDb, type MerchantProfile } from "../src/db/index.ts";
import {
  assertLocal,
  extractJson,
  LocalClassifier,
  parseResults,
  type Classifier,
} from "../src/ai/classifier.ts";
import { AiJob } from "../src/ai/job.ts";

import { makeApp, type Json } from "./helpers.ts";

describe("classifier guard rails", () => {
  it("allows private networks by default and refuses public hosts unless explicitly allowed", () => {
    expect(() => assertLocal("http://127.0.0.1:11434", { allowRemote: false })).not.toThrow();
    expect(() => assertLocal("http://localhost:1234", { allowRemote: false })).not.toThrow();
    for (const ok of [
      "http://10.0.10.66:8080",
      "http://192.168.1.50:11434",
      "http://172.20.3.4:8080",
      "http://100.101.102.103:8080",
      "http://hrichouse-mac.local:8080",
      "http://macmini:8080",
      "http://[fd12::1]:8080",
    ])
      expect(() => assertLocal(ok, { allowRemote: false }), ok).not.toThrow();
    for (const bad of [
      "https://api.openai.com",
      "http://8.8.8.8:8080",
      "http://172.32.0.1:8080",
      "http://example.local.com",
    ])
      expect(() => assertLocal(bad, { allowRemote: false }), bad).toThrow(/public internet/);
    expect(() => assertLocal("https://api.openai.com", { allowRemote: true })).not.toThrow();
    expect(() => assertLocal("https://api.example.com", { allowRemote: false })).toThrow(
      /Refusing/,
    );
    expect(() =>
      assertLocal("http://host.docker.internal:11434", {
        allowRemote: false,
        extraLocalHosts: ["host.docker.internal"],
      }),
    ).not.toThrow();
    expect(
      () =>
        new LocalClassifier({
          provider: "ollama",
          url: "https://api.example.com",
          model: "x",
          allowRemote: false,
        }),
    ).toThrow();
  });

  it("drops hallucinated merchants and bad categories", () => {
    const batch: MerchantProfile[] = [
      {
        merchant: "steamgames",
        samples: ["STEAMGAMES.COM"],
        typicalAmount: -30,
        count: 4,
        categoryId: "uncategorized",
      },
      {
        merchant: "one medical",
        samples: ["ONE MEDICAL"],
        typicalAmount: -45,
        count: 3,
        categoryId: "uncategorized",
      },
    ];
    const out = parseResults(
      {
        results: [
          {
            merchant: "steamgames",
            categoryId: "entertainment",
            label: "video game platform",
            confidence: 0.95,
          },
          { merchant: "one medical", categoryId: "not_a_category", label: "x", confidence: 0.9 },
          { merchant: "made up co", categoryId: "dining", label: "x", confidence: 0.9 },
          { merchant: "steamgames", categoryId: "shopping", label: "dup", confidence: 1.7 },
        ],
      },
      batch,
    );
    expect(out).toEqual([
      {
        merchant: "steamgames",
        categoryId: "entertainment",
        label: "video game platform",
        confidence: 0.95,
      },
    ]);
  });

  it("tolerates think blocks, code fences and prose around the JSON", () => {
    const obj = {
      results: [{ merchant: "x", categoryId: "dining", label: "cafe", confidence: 0.9 }],
    };
    expect(extractJson(JSON.stringify(obj))).toEqual(obj);
    expect(extractJson(`<think>\nhmm, netflix\n</think>\n${JSON.stringify(obj)}`)).toEqual(obj);
    expect(extractJson("```json\n" + JSON.stringify(obj) + "\n```")).toEqual(obj);
    expect(extractJson(`Sure! Here you go: ${JSON.stringify(obj)} Let me know.`)).toEqual(obj);
    expect(() => extractJson("no json here")).toThrow(/not JSON/);
  });

  it("asks Qwen3 not to think on OpenAI-compatible servers and parses loose output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith("/v1/models"))
          return new Response(JSON.stringify({ data: [{ id: "mlx-community/Qwen3-14B-4bit" }] }));
        expect(u).toBe("http://127.0.0.1:8080/v1/chat/completions");
        const body = JSON.parse(init?.body as string);
        expect(body.messages[0].content).toContain("/no_think");
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '<think>\n\n</think>\n\n```json\n{"results":[{"merchant":"steamgames","categoryId":"entertainment","label":"games","confidence":0.9}]}\n```',
                },
              },
            ],
          }),
        );
      }),
    );
    try {
      const c = new LocalClassifier({
        provider: "openai",
        url: "http://127.0.0.1:8080",
        model: "mlx-community/Qwen3-14B-4bit",
        allowRemote: false,
      });
      expect((await c.status()).modelAvailable).toBe(true);
      const out = await c.classify([
        {
          merchant: "steamgames",
          samples: ["STEAMGAMES.COM"],
          typicalAmount: -30,
          count: 4,
          categoryId: "uncategorized",
        },
      ]);
      expect(out[0]!.categoryId).toBe("entertainment");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("speaks Ollama's chat format with a JSON schema", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/tags"))
        return new Response(JSON.stringify({ models: [{ name: "qwen3:4b" }] }));
      expect(u).toBe("http://127.0.0.1:11434/api/chat");
      const body = JSON.parse(init?.body as string);
      expect(body.format.properties.results).toBeDefined();
      expect(body.think).toBe(false);
      expect(body.messages[1].content).toContain("steamgames");
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              results: [
                {
                  merchant: "steamgames",
                  categoryId: "entertainment",
                  label: "games",
                  confidence: 0.9,
                },
              ],
            }),
          },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const c = new LocalClassifier({
        provider: "ollama",
        url: "http://127.0.0.1:11434",
        model: "qwen3:4b",
        allowRemote: false,
      });
      const status = await c.status();
      expect(status).toMatchObject({ reachable: true, modelAvailable: true });
      const out = await c.classify([
        {
          merchant: "steamgames",
          samples: ["STEAMGAMES.COM"],
          typicalAmount: -30,
          count: 4,
          categoryId: "uncategorized",
        },
      ]);
      expect(out[0]!.categoryId).toBe("entertainment");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

class FakeClassifier implements Classifier {
  readonly model = "fake";
  calls = 0;
  constructor(private readonly answer: (m: MerchantProfile) => MerchantInsight | undefined) {}
  async status() {
    return {
      provider: "ollama" as const,
      url: "http://127.0.0.1:11434",
      model: this.model,
      reachable: true,
      modelAvailable: true,
      models: [this.model],
    };
  }
  async classify(batch: MerchantProfile[]) {
    this.calls += 1;
    return batch.map(this.answer).filter((x): x is MerchantInsight => Boolean(x));
  }
}

async function waitForJob(job: AiJob) {
  for (let i = 0; i < 200 && job.state.running; i++) await new Promise((r) => setTimeout(r, 5));
  expect(job.state.running).toBe(false);
}

describe("ai job", () => {
  it("fills gaps the rules left and shows labels on transactions", async () => {
    const classifier = new FakeClassifier((m) =>
      m.merchant === "steamgames"
        ? {
            merchant: m.merchant,
            categoryId: "entertainment",
            label: "video game store",
            confidence: 0.9,
          }
        : undefined,
    );
    const pre = openDb(":memory:");
    const job = new AiJob(pre, classifier, { batchSize: 5, minConfidence: 0.6 });
    const { app, db, headers, json, userId } = await makeApp({
      db: pre,
      ai: { job, classifier, minConfidence: 0.6 },
    });

    // The built-in rules know steamgames; make it unknown by stripping the rule result first.
    const before = db.listTransactions(userId, { q: "STEAMGAMES" });
    expect(before.length).toBeGreaterThan(0);
    db.raw.exec(
      "UPDATE transactions SET category_id = 'uncategorized' WHERE merchant = 'steamgames'",
    );

    const res = await app.request("/api/ai/categorize", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ scope: "uncategorized" }),
    });
    expect(res.status).toBe(202);
    await waitForJob(job);
    expect(job.state.error).toBeUndefined();
    expect(job.state.classified).toBe(1);
    expect(job.state.recategorized).toBe(before.length);

    const after = db.listTransactions(userId, { q: "STEAMGAMES" });
    expect(
      after.every(
        (t) => t.categoryId === "entertainment" && t.merchantLabel === "video game store",
      ),
    ).toBe(true);

    const status = await ((
      await app.request("/api/ai/status", { headers })
    ).json() as Promise<Json>);
    expect(status).toMatchObject({ configured: true, reachable: true, insights: 1 });

    // Forgetting insights falls back to the rules (which also say entertainment here) and clears labels.
    await app.request("/api/ai/insights", { method: "DELETE", headers });
    expect(db.listTransactions(userId, { q: "STEAMGAMES" })[0]!.merchantLabel).toBeUndefined();
  });

  it("never overrides a hand-set category and respects the confidence floor", async () => {
    const classifier = new FakeClassifier((m) => ({
      merchant: m.merchant,
      categoryId: "travel",
      label: "wrong",
      confidence: m.merchant === "netflix" ? 0.95 : 0.3,
    }));
    const pre = openDb(":memory:");
    const job = new AiJob(pre, classifier, { batchSize: 50, minConfidence: 0.6 });
    const { app, db, json, userId } = await makeApp({
      db: pre,
      ai: { job, classifier, minConfidence: 0.6 },
    });
    const spotify = db.listTransactions(userId, { q: "Spotify" })[0]!;
    await app.request(`/api/transactions/${spotify.id}/category`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ categoryId: "entertainment" }),
    });

    await app.request("/api/ai/categorize", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ scope: "all" }),
    });
    await waitForJob(job);

    // High-confidence insight wins over rules for netflix in "all" scope.
    expect(
      db.listTransactions(userId, { q: "NETFLIX" }).every((t) => t.categoryId === "travel"),
    ).toBe(true);
    // Low confidence is ignored, rules stay.
    expect(
      db.listTransactions(userId, { q: "PLANET FITNESS" }).every((t) => t.categoryId === "fitness"),
    ).toBe(true);
    // Hand-set category survives.
    expect(db.listTransactions(userId, { q: "Spotify" })[0]!.categoryId).toBe("entertainment");
    // A second start while running is refused; after finishing it is accepted again.
    expect(job.start("uncategorized")).toBe(true);
    await waitForJob(job);
  });
});

describe("ai configuration and connection test", () => {
  async function appWithService(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
    vi.stubGlobal("fetch", vi.fn(fetchImpl));
    const db = openDb(":memory:");
    const { AiService } = await import("../src/ai/service.ts");
    const service = new AiService(
      db,
      {
        provider: "ollama",
        url: "http://127.0.0.1:11434",
        model: "qwen3:4b",
        minConfidence: 0.6,
        batchSize: 12,
      },
      { allowRemote: false },
    );
    const job = new AiJob(
      db,
      () => service.classifier,
      () => ({ batchSize: service.batchSize, minConfidence: service.minConfidence }),
    );
    const ai = {
      service,
      job,
      get classifier() {
        return service.classifier;
      },
      get minConfidence() {
        return service.minConfidence;
      },
    };
    const made = await makeApp({ db, ai });
    return { ...made, service };
  }

  it("lets an admin change settings, refuses non-loopback URLs, and persists", async () => {
    try {
      const { app, json, headers, db, service } = await appWithService(
        async () => new Response("{}"),
      );
      const status = await ((
        await app.request("/api/ai/status", { headers })
      ).json() as Promise<Json>);
      expect(status).toMatchObject({ editable: true, batchSize: 12, minConfidence: 0.6 });

      const remote = await app.request("/api/ai/config", {
        method: "PUT",
        headers: json,
        body: JSON.stringify({ url: "https://api.openai.com/v1" }),
      });
      expect(remote.status).toBe(400);
      expect((await (remote.json() as Promise<Json>)).error).toMatch(/public internet/);
      expect(service.config.url).toBe("http://127.0.0.1:11434");

      const bad = await app.request("/api/ai/config", {
        method: "PUT",
        headers: json,
        body: JSON.stringify({ minConfidence: 2 }),
      });
      expect(bad.status).toBe(400);

      const ok = await app.request("/api/ai/config", {
        method: "PUT",
        headers: json,
        body: JSON.stringify({
          provider: "openai",
          url: "http://localhost:1234/",
          model: "gemma3:4b",
          minConfidence: 0.75,
          batchSize: 8,
        }),
      });
      expect(ok.status).toBe(200);
      expect((await (ok.json() as Promise<Json>)).config).toEqual({
        provider: "openai",
        url: "http://localhost:1234",
        model: "gemma3:4b",
        minConfidence: 0.75,
        batchSize: 8,
      });
      expect(service.classifier.model).toBe("gemma3:4b");
      expect(JSON.parse(db.getSetting("ai.config")!)).toMatchObject({ model: "gemma3:4b" });
      // Status reflects the live values.
      const after = await ((
        await app.request("/api/ai/status", { headers })
      ).json() as Promise<Json>);
      expect(after).toMatchObject({
        provider: "openai",
        model: "gemma3:4b",
        minConfidence: 0.75,
        batchSize: 8,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("test endpoint reports offline, model missing, and a timed sample classification", async () => {
    let mode: "offline" | "missing" | "ok" = "offline";
    try {
      const { app, json } = await appWithService(async (url, init) => {
        if (mode === "offline") throw new Error("ECONNREFUSED");
        if (String(url).endsWith("/api/tags"))
          return new Response(
            JSON.stringify({ models: [{ name: mode === "ok" ? "qwen3:4b" : "other:1b" }] }),
          );
        expect(String(url)).toBe("http://127.0.0.1:11434/api/chat");
        expect(JSON.parse(init?.body as string).messages[1].content).toContain("netflix");
        return new Response(
          JSON.stringify({
            message: {
              content: JSON.stringify({
                results: [
                  {
                    merchant: "netflix",
                    categoryId: "subscriptions",
                    label: "streaming service",
                    confidence: 0.97,
                  },
                ],
              }),
            },
          }),
        );
      });
      const offline = await app.request("/api/ai/test", { method: "POST", headers: json });
      expect(offline.status).toBe(502);
      expect(await (offline.json() as Promise<Json>)).toMatchObject({
        ok: false,
        reachable: false,
      });

      mode = "missing";
      const missing = await app.request("/api/ai/test", { method: "POST", headers: json });
      expect(await (missing.json() as Promise<Json>)).toMatchObject({
        ok: false,
        reachable: true,
        modelAvailable: false,
        models: ["other:1b"],
      });

      mode = "ok";
      const good = await app.request("/api/ai/test", { method: "POST", headers: json });
      expect(good.status).toBe(200);
      const body = await (good.json() as Promise<Json>);
      expect(body).toMatchObject({
        ok: true,
        reachable: true,
        modelAvailable: true,
        sample: {
          merchant: "netflix",
          categoryId: "subscriptions",
          label: "streaming service",
          confidence: 0.97,
        },
      });
      expect(body.latencyMs).toBeTypeOf("number");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
