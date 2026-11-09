import { describe, expect, it, vi } from "vite-plus/test";
import { openDb } from "../src/db/index.ts";
import { MockProvider } from "../src/providers/mock.ts";
import { SimpleFinProvider } from "../src/providers/simplefin.ts";
import { nextRun, SyncScheduler, validTimes } from "../src/scheduler.ts";
import { MemorySecretStore } from "../src/secrets.ts";
import { HOST, makeApp, type Json } from "./helpers.ts";

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

    expect(await scheduler.tick(new Date(2026, 10, 8, 5, 22, 0))).toBe(false);
    expect(await scheduler.tick(new Date(2026, 10, 8, 5, 23, 10))).toBe(true);
    expect(await scheduler.tick(new Date(2026, 10, 8, 5, 23, 40))).toBe(false); // same slot
    const status = scheduler.status(new Date(2026, 10, 8, 6, 0, 0));
    expect(status.lastRun).toMatchObject({
      slot: "2026-11-08 05:23",
      users: 2,
      links: 2,
      errors: [],
    });
    expect(new Date(status.nextRunAt!).getHours()).toBe(17);

    // Admin API: read, update, run now.
    const got = await ((
      await app.request("/api/server/sync-schedule", { headers: json })
    ).json() as Promise<Json>);
    expect(got.config).toEqual({ enabled: true, times: ["05:23", "17:35"] });
    const put = await app.request("/api/server/sync-schedule", {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ enabled: false, times: ["6:30"] }),
    });
    expect((await (put.json() as Promise<Json>)).config).toEqual({
      enabled: false,
      times: ["06:30"],
    });
    expect(await scheduler.tick(new Date(2026, 10, 8, 6, 30, 0))).toBe(false);
    const run = await ((
      await app.request("/api/server/sync-schedule/run", { method: "POST", headers: json })
    ).json() as Promise<Json>);
    expect(run.run).toMatchObject({ slot: "manual", users: 2, links: 2 });
    // Members cannot touch it.
    expect((await app.request("/api/server/sync-schedule", { headers: sam })).status).toBe(403);
  });

  it("start() polls the clock and fires when a slot arrives; stop() clears the timer", async () => {
    const db = openDb(":memory:");
    const scheduler = new SyncScheduler(db, {
      providers: { demo: new MockProvider(3), simplefin: new SimpleFinProvider() },
      secrets: new MemorySecretStore(),
      minConfidence: 0.6,
    });
    // One user with a demo link, created before the clock is faked (scrypt is not timer based).
    const { userId } = await makeApp({ db });

    vi.useFakeTimers({ now: new Date(2026, 10, 8, 5, 22, 50) });
    try {
      scheduler.start(30_000);
      expect(scheduler.status().lastRun).toBeNull();
      // 05:23:20 lands on the default 05:23 slot.
      await vi.advanceTimersByTimeAsync(30_000);
      const run = scheduler.status().lastRun;
      expect(run).toMatchObject({ slot: "2026-11-08 05:23", users: 1, links: 1, errors: [] });
      expect(db.listLinks(userId)[0]!.lastSyncedAt).not.toBeNull();

      // Still inside the same slot: no second run.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(scheduler.status().lastRun?.startedAt).toBe(run!.startedAt);

      scheduler.stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
