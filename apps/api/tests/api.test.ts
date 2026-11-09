import { describe, expect, it } from "vite-plus/test";
import { makeApp, type Json } from "./helpers.ts";

describe("api", () => {
  it("refuses non-local hosts", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/auth/status", { headers: { host: "evil.example" } });
    expect(res.status).toBe(403);
  });

  it("syncs demo data and serves summaries", async () => {
    const { app, headers } = await makeApp();
    const status = await ((await app.request("/api/status", { headers })).json() as Promise<Json>);
    expect(status.accounts).toBe(3);
    expect(status.transactions).toBeGreaterThan(500);

    const summary = await ((
      await app.request("/api/summary?months=6", { headers })
    ).json() as Promise<Json>);
    expect(summary.months.length).toBeGreaterThan(0);
    expect(summary.netWorth.net).toBeTypeOf("number");

    const rec = await ((await app.request("/api/recurring", { headers })).json() as Promise<Json>);
    expect(rec.series.map((s: { merchant: string }) => s.merchant)).toContain("netflix");
    expect(rec.monthlyTotal).toBeGreaterThan(0);
  });

  it("learns merchant rules and survives re-sync", async () => {
    const { app, db, headers, json, userId } = await makeApp();
    const tx = db.listTransactions(userId, { q: "COSTCO WHSE" })[0]!;
    expect(tx.categoryId).toBe("groceries");
    const res = await app.request(`/api/transactions/${tx.id}/category`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ categoryId: "shopping", applyToMerchant: true }),
    });
    const body = await (res.json() as Promise<Json>);
    expect(body.transaction.categoryId).toBe("shopping");
    expect(body.recategorized).toBeGreaterThan(0);
    // Re-sync must keep the user's choice.
    await app.request("/api/sync", { method: "POST", headers });
    expect(
      db.listTransactions(userId, { q: "COSTCO WHSE" }).every((t) => t.categoryId === "shopping"),
    ).toBe(true);
  });

  it("rejects a malformed simplefin setup token without creating a link", async () => {
    const { app, json, headers } = await makeApp();
    const res = await app.request("/api/links/simplefin", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        setupToken: Buffer.from("http://not-https.example/claim").toString("base64"),
      }),
    });
    expect(res.status).toBe(502);
    const links = await ((await app.request("/api/links", { headers })).json() as Promise<Json>);
    expect(links.links.map((l: { provider: string }) => l.provider)).toEqual(["demo"]);
  });
});
