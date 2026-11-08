import { NON_SPEND_CATEGORIES } from "./categories.ts";
import { monthKey, round2 } from "./dates.ts";
import type { Account, CategoryTotal, MonthSummary, Transaction } from "./types.ts";

/** Net worth = assets minus debts. Credit/loan balances are stored negative so a plain sum works. */
export function netWorth(accounts: Account[]): { assets: number; debts: number; net: number } {
  let assets = 0;
  let debts = 0;
  for (const a of accounts) {
    if (a.balance >= 0) assets += a.balance;
    else debts += -a.balance;
  }
  return { assets: round2(assets), debts: round2(debts), net: round2(assets - debts) };
}

/** Summaries for every month present in the data, oldest first. */
export function summarizeByMonth(transactions: Transaction[]): MonthSummary[] {
  const months = new Map<
    string,
    { income: number; spending: number; cats: Map<string, CategoryTotal> }
  >();
  for (const t of transactions) {
    if (t.pending) continue;
    if (NON_SPEND_CATEGORIES.has(t.categoryId)) continue;
    const key = monthKey(t.postedAt);
    let m = months.get(key);
    if (!m) {
      m = { income: 0, spending: 0, cats: new Map() };
      months.set(key, m);
    }
    if (t.amount > 0) {
      m.income += t.amount;
    } else {
      m.spending += -t.amount;
      const c = m.cats.get(t.categoryId) ?? { categoryId: t.categoryId, total: 0, count: 0 };
      c.total += -t.amount;
      c.count += 1;
      m.cats.set(t.categoryId, c);
    }
  }
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, m]) => ({
      month,
      income: round2(m.income),
      spending: round2(m.spending),
      net: round2(m.income - m.spending),
      byCategory: [...m.cats.values()]
        .map((c) => ({ ...c, total: round2(c.total) }))
        .sort((a, b) => b.total - a.total),
    }));
}

/** Spending by category over a set of months, largest first. */
export function totalsByCategory(summaries: MonthSummary[]): CategoryTotal[] {
  const acc = new Map<string, CategoryTotal>();
  for (const s of summaries) {
    for (const c of s.byCategory) {
      const cur = acc.get(c.categoryId) ?? { categoryId: c.categoryId, total: 0, count: 0 };
      cur.total += c.total;
      cur.count += c.count;
      acc.set(c.categoryId, cur);
    }
  }
  return [...acc.values()]
    .map((c) => ({ ...c, total: round2(c.total) }))
    .sort((a, b) => b.total - a.total);
}
