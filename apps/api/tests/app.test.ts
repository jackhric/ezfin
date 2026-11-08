import { describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { MockProvider } from "../src/providers/mock.ts";
import { dateWindows, mapResponse } from "../src/providers/simplefin.ts";

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
  it("maps a v2 account set, resolving the institution through connections", () => {
    const { accounts, transactions, warnings } = mapResponse({
      errlist: [{ code: "con.auth", msg: "Please log in to Demo Bank again", conn_id: "c1" }],
      connections: [
        { conn_id: "c1", name: "Demo Bank", org_id: "demo", sfin_url: "https://x/simplefin" },
      ],
      accounts: [
        {
          id: "ACT-1",
          name: "Sapphire Visa",
          conn_id: "c1",
          currency: "USD",
          balance: "-432.10",
          "balance-date": 1760000000,
          transactions: [
            {
              id: "T1",
              posted: 1759968000,
              amount: "-15.49",
              description: "NETFLIX.COM",
              pending: false,
            },
            {
              id: "T2",
              posted: 0,
              transacted_at: 1759968000,
              amount: "-3.00",
              description: "COFFEE",
              pending: true,
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
    expect(transactions[1]).toMatchObject({ pending: true, postedAt: "2025-10-09" });
    expect(warnings).toEqual(["con.auth: Please log in to Demo Bank again"]);
  });

  it("still maps a v1 account set with org and errors", () => {
    const { accounts, warnings } = mapResponse({
      errors: ["Demo Bank needs attention"],
      accounts: [
        {
          id: "A",
          name: "Checking",
          currency: "USD",
          balance: "10.00",
          "balance-date": 1,
          org: { name: "Demo Bank" },
          transactions: [],
        },
      ],
    });
    expect(accounts[0]!.institution).toBe("Demo Bank");
    expect(warnings).toEqual(["Demo Bank needs attention"]);
  });

  it("splits history into windows of at most 90 days", () => {
    const w = dateWindows("2025-10-05", "2026-11-08", 90);
    expect(w.length).toBe(5);
    expect(w[0]).toEqual(["2025-10-05", "2026-01-02"]);
    expect(w[1]![0]).toBe("2026-01-03");
    expect(w[w.length - 1]![1]).toBe("2026-11-08");
    expect(dateWindows("2026-11-01", "2026-11-08", 90)).toEqual([["2026-11-01", "2026-11-08"]]);
  });
});
