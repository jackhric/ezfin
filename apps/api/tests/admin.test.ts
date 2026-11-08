import { describe, expect, it } from "vite-plus/test";
import { HOST, makeApp } from "./helpers.ts";

const JSON_HOST = { ...HOST, "content-type": "application/json" };

async function loginAs(
  app: Awaited<ReturnType<typeof makeApp>>["app"],
  username: string,
  password: string,
) {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: JSON_HOST,
    body: JSON.stringify({ username, password }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  return {
    headers: { ...HOST, cookie },
    json: { ...HOST, cookie, "content-type": "application/json" },
  };
}

describe("account settings", () => {
  it("edits profile, changes password, and signs out other sessions", async () => {
    const { app, headers, json } = await makeApp();
    const other = await loginAs(app, "jack", "correct horse battery");

    const patched = await (
      await app.request("/api/me", {
        method: "PATCH",
        headers: json,
        body: JSON.stringify({ email: "new@example.com" }),
      })
    ).json();
    expect(patched.user.email).toBe("new@example.com");
    expect(patched.user.passwordHash).toBeUndefined();

    const wrong = await app.request("/api/me/password", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ current: "nope", next: "a brand new passphrase" }),
    });
    expect(wrong.status).toBe(400);
    const ok = await app.request("/api/me/password", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ current: "correct horse battery", next: "a brand new passphrase" }),
    });
    expect(ok.status).toBe(200);
    // The session that changed the password survives; the other one is gone.
    expect((await app.request("/api/me", { headers })).status).toBe(200);
    expect((await app.request("/api/me", { headers: other.headers })).status).toBe(401);
    await loginAs(app, "jack", "a brand new passphrase");
  });
});

describe("server administration", () => {
  it("first user is admin and sees server info; members are refused", async () => {
    const { app, headers, json } = await makeApp();
    const info = await (await app.request("/api/server/info", { headers })).json();
    expect(info).toMatchObject({ version: expect.any(String), users: 1, provider: "mock" });

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
    expect((await created.json()).user.role).toBe("member");
    const sam = await loginAs(app, "sam", "another long pw");
    expect((await app.request("/api/server/info", { headers: sam.headers })).status).toBe(403);
    expect((await app.request("/api/users", { headers: sam.headers })).status).toBe(403);
    // Sam can still manage their own profile.
    expect(
      (
        await app.request("/api/me", {
          method: "PATCH",
          headers: sam.json,
          body: JSON.stringify({ email: "s2@example.com" }),
        })
      ).status,
    ).toBe(200);
  });

  it("manages users: list, promote, reset password, delete, and never the last admin or yourself", async () => {
    const { app, headers, json, userId, db } = await makeApp();
    await app.request("/api/users", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        username: "sam",
        email: "sam@example.com",
        password: "another long pw",
      }),
    });
    const list = await (await app.request("/api/users", { headers })).json();
    expect(list.users.map((u: { username: string }) => u.username)).toEqual(["jack", "sam"]);
    const samId = list.users[1].id as string;

    // Cannot demote the only admin.
    expect(
      (
        await app.request(`/api/users/${userId}`, {
          method: "PATCH",
          headers: json,
          body: JSON.stringify({ role: "member" }),
        })
      ).status,
    ).toBe(400);
    // Promote sam, then demoting jack is fine.
    expect(
      (
        await app.request(`/api/users/${samId}`, {
          method: "PATCH",
          headers: json,
          body: JSON.stringify({ role: "admin" }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/users/${userId}`, {
          method: "PATCH",
          headers: json,
          body: JSON.stringify({ role: "member" }),
        })
      ).status,
    ).toBe(200);
    expect(db.getUserById(userId)!.role).toBe("member");
    // Jack is no longer admin, so user routes are refused now.
    expect((await app.request("/api/users", { headers })).status).toBe(403);

    const sam = await loginAs(app, "sam", "another long pw");
    const reset = await app.request(`/api/users/${userId}/password`, {
      method: "POST",
      headers: sam.json,
      body: JSON.stringify({ password: "reset by the admin" }),
    });
    expect(reset.status).toBe(200);
    expect((await app.request("/api/me", { headers })).status).toBe(401);
    await loginAs(app, "jack", "reset by the admin");

    expect(
      (await app.request(`/api/users/${samId}`, { method: "DELETE", headers: sam.headers })).status,
    ).toBe(400);
    expect(
      (await app.request(`/api/users/${userId}`, { method: "DELETE", headers: sam.headers }))
        .status,
    ).toBe(200);
    expect(db.getUserById(userId)).toBeUndefined();
    expect(db.listTransactions(userId).length).toBe(0);
  });
});
