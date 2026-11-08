import { describe, expect, it } from "vite-plus/test";
import { categorizeAll } from "../src/categorize.ts";
import { detectRecurring } from "../src/recurring.ts";
import { generateSynthetic } from "../src/synthetic.ts";
import type { Transaction } from "../src/types.ts";

function series(
  desc: string,
  amounts: number[],
  dates: string[],
  categoryId = "subscriptions",
): Transaction[] {
  return dates.map((d, i) => ({
    id: `${desc}-${i}`,
    accountId: "a",
    postedAt: d,
    amount: -amounts[i % amounts.length]!,
    description: desc,
    merchant: desc.toLowerCase(),
    categoryId,
    pending: false,
  }));
}

describe("detectRecurring", () => {
  it("finds a fixed monthly subscription with posting jitter", () => {
    const txs = series(
      "netflix",
      [15.49],
      ["2026-01-03", "2026-02-04", "2026-03-03", "2026-04-05", "2026-05-03"],
    );
    const [s] = detectRecurring(txs, { today: "2026-05-20" });
    expect(s).toBeDefined();
    expect(s!.cadence).toBe("monthly");
    expect(s!.typicalAmount).toBe(15.49);
    expect(s!.monthlyEquivalent).toBe(15.49);
    expect(s!.variableAmount).toBe(false);
    expect(s!.possiblyCancelled).toBe(false);
    expect(s!.nextExpected).toBe("2026-06-02");
    expect(s!.confidence).toBeGreaterThan(0.8);
  });

  it("flags variable-amount utilities and normalizes annual plans", () => {
    const util = series(
      "pg&e",
      [98, 140, 112, 155],
      ["2026-01-14", "2026-02-14", "2026-03-14", "2026-04-14"],
      "utilities",
    );
    const annual = series("1password", [35.88], ["2024-03-01", "2025-03-01", "2026-03-01"]);
    const res = detectRecurring([...util, ...annual], { today: "2026-04-20" });
    const u = res.find((r) => r.merchant === "pg&e")!;
    const a = res.find((r) => r.merchant === "1password")!;
    expect(u.variableAmount).toBe(true);
    expect(a.cadence).toBe("annual");
    expect(a.monthlyEquivalent).toBe(2.99);
  });

  it("marks series that stopped as possibly cancelled", () => {
    const txs = series("hulu", [17.99], ["2026-01-05", "2026-02-05", "2026-03-05"]);
    const [s] = detectRecurring(txs, { today: "2026-06-01" });
    expect(s!.possiblyCancelled).toBe(true);
  });

  it("ignores irregular merchants", () => {
    const txs = series(
      "coffee",
      [4, 6, 5, 7],
      ["2026-01-02", "2026-01-03", "2026-01-20", "2026-02-28"],
    );
    expect(detectRecurring(txs, { today: "2026-03-01" })).toHaveLength(0);
  });

  it("recovers the planted subscriptions from synthetic data", () => {
    const { transactions } = generateSynthetic({ seed: 7, days: 365, endDate: "2026-11-01" });
    const categorized = categorizeAll(transactions);
    const found = detectRecurring(categorized, { today: "2026-11-01" });
    const merchants = new Set(found.map((f) => f.merchant));
    expect(merchants).toContain("netflix");
    expect(merchants).toContain("spotify usa");
    expect(merchants).toContain("planet fitness");
    expect(merchants).toContain("t mobile autopay");
    const hulu = found.find((f) => f.merchant.startsWith("hulu"));
    expect(hulu?.possiblyCancelled).toBe(true);
    // No day-to-day spending should be mistaken for a subscription.
    expect(merchants.has("trader joe s")).toBe(false);
  });
});
