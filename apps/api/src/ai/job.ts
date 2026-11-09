import { categorizeOne } from "@ezfin/core";
import type { Db } from "../db/index.ts";
import type { Classifier } from "./classifier.ts";

export type AiScope = "uncategorized" | "all";

export interface AiJobState {
  running: boolean;
  scope?: AiScope;
  total: number;
  done: number;
  /** Merchants the model gave a usable answer for during the current/last run. */
  classified: number;
  /** Transactions whose category changed as a result. */
  recategorized: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

/**
 * One background job at a time. Walks merchants in batches, stores each batch's
 * insights as it goes (so partial progress survives a crash), then recategorizes
 * every auto-categorized transaction through the usual resolver:
 * user override > model insight (if confident) > built-in rules.
 */
export class AiJob {
  state: AiJobState = { running: false, total: 0, done: 0, classified: 0, recategorized: 0 };

  constructor(
    private readonly db: Db,
    private readonly classifier: Classifier,
    private readonly opts: { batchSize: number; minConfidence: number },
  ) {}

  start(scope: AiScope): boolean {
    if (this.state.running) return false;
    const merchants = this.db.listMerchants({
      onlyUncategorized: scope === "uncategorized",
      // "all" re-asks everything; "uncategorized" only asks about merchants we have not asked before.
      skipWithInsight: scope === "uncategorized",
    });
    this.state = {
      running: true,
      scope,
      total: merchants.length,
      done: 0,
      classified: 0,
      recategorized: 0,
      startedAt: new Date().toISOString(),
    };
    void this.run(merchants);
    return true;
  }

  private async run(merchants: ReturnType<Db["listMerchants"]>): Promise<void> {
    try {
      for (let i = 0; i < merchants.length; i += this.opts.batchSize) {
        const batch = merchants.slice(i, i + this.opts.batchSize);
        const insights = await this.classifier.classify(batch);
        if (insights.length) this.db.upsertInsights(insights, this.classifier.model);
        this.state.classified += insights.length;
        this.state.done = Math.min(merchants.length, i + batch.length);
      }
      this.state.recategorized = this.applyInsights();
    } catch (e) {
      this.state.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.state.running = false;
      this.state.finishedAt = new Date().toISOString();
    }
  }

  /** Re-run the resolver over auto-categorized transactions with the current overrides and insights. */
  applyInsights(): number {
    const overrides = this.db.getOverrides();
    const insights = this.db.getInsights();
    return this.db.recategorize((t) =>
      categorizeOne(t, { overrides, insights, minConfidence: this.opts.minConfidence }),
    );
  }
}
