import type { Account, Transaction } from "@ezfin/core";

/**
 * A provider pulls read-only account and transaction data from somewhere.
 * It never receives the database and never writes anywhere: the sync layer
 * owns persistence. Add a new bank aggregator by implementing this interface.
 */
export interface Provider {
  readonly id: "demo" | "simplefin";
  /**
   * Fetch everything since `sinceISO` (inclusive) using the link's stored secret
   * (undefined for providers that need none). Transactions may arrive uncategorized.
   */
  fetch(sinceISO: string, secret: string | undefined): Promise<ProviderFetch>;
}

export interface ProviderFetch {
  accounts: Account[];
  transactions: Omit<Transaction, "categoryId">[];
  /** Non-fatal messages from the provider that the user should see (e.g. a bank needs re-login). */
  warnings?: string[];
}
