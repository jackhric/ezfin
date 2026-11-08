import type { Category } from "./types.ts";

export const CATEGORIES: Category[] = [
  { id: "groceries", name: "Groceries", group: "essentials" },
  { id: "dining", name: "Dining & Takeout", group: "lifestyle" },
  { id: "gas", name: "Gas & Fuel", group: "essentials" },
  { id: "transport", name: "Transport & Parking", group: "essentials" },
  { id: "housing", name: "Rent & Mortgage", group: "essentials" },
  { id: "utilities", name: "Utilities", group: "essentials" },
  { id: "phone_internet", name: "Phone & Internet", group: "essentials" },
  { id: "insurance", name: "Insurance", group: "essentials" },
  { id: "health", name: "Health & Pharmacy", group: "essentials" },
  { id: "subscriptions", name: "Subscriptions & Streaming", group: "lifestyle" },
  { id: "shopping", name: "Shopping", group: "lifestyle" },
  { id: "entertainment", name: "Entertainment", group: "lifestyle" },
  { id: "travel", name: "Travel", group: "lifestyle" },
  { id: "fitness", name: "Fitness", group: "lifestyle" },
  { id: "personal", name: "Personal Care", group: "lifestyle" },
  { id: "gifts", name: "Gifts & Donations", group: "lifestyle" },
  { id: "fees", name: "Fees & Interest", group: "financial" },
  { id: "debt", name: "Loan Payments", group: "financial" },
  { id: "savings", name: "Savings & Investing", group: "financial" },
  { id: "income", name: "Income", group: "income" },
  { id: "refund", name: "Refunds", group: "income" },
  { id: "transfer", name: "Transfers", group: "transfer" },
  { id: "cc_payment", name: "Credit Card Payments", group: "transfer" },
  { id: "uncategorized", name: "Uncategorized", group: "uncategorized" },
];

export const CATEGORY_BY_ID: ReadonlyMap<string, Category> = new Map(
  CATEGORIES.map((c) => [c.id, c]),
);

/** Categories that do not count as spending or income (money moving between your own accounts). */
export const NON_SPEND_CATEGORIES = new Set(["transfer", "cc_payment", "savings"]);
