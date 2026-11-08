import { describe, expect, it } from "vite-plus/test";
import { normalizeMerchant } from "../src/merchant.ts";

describe("normalizeMerchant", () => {
  it("collapses store numbers, processor prefixes and locations", () => {
    expect(normalizeMerchant("SQ *BLUE BOTTLE COFFEE 0412 SAN FRANCISCO CA")).toBe(
      normalizeMerchant("SQ *BLUE BOTTLE COFFEE 0419 SAN FRANCISCO CA"),
    );
    expect(normalizeMerchant("TRADER JOE'S #0412")).toBe(normalizeMerchant("TRADER JOE'S #0510"));
    expect(normalizeMerchant("AMZN Mktp US*2K4LM")).toBe(normalizeMerchant("AMZN Mktp US*9ZZ1Q"));
  });

  it("keeps meaningful short numbers", () => {
    expect(normalizeMerchant("76 - CIRCLE K 3391")).toContain("76");
  });

  it("strips dates and domains", () => {
    expect(normalizeMerchant("NETFLIX.COM 03/14")).toBe("netflix");
    expect(normalizeMerchant("HULU 877-824-4858")).toBe("hulu");
    expect(normalizeMerchant("APPLE.COM/BILL")).toBe("apple");
  });
});
