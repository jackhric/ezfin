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

  it("applies model insights after overrides and before rules", () => {
    const insights = new Map([
      [normalizeMerchant("COSTCO WHSE #0423"), { categoryId: "shopping", confidence: 0.9 }],
      [normalizeMerchant("MYSTERY VENDOR LLC"), { categoryId: "dining", confidence: 0.4 }],
    ]);
    expect(categorizeOne(tx("COSTCO WHSE #0423", -210), { insights })).toBe("shopping");
    // Low confidence is ignored.
    expect(categorizeOne(tx("MYSTERY VENDOR LLC", -40), { insights })).toBe("uncategorized");
    expect(categorizeOne(tx("MYSTERY VENDOR LLC", -40), { insights, minConfidence: 0.3 })).toBe(
      "dining",
    );
    // User overrides still win over the model.
    const overrides = new Map([[normalizeMerchant("COSTCO WHSE #0423"), "groceries"]]);
    expect(categorizeOne(tx("COSTCO WHSE #0423", -210), { insights, overrides })).toBe("groceries");
  });

  it("never lets the model re-file money movement or hide spending as a transfer", () => {
    const insights = new Map([
      [normalizeMerchant("CHASE CREDIT CRD AUTOPAY"), { categoryId: "debt", confidence: 0.95 }],
      [normalizeMerchant("PAYMENT THANK YOU"), { categoryId: "refund", confidence: 0.99 }],
      [normalizeMerchant("INTEREST PAID"), { categoryId: "fees", confidence: 0.95 }],
      [normalizeMerchant("TARGET 00021444"), { categoryId: "transfer", confidence: 0.9 }],
      [normalizeMerchant("ZELLE TO MOM"), { categoryId: "gifts", confidence: 0.9 }],
      [normalizeMerchant("MYSTERY VENDOR LLC"), { categoryId: "transfer", confidence: 0.9 }],
    ]);
    expect(categorizeOne(tx("CHASE CREDIT CRD AUTOPAY", -900), { insights })).toBe("cc_payment");
    expect(categorizeOne(tx("PAYMENT THANK YOU", 900), { insights })).toBe("cc_payment");
    expect(categorizeOne(tx("INTEREST PAID", 4.1), { insights })).toBe("income");
    expect(categorizeOne(tx("TARGET 00021444", -50), { insights })).toBe("shopping");
    expect(categorizeOne(tx("ZELLE TO MOM", -50), { insights })).toBe("transfer");
    // From uncategorized, the model may say anything, including a transfer.
    expect(categorizeOne(tx("MYSTERY VENDOR LLC", -40), { insights })).toBe("transfer");
  });

  it("falls back sensibly", () => {
    expect(categorizeOne(tx("MYSTERY VENDOR LLC", -40))).toBe("uncategorized");
    expect(categorizeOne(tx("MYSTERY VENDOR LLC", 40))).toBe("income");
  });
});
