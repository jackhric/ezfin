import type { DatabaseSync } from "node:sqlite";
import type { Db } from "./index.ts";
import { toAccount, toTx, type AccountRow, type TxRow } from "./rows.ts";

type LedgerSlice = Pick<
  Db,
  | "upsertAccounts"
  | "upsertTransactions"
  | "listAccounts"
  | "listTransactions"
  | "setCategory"
  | "getOverrides"
  | "setOverride"
  | "deleteOverride"
  | "recategorize"
  | "clearData"
>;

/* ---- accounts, transactions and merchant category overrides ---- */

export function ledgerSlice(raw: DatabaseSync): LedgerSlice {
  const upsertAccount = raw.prepare(`
    INSERT INTO accounts (id, user_id, link_id, name, institution, type, currency, balance, available_balance, last_synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, link_id=excluded.link_id, name=excluded.name, institution=excluded.institution, type=excluded.type,
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

  return {
    upsertAccounts(userId, linkId, accounts) {
      raw.exec("BEGIN");
      try {
        for (const a of accounts) {
          upsertAccount.run(
            a.id,
            userId,
            linkId,
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
    clearData(userId) {
      raw.prepare("DELETE FROM transactions WHERE user_id = ?").run(userId);
      raw.prepare("DELETE FROM accounts WHERE user_id = ?").run(userId);
      raw.prepare("DELETE FROM links WHERE user_id = ?").run(userId);
    },
  };
}
