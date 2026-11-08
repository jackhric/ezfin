import { describe, expect, it, vi } from "vite-plus/test";
import { makeApp } from "./helpers.ts";

/** A fake SimpleFIN bridge: claim returns an access URL, /accounts returns one account. */
function fakeBridge() {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://bridge.example/claim/")) {
      expect(init?.method).toBe("POST");
      return new Response("https://user:pass@bridge.example/simplefin");
    }
    if (u.startsWith("https://bridge.example/simplefin/accounts")) {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(
        `Basic ${Buffer.from("user:pass").toString("base64")}`,
      );
      return new Response(
        JSON.stringify({
          errlist: [],
          connections: [
            {
              conn_id: "c1",
              name: "Example Bank",
              org_id: "ex",
              sfin_url: "https://bridge.example/simplefin",
            },
          ],
          accounts: [
            {
              id: "ACT-1",
              name: "Everyday Checking",
              conn_id: "c1",
              currency: "USD",
              balance: "1200.00",
              "balance-date": 1760000000,
              transactions: [
                { id: "T1", posted: 1759968000, amount: "-15.49", description: "NETFLIX.COM" },
              ],
            },
          ],
        }),
      );
    }
    throw new Error(`unexpected fetch ${u}`);
  });
}

describe("data-source links", () => {
  it("links SimpleFIN per user, imports all accounts, namespaces ids, and unlinks cleanly", async () => {
    const fetchMock = fakeBridge();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { app, headers, json, db, userId, secrets } = await makeApp({ noDemo: true });
      const token = Buffer.from("https://bridge.example/claim/ONE-TIME").toString("base64");
      const res = await app.request("/api/links/simplefin", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ setupToken: token }),
      });
      expect(res.status).toBe(201);
      const { link, result } = await res.json();
      expect(link.provider).toBe("simplefin");
      expect(link.label).toContain("bridge.example");
      expect(link.accounts).toHaveLength(1);
      expect(link.accounts[0].institution).toBe("Example Bank");
      expect(result.transactions).toBe(1);
      // The credential is in the secret store, not in the API response or the database.
      expect(secrets.get(link.id)).toBe("https://user:pass@bridge.example/simplefin");
      expect(JSON.stringify(link)).not.toContain("user:pass");
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM links WHERE id = ?").get(link.id)).toEqual({
        n: 1,
      });

      const me = await (await app.request("/api/me", { headers })).json();
      expect(me.accounts[0].id).toBe(`${link.id}:ACT-1`);
      expect(me.accounts[0].linkId).toBe(link.id);
      const txs = db.listTransactions(userId);
      expect(txs[0]!.id).toBe(`${link.id}:ACT-1:T1`);
      expect(txs[0]!.categoryId).toBe("subscriptions");

      // Sync again: the same window overlap, no duplicates.
      expect(
        (await app.request(`/api/links/${link.id}/sync`, { method: "POST", headers })).status,
      ).toBe(200);
      expect(db.listTransactions(userId)).toHaveLength(1);

      // Unlink removes accounts, transactions and the secret.
      expect(
        (await app.request(`/api/links/${link.id}`, { method: "DELETE", headers })).status,
      ).toBe(200);
      expect(db.listAccounts(userId)).toHaveLength(0);
      expect(db.listTransactions(userId)).toHaveLength(0);
      expect(secrets.get(link.id)).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps a failed first sync as a retryable link and reports the error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes("/claim/"))
          return new Response("https://user:pass@bridge.example/simplefin");
        return new Response("nope", { status: 403 });
      }),
    );
    try {
      const { app, json, headers } = await makeApp({ noDemo: true });
      const token = Buffer.from("https://bridge.example/claim/X").toString("base64");
      const res = await app.request("/api/links/simplefin", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ setupToken: token }),
      });
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toMatch(/403/);
      expect((await (await app.request("/api/links", { headers })).json()).links).toHaveLength(1);
      const all = await app.request("/api/sync", { method: "POST", headers });
      expect(all.status).toBe(502);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("demo data can be linked once per user and two users do not share it", async () => {
    const { app, json, headers } = await makeApp();
    expect((await app.request("/api/links/demo", { method: "POST", headers: json })).status).toBe(
      409,
    );
    const status = await (await app.request("/api/status", { headers })).json();
    expect(status).toMatchObject({ links: 1, demoOnly: true, accounts: 3 });
    expect(status.lastSyncAt).toBeTruthy();
  });
});
