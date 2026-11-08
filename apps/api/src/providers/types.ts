import type { Account, Transaction } from "@ezfin/core";

/**
 * A provider pulls read-only account and transaction data from somewhere.
 * It never receives the database and never writes anywhere: the sync layer
 * owns persistence. Add a new bank aggregator by implementing this interface.
 */
export interface Provider {
  readonly id: "mock" | "simplefin";
  /** Human-readable status for the Settings page. Must never include secrets. */
  describe(userId: string): Promise<ProviderStatus>;
  /** Fetch everything since `sinceISO` (inclusive) for one user. Transactions may arrive uncategorized. */
  fetch(sinceISO: string, userId: string): Promise<ProviderFetch>;
}

export interface ProviderFetch {
  accounts: Account[];
  transactions: Omit<Transaction, "categoryId">[];
  /** Non-fatal messages from the provider that the user should see (e.g. a bank needs re-login). */
  warnings?: string[];
}

export interface ProviderStatus {
  id: Provider["id"];
  connected: boolean;
  label: string;
  detail?: string;
}
