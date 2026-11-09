import { describe, expect, it, vi } from "vite-plus/test";
import type { MerchantInsight } from "@ezfin/core";
import { openDb, type MerchantProfile } from "../src/db.ts";
import {
  assertLocal,
  LocalClassifier,
  parseResults,
  type Classifier,
} from "../src/ai/classifier.ts";
import { AiJob } from "../src/ai/job.ts";

import { makeApp, type Json } from "./helpers.ts";

describe("classifier guard rails", () => {
  it("refuses non-local endpoints unless explicitly allowed", () => {
    expect(() => assertLocal("http://127.0.0.1:11434", { allowRemote: false })).not.toThrow();
    expect(() => assertLocal("http://localhost:1234", { allowRemote: false })).not.toThrow();
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
