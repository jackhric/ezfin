import { describe, expect, it, vi } from "vite-plus/test";
import { MockProvider } from "../src/providers/mock.ts";
import { SimpleFinProvider } from "../src/providers/simplefin.ts";
import { BudgetExceededError } from "../src/providers/types.ts";
import { nextRun, SyncScheduler, validTimes } from "../src/scheduler.ts";
import { MemorySecretStore } from "../src/secrets.ts";
import { budgetFor } from "../src/sync.ts";
import { openDb } from "../src/db.ts";
import { HOST, makeApp } from "./helpers.ts";

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
    const links = await (await app.request("/api/links", { headers })).json();
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
    expect((await ok.json()).requestLimit).toBe(10);
    expect(
      (await (await app.request("/api/links", { headers })).json()).links[0].requests.limit,
    ).toBe(10);
  });
});

describe("scheduler", () => {
  it("validates and normalizes times and computes the next run", () => {
    expect(validTimes(["5:00", "17:00", "05:00"])).toEqual(["05:00", "17:00"]);
    expect(validTimes(["25:00"])).toBeUndefined();
    expect(validTimes([])).toBeUndefined();
    const cfg = { enabled: true, times: ["05:00", "17:00"] };
    const at = (h: number, m = 0) => {
      const d = new Date(2026, 10, 8, h, m, 0, 0);
      return d;
    };
    expect(nextRun(cfg, at(4, 59))?.getHours()).toBe(5);
    expect(nextRun(cfg, at(5, 0))?.getHours()).toBe(17);
    const late = nextRun(cfg, at(18))!;
    expect(late.getHours()).toBe(5);
    expect(late.getDate()).toBe(9);
    expect(nextRun({ enabled: false, times: ["05:00"] }, at(1))).toBeUndefined();
  });

  it("fires once per slot, syncs every user's links, and records the run", async () => {
    const db = openDb(":memory:");
    const deps = {
      providers: { demo: new MockProvider(3), simplefin: new SimpleFinProvider() },
      secrets: new MemorySecretStore(),
      minConfidence: 0.6,
    };
    const scheduler = new SyncScheduler(db, deps);
    const { app, json } = await makeApp({ db, scheduler });
    // Second user with their own demo link.
    await app.request("/api/users", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        username: "sam",
        email: "s@example.com",
        password: "another long pw",
      }),
    });
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { ...HOST, "content-type": "application/json" },
      body: JSON.stringify({ username: "sam", password: "another long pw" }),
    });
    const sam = {
      ...HOST,
      cookie: login.headers.get("set-cookie")!.split(";")[0]!,
      "content-type": "application/json",
    };
    await app.request("/api/links/demo", { method: "POST", headers: sam });

    const five = new Date(2026, 10, 8, 5, 0, 10);
    expect(await scheduler.tick(new Date(2026, 10, 8, 4, 59, 0))).toBe(false);
    expect(await scheduler.tick(five)).toBe(true);
    expect(await scheduler.tick(new Date(2026, 10, 8, 5, 0, 40))).toBe(false); // same slot
    const status = scheduler.status(new Date(2026, 10, 8, 6, 0, 0));
    expect(status.lastRun).toMatchObject({
      slot: "2026-11-08 05:00",
      users: 2,
      links: 2,
      errors: [],
    });
    expect(new Date(status.nextRunAt!).getHours()).toBe(17);

    // Admin API: read, update, run now.
    const got = await (await app.request("/api/server/sync-schedule", { headers: json })).json();
    expect(got.config).toEqual({ enabled: true, times: ["05:23", "17:35"] });
    const put = await app.request("/api/server/sync-schedule", {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ enabled: false, times: ["6:30"] }),
    });
    expect((await put.json()).config).toEqual({ enabled: false, times: ["06:30"] });
    expect(await scheduler.tick(new Date(2026, 10, 8, 6, 30, 0))).toBe(false);
    const run = await (
      await app.request("/api/server/sync-schedule/run", { method: "POST", headers: json })
    ).json();
    expect(run.run).toMatchObject({ slot: "manual", users: 2, links: 2 });
    // Members cannot touch it.
    expect((await app.request("/api/server/sync-schedule", { headers: sam })).status).toBe(403);
  });
});
