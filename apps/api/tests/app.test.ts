import { describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { MockProvider } from "../src/providers/mock.ts";
import { mapResponse } from "../src/providers/simplefin.ts";

const headers = { host: "127.0.0.1:8787" };

async function makeApp() {
  const db = openDb(":memory:");
  const app = createApp({ db, provider: new MockProvider(3) });
  await app.request("/api/sync", { method: "POST", headers });
  return { app, db };
}

describe("api", () => {
  it("refuses non-local hosts", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/status", { headers: { host: "evil.example" } });
    expect(res.status).toBe(403);
  });

  it("syncs demo data and serves summaries", async () => {
    const { app } = await makeApp();
    const status = await (await app.request("/api/status", { headers })).json();
    expect(status.accounts).toBe(3);
    expect(status.transactions).toBeGreaterThan(500);

    const summary = await (await app.request("/api/summary?months=6", { headers })).json();
    expect(summary.months.length).toBeGreaterThan(0);
    expect(summary.netWorth.net).toBeTypeOf("number");

    const rec = await (await app.request("/api/recurring", { headers })).json();
    expect(rec.series.map((s: { merchant: string }) => s.merchant)).toContain("netflix");
    expect(rec.monthlyTotal).toBeGreaterThan(0);
  });

  it("learns merchant rules and survives re-sync", async () => {
    const { app, db } = await makeApp();
    const tx = db.listTransactions({ q: "COSTCO WHSE" })[0]!;
    expect(tx.categoryId).toBe("groceries");
    const res = await app.request(`/api/transactions/${tx.id}/category`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ categoryId: "shopping", applyToMerchant: true }),
    });
    const body = await res.json();
    expect(body.transaction.categoryId).toBe("shopping");
    expect(body.recategorized).toBeGreaterThan(0);
    // Re-sync must keep the user's choice.
    await app.request("/api/sync", { method: "POST", headers });
    expect(
      db.listTransactions({ q: "COSTCO WHSE" }).every((t) => t.categoryId === "shopping"),
    ).toBe(true);
  });

  it("rejects simplefin connect in mock mode", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/connect/simplefin", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ setupToken: "abc" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("simplefin mapping", () => {
  it("maps bridge payloads to domain types", () => {
    const { accounts, transactions } = mapResponse({
      accounts: [
        {
          id: "ACT-1",
          name: "Sapphire Visa",
          currency: "USD",
          balance: "-432.10",
          "balance-date": 1760000000,
          org: { name: "Demo Bank" },
          transactions: [
            {
              id: "T1",
              posted: 1759968000,
              amount: "-15.49",
              description: "NETFLIX.COM",
              pending: false,
            },
          ],
        },
      ],
    });
    expect(accounts[0]).toMatchObject({
      type: "credit",
      institution: "Demo Bank",
      balance: -432.1,
    });
    expect(transactions[0]).toMatchObject({
      id: "ACT-1:T1",
      amount: -15.49,
      merchant: "netflix",
      postedAt: "2025-10-09",
    });
  });
});
