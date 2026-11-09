import { describe, expect, it, vi } from "vite-plus/test";
import { openDb } from "../src/db/index.ts";
import { SimpleFinProvider } from "../src/providers/simplefin.ts";
import { BudgetExceededError } from "../src/providers/types.ts";
import { budgetFor } from "../src/sync.ts";
import { makeApp, type Json } from "./helpers.ts";

function bridgeResponse() {
  return new Response(JSON.stringify({ errlist: [], connections: [], accounts: [] }));
}

describe("request budget", () => {
  it("counts every request to SimpleFIN and refuses a sync that would exceed the limit", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        calls.push(String(url));
        return bridgeResponse();
      }),
    );
    try {
      const db = openDb(":memory:");
      const provider = new SimpleFinProvider();
      const url = "https://u:p@bridge.example/simplefin";
      // 400 days of history = 5 windows = 5 requests.
      const first = await provider.fetch("2025-10-05", url, budgetFor(db, "lnk_a", 16));
      expect(first.accounts).toEqual([]);
      expect(calls.filter((c) => c.includes("/accounts")).length).toBe(5);
      expect(db.countRequests("lnk_a", new Date(0).toISOString())).toBe(5);

      // Only 3 left: a 5-window sync is refused before any request goes out.
      calls.length = 0;
      await expect(
        provider.fetch("2025-10-05", url, budgetFor(db, "lnk_a", 8)),
      ).rejects.toBeInstanceOf(BudgetExceededError);
      expect(calls.length).toBe(0);
      expect(db.countRequests("lnk_a", new Date(0).toISOString())).toBe(5);

      // A short incremental sync (one window) still fits.
      await provider.fetch("2026-11-01", url, budgetFor(db, "lnk_a", 8));
      expect(db.countRequests("lnk_a", new Date(0).toISOString())).toBe(6);
      // Budgets are per link.
      expect(budgetFor(db, "lnk_b", 16).remaining).toBe(16);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("exposes usage on the link and lets admins set the limit within SimpleFIN's ceiling", async () => {
    const { app, headers, json } = await makeApp();
    const links = await ((await app.request("/api/links", { headers })).json() as Promise<Json>);
    expect(links.links[0].requests).toEqual({ used: 0, limit: 16, windowHours: 24 });
    const bad = await app.request("/api/server/sync-schedule", {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ requestLimit: 30 }),
    });
    expect(bad.status).toBe(400);
    const ok = await app.request("/api/server/sync-schedule", {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ requestLimit: 10 }),
    });
    expect((await (ok.json() as Promise<Json>)).requestLimit).toBe(10);
    expect(
      (await ((await app.request("/api/links", { headers })).json() as Promise<Json>)).links[0]
        .requests.limit,
    ).toBe(10);
  });
});
