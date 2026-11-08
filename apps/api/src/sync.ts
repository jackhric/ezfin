import { addDays, categorizeOne, toISODate, type Transaction } from "@ezfin/core";
import type { Db } from "./db.ts";
import type { Provider } from "./providers/types.ts";

export interface SyncResult {
  accounts: number;
  transactions: number;
  syncedAt: string;
  warnings: string[];
}

/**
 * Pull from the provider, categorize locally, persist locally.
 * First sync fetches ~13 months; later syncs overlap the last 30 days to pick up
 * late-posting or de-pended transactions.
 */
export async function runSync(
  db: Db,
  provider: Provider,
  userId: string,
  minConfidence = 0.6,
): Promise<SyncResult> {
  const last = db.getSetting(`lastSyncAt:${userId}`);
  const since = last ? addDays(last.slice(0, 10), -30) : addDays(toISODate(new Date()), -400);
  const { accounts, transactions, warnings = [] } = await provider.fetch(since, userId);
  const overrides = db.getOverrides();
  const insights = db.getInsights();
  const categorized: Transaction[] = transactions.map((t) => ({
    ...t,
    categoryId: categorizeOne(t, { overrides, insights, minConfidence }),
  }));
  db.upsertAccounts(userId, accounts);
  db.upsertTransactions(userId, categorized);
  const syncedAt = new Date().toISOString();
  db.setSetting(`lastSyncAt:${userId}`, syncedAt);
  db.setSetting(`lastSyncWarnings:${userId}`, JSON.stringify(warnings));
  return { accounts: accounts.length, transactions: categorized.length, syncedAt, warnings };
}
