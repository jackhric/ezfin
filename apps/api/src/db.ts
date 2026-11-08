import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Account, MerchantInsight, Transaction } from "@ezfin/core";

export interface User {
  id: string;
  username: string;
  email: string;
  createdAt: string;
}

export interface Db {
  raw: DatabaseSync;
  /* ---- users and sessions ---- */
  countUsers(): number;
  createUser(u: { username: string; email: string; passwordHash: string }): User;
  getUserByUsername(username: string): (User & { passwordHash: string }) | undefined;
  getUserById(id: string): User | undefined;
  createSession(userId: string, tokenHash: string, expiresAt: string): void;
  getSessionUser(tokenHash: string): User | undefined;
  deleteSession(tokenHash: string): void;
  /* ---- financial data, always scoped to a user ---- */
  upsertAccounts(userId: string, accounts: Account[]): void;
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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS merchant_insights (
  merchant TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  label TEXT NOT NULL,
  confidence REAL NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  institution TEXT NOT NULL,
  type TEXT NOT NULL,
  currency TEXT NOT NULL,
  balance REAL NOT NULL,
  available_balance REAL,
  last_synced_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT NOT NULL,
  merchant TEXT NOT NULL,
  category_id TEXT NOT NULL,
  pending INTEGER NOT NULL DEFAULT 0,
  /* 1 when the user set the category by hand; auto-recategorization leaves these alone */
  user_categorized INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tx_posted ON transactions(user_id, posted_at);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_merchant ON transactions(merchant);
CREATE TABLE IF NOT EXISTS category_overrides (
  merchant TEXT PRIMARY KEY,
  category_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

type UserRow = {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  created_at: string;
};
const toUser = (r: UserRow): User => ({
  id: r.id,
  username: r.username,
  email: r.email,
  createdAt: r.created_at,
});

type AccountRow = {
  id: string;
  name: string;
  institution: string;
  type: string;
  currency: string;
  balance: number;
  available_balance: number | null;
  last_synced_at: string;
};
type TxRow = {
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

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  name: r.name,
  institution: r.institution,
  type: r.type as Account["type"],
  currency: r.currency,
  balance: r.balance,
  availableBalance: r.available_balance ?? undefined,
  lastSyncedAt: r.last_synced_at,
});

const toTx = (r: TxRow): Transaction => ({
  id: r.id,
  accountId: r.account_id,
  postedAt: r.posted_at,
  amount: r.amount,
  description: r.description,
  merchant: r.merchant,
  categoryId: r.category_id,
  pending: r.pending === 1,
});

export function openDb(file: string): Db {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const raw = new DatabaseSync(file);
  raw.exec("PRAGMA journal_mode = WAL;");
  raw.exec("PRAGMA foreign_keys = ON;");
  // Databases created before accounts had owners cannot be migrated safely: start over.
  const legacy = raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'")
    .get();
  if (legacy) {
    const cols = (raw.prepare("PRAGMA table_info(accounts)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    if (!cols.includes("user_id")) raw.exec("DROP TABLE accounts; DROP TABLE transactions;");
  }
  raw.exec(SCHEMA);
  if (file !== ":memory:") {
    // Keep the data file private to the current OS user.
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* best effort on non-POSIX filesystems */
    }
  }

  const upsertAccount = raw.prepare(`
    INSERT INTO accounts (id, user_id, name, institution, type, currency, balance, available_balance, last_synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, name=excluded.name, institution=excluded.institution, type=excluded.type,
      currency=excluded.currency, balance=excluded.balance, available_balance=excluded.available_balance,
      last_synced_at=excluded.last_synced_at`);
  const upsertTx = raw.prepare(`
    INSERT INTO transactions (id, user_id, account_id, posted_at, amount, description, merchant, category_id, pending, user_categorized)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, account_id=excluded.account_id, posted_at=excluded.posted_at, amount=excluded.amount,
      description=excluded.description, merchant=excluded.merchant, pending=excluded.pending,
      category_id = CASE WHEN transactions.user_categorized = 1 THEN transactions.category_id ELSE excluded.category_id END`);
  const selectTx = raw.prepare("SELECT * FROM transactions WHERE id = ? AND user_id = ?");
  const updateCat = raw.prepare(
    "UPDATE transactions SET category_id = ?, user_categorized = 1 WHERE id = ? AND user_id = ?",
  );
  const updateAutoCat = raw.prepare(
    "UPDATE transactions SET category_id = ? WHERE id = ? AND user_categorized = 0",
  );

  const db: Db = {
    raw,
    countUsers() {
      return (raw.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
    },
    createUser(u) {
      const row: UserRow = {
        id: `usr_${randomUUID()}`,
        username: u.username,
        email: u.email,
        password_hash: u.passwordHash,
        created_at: new Date().toISOString(),
      };
      raw
        .prepare(
          "INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(row.id, row.username, row.email, row.password_hash, row.created_at);
      return toUser(row);
    },
    getUserByUsername(username) {
      const r = raw.prepare("SELECT * FROM users WHERE username = ?").get(username) as
        | UserRow
        | undefined;
      return r ? { ...toUser(r), passwordHash: r.password_hash } : undefined;
    },
    getUserById(id) {
      const r = raw.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
      return r ? toUser(r) : undefined;
    },
    createSession(userId, tokenHash, expiresAt) {
      raw
        .prepare(
          "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        )
        .run(tokenHash, userId, new Date().toISOString(), expiresAt);
      raw.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
    },
    getSessionUser(tokenHash) {
      const r = raw
        .prepare(
          "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
        )
        .get(tokenHash, new Date().toISOString()) as UserRow | undefined;
      return r ? toUser(r) : undefined;
    },
    deleteSession(tokenHash) {
      raw.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    },
    upsertAccounts(userId, accounts) {
      raw.exec("BEGIN");
      try {
        for (const a of accounts) {
          upsertAccount.run(
            a.id,
            userId,
            a.name,
            a.institution,
            a.type,
            a.currency,
            a.balance,
            a.availableBalance ?? null,
            a.lastSyncedAt,
          );
        }
        raw.exec("COMMIT");
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
    upsertTransactions(userId, txs) {
      raw.exec("BEGIN");
      try {
        for (const t of txs) {
          upsertTx.run(
            t.id,
            userId,
            t.accountId,
            t.postedAt,
            t.amount,
            t.description,
            t.merchant,
            t.categoryId,
            t.pending ? 1 : 0,
          );
        }
        raw.exec("COMMIT");
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
    listAccounts(userId) {
      return (
        raw
          .prepare("SELECT * FROM accounts WHERE user_id = ? ORDER BY type, name")
          .all(userId) as AccountRow[]
      ).map(toAccount);
    },
    listTransactions(userId, filter = {}) {
      const where: string[] = ["t.user_id = ?"];
      const params: (string | number)[] = [userId];
      if (filter.from) {
        where.push("t.posted_at >= ?");
        params.push(filter.from);
      }
      if (filter.to) {
        where.push("t.posted_at <= ?");
        params.push(filter.to);
      }
      if (filter.accountId) {
        where.push("t.account_id = ?");
        params.push(filter.accountId);
      }
      if (filter.categoryId) {
        where.push("t.category_id = ?");
        params.push(filter.categoryId);
      }
      if (filter.q) {
        where.push("(t.description LIKE ? OR t.merchant LIKE ?)");
        params.push(`%${filter.q}%`, `%${filter.q}%`);
      }
      const sql = `SELECT t.*, i.label AS merchant_label FROM transactions t
        LEFT JOIN merchant_insights i ON i.merchant = t.merchant
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY t.posted_at DESC, t.id DESC`;
      return (raw.prepare(sql).all(...params) as (TxRow & { merchant_label: string | null })[]).map(
        (r) => ({ ...toTx(r), merchantLabel: r.merchant_label ?? undefined }),
      );
    },
    setCategory(userId, txId, categoryId) {
      updateCat.run(categoryId, txId, userId);
      const row = selectTx.get(txId, userId) as TxRow | undefined;
      return row ? toTx(row) : undefined;
    },
    getOverrides() {
      const rows = raw.prepare("SELECT merchant, category_id FROM category_overrides").all() as {
        merchant: string;
        category_id: string;
      }[];
      return new Map(rows.map((r) => [r.merchant, r.category_id]));
    },
    setOverride(merchant, categoryId) {
      raw
        .prepare(
          "INSERT INTO category_overrides (merchant, category_id) VALUES (?, ?) ON CONFLICT(merchant) DO UPDATE SET category_id = excluded.category_id",
        )
        .run(merchant, categoryId);
    },
    deleteOverride(merchant) {
      raw.prepare("DELETE FROM category_overrides WHERE merchant = ?").run(merchant);
    },
    recategorize(fn) {
      const rows = raw
        .prepare("SELECT * FROM transactions WHERE user_categorized = 0")
        .all() as TxRow[];
      let changed = 0;
      raw.exec("BEGIN");
      try {
        for (const r of rows) {
          const next = fn(toTx(r));
          if (next !== r.category_id) {
            updateAutoCat.run(next, r.id);
            changed += 1;
          }
        }
        raw.exec("COMMIT");
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
      return changed;
    },
    getInsights() {
      const rows = raw
        .prepare("SELECT merchant, category_id, label, confidence FROM merchant_insights")
        .all() as {
        merchant: string;
        category_id: string;
        label: string;
        confidence: number;
      }[];
      return new Map(
        rows.map((r) => [
          r.merchant,
          {
            merchant: r.merchant,
            categoryId: r.category_id,
            label: r.label,
            confidence: r.confidence,
          },
        ]),
      );
    },
    upsertInsights(insights, model) {
      const stmt =
        raw.prepare(`INSERT INTO merchant_insights (merchant, category_id, label, confidence, model, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(merchant) DO UPDATE SET category_id=excluded.category_id, label=excluded.label,
          confidence=excluded.confidence, model=excluded.model, created_at=excluded.created_at`);
      const now = new Date().toISOString();
      raw.exec("BEGIN");
      try {
        for (const i of insights)
          stmt.run(i.merchant, i.categoryId, i.label, i.confidence, model, now);
        raw.exec("COMMIT");
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
    clearInsights() {
      raw.exec("DELETE FROM merchant_insights");
    },
    listMerchants(filter) {
      const where: string[] = ["t.merchant <> ''"];
      if (filter.onlyUncategorized)
        where.push("t.category_id = 'uncategorized' AND t.user_categorized = 0");
      if (filter.skipWithInsight)
        where.push("NOT EXISTS (SELECT 1 FROM merchant_insights i WHERE i.merchant = t.merchant)");
      const rows = raw
        .prepare(`
        SELECT t.merchant, AVG(t.amount) AS typical, COUNT(*) AS n, MIN(t.category_id) AS category_id,
               GROUP_CONCAT(DISTINCT t.description) AS descs
        FROM transactions t WHERE ${where.join(" AND ")}
        GROUP BY t.merchant ORDER BY n DESC`)
        .all() as {
        merchant: string;
        typical: number;
        n: number;
        category_id: string;
        descs: string;
      }[];
      return rows.map((r) => ({
        merchant: r.merchant,
        samples: r.descs.split(",").slice(0, 3),
        typicalAmount: Math.round(r.typical * 100) / 100,
        count: r.n,
        categoryId: r.category_id,
      }));
    },
    getSetting(key) {
      const row = raw.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
        | { value: string }
        | undefined;
      return row?.value;
    },
    setSetting(key, value) {
      raw
        .prepare(
          "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(key, value);
    },
    deleteSetting(key) {
      raw.prepare("DELETE FROM settings WHERE key = ?").run(key);
    },
    clearData(userId) {
      raw.prepare("DELETE FROM transactions WHERE user_id = ?").run(userId);
      raw.prepare("DELETE FROM accounts WHERE user_id = ?").run(userId);
    },
    close() {
      raw.close();
    },
  };
  return db;
}
