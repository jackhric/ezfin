import { generateSynthetic } from "@ezfin/core";
import type { Provider } from "./types.ts";

/** Deterministic fake data so the app is fully usable with zero real accounts. */
export class MockProvider implements Provider {
  readonly id = "demo" as const;
  constructor(private readonly seed = 42) {}

  /** Local generation makes no requests, so the budget is untouched. */
  async fetch() {
    const { accounts, transactions } = generateSynthetic({ seed: this.seed, days: 400 });
    return { accounts, transactions };
  }
}
