import { expect } from "vite-plus/test";
import { createApp, type AppDeps } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { MockProvider } from "../src/providers/mock.ts";
import { SimpleFinProvider } from "../src/providers/simplefin.ts";
import { MemorySecretStore } from "../src/secrets.ts";

export const HOST = { host: "127.0.0.1:8787" };

/** An app with one user set up, signed in, and demo data linked. Returns headers that carry the session cookie. */
export async function makeApp(extra: Partial<AppDeps> & { noDemo?: boolean } = {}) {
  const db = extra.db ?? openDb(":memory:");
  const secrets = extra.secrets ?? new MemorySecretStore();
  const app = createApp({
    db,
    providers: extra.providers ?? { demo: new MockProvider(3), simplefin: new SimpleFinProvider() },
    secrets,
    ai: extra.ai,
  });
  const res = await app.request("/api/auth/setup", {
    method: "POST",
    headers: { ...HOST, "content-type": "application/json" },
    body: JSON.stringify({
      username: "jack",
      email: "jack@example.com",
      password: "correct horse battery",
    }),
  });
  expect(res.status).toBe(201);
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  const headers = { ...HOST, cookie };
  const json = { ...headers, "content-type": "application/json" };
  const user = db.getUserByUsername("jack")!;
  if (!extra.noDemo) {
    const demo = await app.request("/api/links/demo", { method: "POST", headers: json });
    expect(demo.status).toBe(201);
  }
  return { app, db, headers, json, userId: user.id, secrets };
}
