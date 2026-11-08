import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { Account, Transaction } from "@ezfin/core";

export interface Db {
  raw: DatabaseSync;
  upsertAccounts(accounts: Account[]): void;
  upsertTransactions(txs: Transaction[]): void;
  listAccounts(): Account[];
  listTransactions(filter?: {
    from?: string;
    to?: string;
    accountId?: string;
    categoryId?: string;
    q?: string;
  }): Transaction[];
  setCategory(txId: string, categoryId: string): Transaction | undefined;
  getOverrides(): Map<string, string>;
  setOverride(merchant: string, categoryId: string): void;
  deleteOverride(merchant: string): void;
  recategorize(fn: (tx: Transaction) => string): number;
  getSetting(key: string): string | undefined;
  setSetting(key: string, value: string): void;
  deleteSetting(key: string): void;
  clearData(): void;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
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
CREATE INDEX IF NOT EXISTS idx_tx_posted ON transactions(posted_at);
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
    INSERT INTO accounts (id, name, institution, type, currency, balance, available_balance, last_synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, institution=excluded.institution, type=excluded.type,
      currency=excluded.currency, balance=excluded.balance, available_balance=excluded.available_balance,
      last_synced_at=excluded.last_synced_at`);
  const upsertTx = raw.prepare(`
    INSERT INTO transactions (id, account_id, posted_at, amount, description, merchant, category_id, pending, user_categorized)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id, posted_at=excluded.posted_at, amount=excluded.amount,
      description=excluded.description, merchant=excluded.merchant, pending=excluded.pending,
      category_id = CASE WHEN transactions.user_categorized = 1 THEN transactions.category_id ELSE excluded.category_id END`);
  const selectTx = raw.prepare("SELECT * FROM transactions WHERE id = ?");
  const updateCat = raw.prepare(
    "UPDATE transactions SET category_id = ?, user_categorized = 1 WHERE id = ?",
  );
  const updateAutoCat = raw.prepare(
    "UPDATE transactions SET category_id = ? WHERE id = ? AND user_categorized = 0",
  );

  const db: Db = {
    raw,
    upsertAccounts(accounts) {
      raw.exec("BEGIN");
      try {
        for (const a of accounts) {
          upsertAccount.run(
            a.id,
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
    upsertTransactions(txs) {
      raw.exec("BEGIN");
      try {
        for (const t of txs) {
          upsertTx.run(
            t.id,
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
    listAccounts() {
      return (raw.prepare("SELECT * FROM accounts ORDER BY type, name").all() as AccountRow[]).map(
        toAccount,
      );
    },
    listTransactions(filter = {}) {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (filter.from) {
        where.push("posted_at >= ?");
        params.push(filter.from);
      }
      if (filter.to) {
        where.push("posted_at <= ?");
        params.push(filter.to);
      }
      if (filter.accountId) {
        where.push("account_id = ?");
        params.push(filter.accountId);
      }
      if (filter.categoryId) {
        where.push("category_id = ?");
        params.push(filter.categoryId);
      }
      if (filter.q) {
        where.push("(description LIKE ? OR merchant LIKE ?)");
        params.push(`%${filter.q}%`, `%${filter.q}%`);
      }
      const sql = `SELECT * FROM transactions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY posted_at DESC, id DESC`;
      return (raw.prepare(sql).all(...params) as TxRow[]).map(toTx);
    },
    setCategory(txId, categoryId) {
      updateCat.run(categoryId, txId);
      const row = selectTx.get(txId) as TxRow | undefined;
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
    clearData() {
      raw.exec("DELETE FROM transactions; DELETE FROM accounts;");
    },
    close() {
      raw.close();
    },
  };
  return db;
}
