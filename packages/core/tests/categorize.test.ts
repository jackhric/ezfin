import { describe, expect, it } from "vite-plus/test";
import { categorizeOne } from "../src/categorize.ts";
import { normalizeMerchant } from "../src/merchant.ts";

const tx = (description: string, amount: number) => ({
  description,
  merchant: normalizeMerchant(description),
  amount,
});

describe("categorizeOne", () => {
  it("matches common merchants", () => {
    expect(categorizeOne(tx("NETFLIX.COM", -15.49))).toBe("subscriptions");
    expect(categorizeOne(tx("SHELL OIL 57444", -52))).toBe("gas");
    expect(categorizeOne(tx("TRADER JOE'S #0412", -80))).toBe("groceries");
    expect(categorizeOne(tx("DOORDASH*TAQUERIA EL SOL", -28))).toBe("dining");
    expect(categorizeOne(tx("ACME CORP PAYROLL DIRECT DEP", 2850))).toBe("income");
    expect(categorizeOne(tx("CHASE CREDIT CRD AUTOPAY", -900))).toBe("cc_payment");
  });

  it("respects direction constraints", () => {
    expect(categorizeOne(tx("PAYROLL REVERSAL", -100))).not.toBe("income");
  });

  it("prefers user overrides", () => {
    const overrides = new Map([[normalizeMerchant("COSTCO WHSE #0423"), "shopping"]]);
    expect(categorizeOne(tx("COSTCO WHSE #0423", -210), { overrides })).toBe("shopping");
  });

  it("falls back sensibly", () => {
    expect(categorizeOne(tx("MYSTERY VENDOR LLC", -40))).toBe("uncategorized");
    expect(categorizeOne(tx("MYSTERY VENDOR LLC", 40))).toBe("income");
  });
});
