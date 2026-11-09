import type { Account, Transaction } from "@ezfin/core";
import type { Link, User } from "./index.ts";

/* Raw SQLite rows (snake_case) and the mappers to the camelCase types the app uses. */

export type UserRow = {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  role: string;
  created_at: string;
};
export const toUser = (r: UserRow): User => ({
  id: r.id,
  username: r.username,
  email: r.email,
  role: r.role === "admin" ? "admin" : "member",
  createdAt: r.created_at,
});

export type LinkRow = {
  id: string;
  user_id: string;
  provider: string;
  label: string;
  created_at: string;
  last_synced_at: string | null;
  warnings: string;
};
export const toLink = (r: LinkRow): Link => ({
  id: r.id,
  userId: r.user_id,
  provider: r.provider === "simplefin" ? "simplefin" : "demo",
  label: r.label,
  createdAt: r.created_at,
  lastSyncedAt: r.last_synced_at,
  warnings: JSON.parse(r.warnings) as string[],
});

export type AccountRow = {
  id: string;
  link_id: string;
  name: string;
  institution: string;
  type: string;
  currency: string;
  balance: number;
  available_balance: number | null;
  last_synced_at: string;
};
export const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  linkId: r.link_id,
  name: r.name,
  institution: r.institution,
  type: r.type as Account["type"],
  currency: r.currency,
  balance: r.balance,
  availableBalance: r.available_balance ?? undefined,
  lastSyncedAt: r.last_synced_at,
});

export type TxRow = {
  id: string;
  account_id: string;
  posted_at: string;
  amount: number;
  description: string;
  merchant: string;
  category_id: string;
  pending: number;
  user_categorized: number;
};
export const toTx = (r: TxRow): Transaction => ({
  id: r.id,
  accountId: r.account_id,
  postedAt: r.posted_at,
  amount: r.amount,
  description: r.description,
  merchant: r.merchant,
  categoryId: r.category_id,
  pending: r.pending === 1,
});
