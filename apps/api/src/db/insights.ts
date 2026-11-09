import type { DatabaseSync } from "node:sqlite";
import type { Db } from "./index.ts";

type InsightsSlice = Pick<Db, "getInsights" | "upsertInsights" | "clearInsights" | "listMerchants">;

/* ---- what the local model concluded about merchants, and the merchant view it is asked about ---- */

export function insightsSlice(raw: DatabaseSync): InsightsSlice {
  return {
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
  };
}
