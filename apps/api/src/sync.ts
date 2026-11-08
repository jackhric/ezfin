import { addDays, categorizeOne, toISODate, type Transaction } from "@ezfin/core";
import type { Db, Link } from "./db.ts";
import type { Provider, RequestBudget } from "./providers/types.ts";
import type { SecretStore } from "./secrets.ts";

export interface SyncResult {
  linkId: string;
  accounts: number;
  transactions: number;
  syncedAt: string;
  warnings: string[];
}

export interface SyncDeps {
  providers: Record<Link["provider"], Provider>;
  secrets: SecretStore;
  minConfidence: number;
  /** Max outbound requests per link in a rolling 24 hours. SimpleFIN expects 24 or fewer; default 16. */
  requestLimit?: number;
}

export const DEFAULT_REQUEST_LIMIT = 16;
export const BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Rolling-24-hour request budget for one link, backed by the provider_requests log. */
export function budgetFor(db: Db, linkId: string, limit: number): RequestBudget {
  const since = () => new Date(Date.now() - BUDGET_WINDOW_MS).toISOString();
  return {
    limit,
    get remaining() {
      return Math.max(0, limit - db.countRequests(linkId, since()));
    },
    spend() {
      db.recordRequest(linkId);
    },
  };
}

/**
 * Pull one link from its provider, categorize locally, persist locally.
 * First sync fetches ~13 months; later syncs overlap the last 30 days to pick up
 * late-posting or de-pended transactions. Account and transaction ids are
 * namespaced by link so two people linking the same bank never collide.
 */
export async function syncLink(db: Db, link: Link, deps: SyncDeps): Promise<SyncResult> {
  const since = link.lastSyncedAt
    ? addDays(link.lastSyncedAt.slice(0, 10), -30)
    : addDays(toISODate(new Date()), -400);
  const provider = deps.providers[link.provider];
  const {
    accounts,
    transactions,
    warnings = [],
  } = await provider.fetch(
    since,
    deps.secrets.get(link.id),
    budgetFor(db, link.id, deps.requestLimit ?? DEFAULT_REQUEST_LIMIT),
  );
  const ns = (id: string) => `${link.id}:${id}`;
  const overrides = db.getOverrides();
  const insights = db.getInsights();
  const categorized: Transaction[] = transactions.map((t) => ({
    ...t,
    id: ns(t.id),
    accountId: ns(t.accountId),
    categoryId: categorizeOne(t, { overrides, insights, minConfidence: deps.minConfidence }),
  }));
  db.upsertAccounts(
    link.userId,
    link.id,
    accounts.map((a) => ({ ...a, id: ns(a.id), linkId: link.id })),
  );
  db.upsertTransactions(link.userId, categorized);
  db.markLinkSynced(link.id, warnings);
  return {
    linkId: link.id,
    accounts: accounts.length,
    transactions: categorized.length,
    syncedAt: new Date().toISOString(),
    warnings,
  };
}

/** Sync every link a user has. A failing link does not stop the others. */
export async function syncUser(
  db: Db,
  userId: string,
  deps: SyncDeps,
): Promise<{ results: SyncResult[]; errors: { linkId: string; error: string }[] }> {
  const results: SyncResult[] = [];
  const errors: { linkId: string; error: string }[] = [];
  for (const link of db.listLinks(userId)) {
    try {
      results.push(await syncLink(db, link, deps));
    } catch (e) {
      errors.push({ linkId: link.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { results, errors };
}
