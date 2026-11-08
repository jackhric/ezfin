import { addDays, categorizeOne, toISODate, type Transaction } from "@ezfin/core";
import type { Db } from "./db.ts";
import type { Provider } from "./providers/types.ts";

export interface SyncResult {
  accounts: number;
  transactions: number;
  syncedAt: string;
}

/**
 * Pull from the provider, categorize locally, persist locally.
 * First sync fetches ~13 months; later syncs overlap the last 30 days to pick up
 * late-posting or de-pended transactions.
 */
export async function runSync(db: Db, provider: Provider): Promise<SyncResult> {
  const last = db.getSetting("lastSyncAt");
  const since = last ? addDays(last.slice(0, 10), -30) : addDays(toISODate(new Date()), -400);
  const { accounts, transactions } = await provider.fetch(since);
  const overrides = db.getOverrides();
  const categorized: Transaction[] = transactions.map((t) => ({
    ...t,
    categoryId: categorizeOne(t, { overrides }),
  }));
  db.upsertAccounts(accounts);
  db.upsertTransactions(categorized);
  const syncedAt = new Date().toISOString();
  db.setSetting("lastSyncAt", syncedAt);
  return { accounts: accounts.length, transactions: categorized.length, syncedAt };
}
