export type AccountType = "checking" | "savings" | "credit" | "investment" | "loan" | "other";

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: AccountType;
  currency: string;
  /** Current balance. Positive for assets, negative for debts (credit cards, loans). */
  balance: number;
  availableBalance?: number;
  /** ISO timestamp of the last successful sync. */
  lastSyncedAt: string;
  /** The data-source link this account was imported through. */
  linkId?: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  /** ISO date (YYYY-MM-DD) the transaction posted. */
  postedAt: string;
  /** Negative = money out, positive = money in. */
  amount: number;
  /** Raw description as the bank reported it. */
  description: string;
  /** Normalized merchant name derived from the description. */
  merchant: string;
  categoryId: string;
  pending: boolean;
  /** Plain-English description of the merchant from the local AI pass, when available. */
  merchantLabel?: string;
}

export type CategoryGroup =
  | "essentials"
  | "lifestyle"
  | "financial"
  | "income"
  | "transfer"
  | "uncategorized";

export interface Category {
  id: string;
  name: string;
  group: CategoryGroup;
  /** One-line definition, used both in the UI and in the local model's prompt. */
  description: string;
}

/** What a local model concluded about a merchant key. */
export interface MerchantInsight {
  merchant: string;
  categoryId: string;
  /** Short plain-English description of the merchant, e.g. "ramen restaurant". */
  label: string;
  /** 0..1 */
  confidence: number;
}

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";

export interface RecurringSeries {
  id: string;
  merchant: string;
  categoryId: string;
  cadence: Cadence;
  /** Typical charge (median absolute amount). */
  typicalAmount: number;
  /** Normalized to a per-month cost regardless of cadence. */
  monthlyEquivalent: number;
  /** True when amounts vary (utilities), false for fixed subscriptions. */
  variableAmount: boolean;
  /** 0..1 */
  confidence: number;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  nextExpected: string;
  /** True when the last charge is overdue by more than one interval. */
  possiblyCancelled: boolean;
  transactionIds: string[];
}

export interface CategoryTotal {
  categoryId: string;
  total: number;
  count: number;
}

export interface MonthSummary {
  /** YYYY-MM */
  month: string;
  income: number;
  spending: number;
  net: number;
  byCategory: CategoryTotal[];
}
