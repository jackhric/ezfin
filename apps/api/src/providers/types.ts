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
  fetch(
    sinceISO: string,
    secret: string | undefined,
    budget: RequestBudget,
  ): Promise<ProviderFetch>;
}

/**
 * How many outbound requests a provider may still make for this link. The
 * provider must check `remaining` before starting and call `spend()` for every
 * request it actually sends, so the app can stay under the aggregator's quota.
 */
export interface RequestBudget {
  readonly limit: number;
  readonly remaining: number;
  spend(): void;
}

export class BudgetExceededError extends Error {
  constructor(needed: number, remaining: number, limit: number) {
    super(
      `This sync needs ${needed} request${needed === 1 ? "" : "s"} to SimpleFIN but only ${remaining} of ${limit} remain in the last 24 hours. Try again later.`,
    );
    this.name = "BudgetExceededError";
  }
}

export interface ProviderFetch {
  accounts: Account[];
  transactions: Omit<Transaction, "categoryId">[];
  /** Non-fatal messages from the provider that the user should see (e.g. a bank needs re-login). */
  warnings?: string[];
}
