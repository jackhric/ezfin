import { describe, expect, it } from "vite-plus/test";
import { netWorth, summarizeByMonth, totalsByCategory } from "../src/summary.ts";
import type { Account, Transaction } from "../src/types.ts";

describe("summaries", () => {
  it("computes net worth from signed balances", () => {
    const accounts: Account[] = [
      {
        id: "a",
        name: "",
        institution: "",
        type: "checking",
        currency: "USD",
        balance: 1000,
        lastSyncedAt: "",
      },
      {
        id: "b",
        name: "",
        institution: "",
        type: "credit",
        currency: "USD",
        balance: -250.5,
        lastSyncedAt: "",
      },
    ];
    expect(netWorth(accounts)).toEqual({ assets: 1000, debts: 250.5, net: 749.5 });
  });

  it("excludes transfers and pending from spending", () => {
    const txs: Transaction[] = [
      {
        id: "1",
        accountId: "a",
        postedAt: "2026-03-01",
        amount: -50,
        description: "",
        merchant: "",
        categoryId: "groceries",
        pending: false,
      },
      {
        id: "2",
        accountId: "a",
        postedAt: "2026-03-02",
        amount: -500,
        description: "",
        merchant: "",
        categoryId: "transfer",
        pending: false,
      },
      {
        id: "3",
        accountId: "a",
        postedAt: "2026-03-03",
        amount: -20,
        description: "",
        merchant: "",
        categoryId: "dining",
        pending: true,
      },
      {
        id: "4",
        accountId: "a",
        postedAt: "2026-03-05",
        amount: 2000,
        description: "",
        merchant: "",
        categoryId: "income",
        pending: false,
      },
    ];
    const [m] = summarizeByMonth(txs);
    expect(m).toMatchObject({ month: "2026-03", income: 2000, spending: 50, net: 1950 });
    expect(totalsByCategory([m!])).toEqual([{ categoryId: "groceries", total: 50, count: 1 }]);
  });
});
