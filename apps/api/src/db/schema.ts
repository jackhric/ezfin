import type { DatabaseSync } from "node:sqlite";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
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
CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_synced_at TEXT,
  warnings TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS provider_requests (
  link_id TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_link ON provider_requests(link_id, at);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  link_id TEXT NOT NULL,
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

const columns = (raw: DatabaseSync, table: string) =>
  (raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

/** Bring an opened database up to the current schema. Idempotent; runs on every start. */
export function migrate(raw: DatabaseSync): void {
  // Databases created before accounts had owners cannot be migrated safely: start over.
  const legacy = raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'")
    .get();
  if (legacy) {
    const cols = columns(raw, "accounts");
    if (!cols.includes("user_id") || !cols.includes("link_id"))
      raw.exec("DROP TABLE accounts; DROP TABLE transactions;");
  }
  raw.exec(SCHEMA);
  if (!columns(raw, "users").includes("role")) {
    raw.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
    // The person who set the install up becomes its administrator.
    raw.exec(
      "UPDATE users SET role = 'admin' WHERE id = (SELECT id FROM users ORDER BY created_at LIMIT 1)",
    );
  }
}
