import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { Account, MerchantInsight, Transaction } from "@ezfin/core";
import { insightsSlice } from "./insights.ts";
import { ledgerSlice } from "./ledger.ts";
import { linksSlice } from "./links.ts";
import { migrate } from "./schema.ts";
import { settingsSlice } from "./settings.ts";
import { usersSlice } from "./users.ts";

export type Role = "admin" | "member";

export interface User {
  id: string;
  username: string;
  email: string;
  role: Role;
  createdAt: string;
}

export type LinkProvider = "simplefin" | "demo";

export interface Link {
  id: string;
  userId: string;
  provider: LinkProvider;
  label: string;
  createdAt: string;
  lastSyncedAt: string | null;
  warnings: string[];
}

export interface Db {
  raw: DatabaseSync;
  /* ---- data-source links (one person can have several) ---- */
  listLinks(userId: string): Link[];
  /** Every link on the install, for the scheduler. */
  listAllLinks(): Link[];
  /** Count of outbound provider requests for a link since `sinceISO`. */
  countRequests(linkId: string, sinceISO: string): number;
  recordRequest(linkId: string): void;
  getLink(userId: string, id: string): Link | undefined;
  createLink(userId: string, provider: LinkProvider, label: string): Link;
  markLinkSynced(id: string, warnings: string[]): void;
  /** Removes the link and every account and transaction imported through it. */
  deleteLink(userId: string, id: string): void;
  /* ---- users and sessions ---- */
  countUsers(): number;
  listUsers(): (User & { accounts: number; lastSeenAt: string | null })[];
  createUser(u: { username: string; email: string; passwordHash: string; role: Role }): User;
  getUserByUsername(username: string): (User & { passwordHash: string }) | undefined;
  getUserById(id: string): (User & { passwordHash: string }) | undefined;
  updateUser(
    id: string,
    patch: { username?: string; email?: string; role?: Role },
  ): User | undefined;
  setPassword(id: string, passwordHash: string): void;
  /** Removes the user, their sessions, and all their financial data. */
  deleteUser(id: string): void;
  deleteSessionsForUser(userId: string, exceptTokenHash?: string): void;
  createSession(userId: string, tokenHash: string, expiresAt: string): void;
  getSessionUser(tokenHash: string): User | undefined;
  deleteSession(tokenHash: string): void;
  /* ---- financial data, always scoped to a user ---- */
  upsertAccounts(userId: string, linkId: string, accounts: Account[]): void;
  upsertTransactions(userId: string, txs: Transaction[]): void;
  listAccounts(userId: string): Account[];
  listTransactions(
    userId: string,
    filter?: { from?: string; to?: string; accountId?: string; categoryId?: string; q?: string },
  ): Transaction[];
  setCategory(userId: string, txId: string, categoryId: string): Transaction | undefined;
  getOverrides(): Map<string, string>;
  setOverride(merchant: string, categoryId: string): void;
  deleteOverride(merchant: string): void;
  recategorize(fn: (tx: Transaction) => string): number;
  getInsights(): Map<string, MerchantInsight>;
  upsertInsights(insights: MerchantInsight[], model: string): void;
  clearInsights(): void;
  /** Merchant-level view for the model: samples, typical amount, how it is categorized today. */
  listMerchants(filter: {
    onlyUncategorized: boolean;
    skipWithInsight: boolean;
  }): MerchantProfile[];
  getSetting(key: string): string | undefined;
  setSetting(key: string, value: string): void;
  deleteSetting(key: string): void;
  clearData(userId: string): void;
  close(): void;
}

export interface MerchantProfile {
  merchant: string;
  samples: string[];
  typicalAmount: number;
  count: number;
  categoryId: string;
}

/**
 * Open (or create) the SQLite file, bring it up to the current schema, and
 * assemble the `Db` facade from the per-table slices in this folder.
 */
export function openDb(file: string): Db {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const raw = new DatabaseSync(file);
  raw.exec("PRAGMA journal_mode = WAL;");
  raw.exec("PRAGMA foreign_keys = ON;");
  migrate(raw);
  if (file !== ":memory:") {
    // Keep the data file private to the current OS user.
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* best effort on non-POSIX filesystems */
    }
  }

  return {
    raw,
    ...usersSlice(raw),
    ...linksSlice(raw),
    ...ledgerSlice(raw),
    ...insightsSlice(raw),
    ...settingsSlice(raw),
    close() {
      raw.close();
    },
  };
}
