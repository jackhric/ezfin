import { describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { hashPassword, validateCredentials, verifyPassword } from "../src/auth.ts";
import { openDb } from "../src/db.ts";
import { MockProvider } from "../src/providers/mock.ts";
import { SimpleFinProvider } from "../src/providers/simplefin.ts";
import { MemorySecretStore } from "../src/secrets.ts";
import { HOST, makeApp } from "./helpers.ts";

const JSON_HOST = { ...HOST, "content-type": "application/json" };

describe("passwords", () => {
  it("hashes with scrypt and verifies in constant time", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });

  it("validates sign-up input", () => {
    expect(
      validateCredentials({ username: "ab", email: "a@b.co", password: "long enough pw" }),
    ).toMatchObject({ ok: false });
    expect(
      validateCredentials({ username: "jack", email: "nope", password: "long enough pw" }),
    ).toMatchObject({ ok: false });
    expect(
      validateCredentials({ username: "jack", email: "a@b.co", password: "short" }),
    ).toMatchObject({ ok: false });
    expect(
      validateCredentials({ username: " jack ", email: "a@b.co", password: "long enough pw" }),
    ).toMatchObject({ ok: true, username: "jack" });
  });
});

describe("accounts and sessions", () => {
  it("requires setup first, then protects every financial route", async () => {
    const app = createApp({
      db: openDb(":memory:"),
      providers: { demo: new MockProvider(3), simplefin: new SimpleFinProvider() },
      secrets: new MemorySecretStore(),
    });
    const status = await (await app.request("/api/auth/status", { headers: HOST })).json();
    expect(status).toEqual({ setupRequired: true, user: null });
    expect((await app.request("/api/summary", { headers: HOST })).status).toBe(401);
    expect((await app.request("/api/transactions", { headers: HOST })).status).toBe(401);
  });

  it("setup signs in, demo link imports accounts for that user, and refuses a second setup", async () => {
    const { app, headers, userId, db } = await makeApp();
    const me = await (await app.request("/api/me", { headers })).json();
    expect(me.user).toMatchObject({ username: "jack", email: "jack@example.com" });
    expect(me.user.passwordHash).toBeUndefined();
    expect(me.accounts).toHaveLength(3);
    expect(db.listTransactions(userId).length).toBeGreaterThan(500);

    const again = await app.request("/api/auth/setup", {
      method: "POST",
      headers: JSON_HOST,
      body: JSON.stringify({
        username: "mallory",
        email: "m@example.com",
        password: "long enough pw",
      }),
    });
    expect(again.status).toBe(409);
  });

  it("logs in and out, and rejects bad passwords", async () => {
    const { app } = await makeApp();
    const bad = await app.request("/api/auth/login", {
      method: "POST",
      headers: JSON_HOST,
      body: JSON.stringify({ username: "jack", password: "nope" }),
    });
    expect(bad.status).toBe(401);
    const good = await app.request("/api/auth/login", {
      method: "POST",
      headers: JSON_HOST,
      body: JSON.stringify({ username: "JACK", password: "correct horse battery" }),
    });
    expect(good.status).toBe(200);
    const cookie = good.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    const session = { ...HOST, cookie: cookie.split(";")[0]! };
    expect((await app.request("/api/me", { headers: session })).status).toBe(200);
    await app.request("/api/auth/logout", { method: "POST", headers: session });
    expect((await app.request("/api/me", { headers: session })).status).toBe(401);
  });

  it("keeps two users' financial accounts apart", async () => {
    const { app, headers, json, db } = await makeApp();
    const created = await app.request("/api/users", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        username: "sam",
        email: "sam@example.com",
        password: "another long pw",
      }),
    });
    expect(created.status).toBe(201);
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: JSON_HOST,
      body: JSON.stringify({ username: "sam", password: "another long pw" }),
    });
    const sam = { ...HOST, cookie: login.headers.get("set-cookie")!.split(";")[0]! };

    // Sam has nothing until they sync; Jack's data is invisible to Sam.
    expect((await (await app.request("/api/me", { headers: sam })).json()).accounts).toHaveLength(
      0,
    );
    expect((await (await app.request("/api/transactions", { headers: sam })).json()).total).toBe(0);
    const jackTx = db.listTransactions(db.getUserByUsername("jack")!.id)[0]!;
    const steal = await app.request(`/api/transactions/${jackTx.id}/category`, {
      method: "PATCH",
      headers: { ...sam, "content-type": "application/json" },
      body: JSON.stringify({ categoryId: "travel" }),
    });
    expect(steal.status).toBe(404);
    expect((await (await app.request("/api/me", { headers })).json()).accounts).toHaveLength(3);
  });
});
