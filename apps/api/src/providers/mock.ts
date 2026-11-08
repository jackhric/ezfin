import { generateSynthetic } from "@ezfin/core";
import type { Provider } from "./types.ts";

/** Ships deterministic fake data so the app is fully usable with zero real accounts. */
export class MockProvider implements Provider {
  readonly id = "mock" as const;
  constructor(private readonly seed = 42) {}

  async describe() {
    return {
      id: this.id,
      connected: true,
      label: "Demo data",
      detail: "Synthetic accounts and transactions generated locally. No real financial data.",
    };
  }

  async fetch() {
    const { accounts, transactions } = generateSynthetic({ seed: this.seed, days: 400 });
    return { accounts, transactions };
  }
}
