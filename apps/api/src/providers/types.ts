import type { Account, Transaction } from "@ezfin/core";

/**
 * A provider pulls read-only account and transaction data from somewhere.
 * It never receives the database and never writes anywhere: the sync layer
 * owns persistence. Add a new bank aggregator by implementing this interface.
 */
export interface Provider {
  readonly id: "mock" | "simplefin";
  /** Human-readable status for the Settings page. Must never include secrets. */
  describe(): Promise<ProviderStatus>;
  /** Fetch everything since `sinceISO` (inclusive). Transactions may arrive uncategorized. */
  fetch(
    sinceISO: string,
  ): Promise<{ accounts: Account[]; transactions: Omit<Transaction, "categoryId">[] }>;
}

export interface ProviderStatus {
  id: Provider["id"];
  connected: boolean;
  label: string;
  detail?: string;
}
