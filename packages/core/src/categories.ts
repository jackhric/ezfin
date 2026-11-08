import type { Category } from "./types.ts";

export const CATEGORIES: Category[] = [
  {
    id: "groceries",
    name: "Groceries",
    group: "essentials",
    description: "supermarkets and grocery delivery",
  },
  {
    id: "dining",
    name: "Dining & Takeout",
    group: "lifestyle",
    description: "restaurants, cafes, coffee, bars, food delivery",
  },
  { id: "gas", name: "Gas & Fuel", group: "essentials", description: "fuel for a vehicle" },
  {
    id: "transport",
    name: "Transport & Parking",
    group: "essentials",
    description: "rideshare, taxis, public transit, parking, tolls",
  },
  {
    id: "housing",
    name: "Rent & Mortgage",
    group: "essentials",
    description: "rent, mortgage, HOA dues",
  },
  {
    id: "utilities",
    name: "Utilities",
    group: "essentials",
    description: "electricity, water, gas utility, trash",
  },
  {
    id: "phone_internet",
    name: "Phone & Internet",
    group: "essentials",
    description: "mobile phone, internet, cable providers",
  },
  {
    id: "insurance",
    name: "Insurance",
    group: "essentials",
    description: "auto, home, health, life insurance premiums",
  },
  {
    id: "health",
    name: "Health & Pharmacy",
    group: "essentials",
    description: "pharmacies, doctors, dentists, clinics, labs",
  },
  {
    id: "subscriptions",
    name: "Subscriptions & Streaming",
    group: "lifestyle",
    description: "streaming, software, cloud storage, news, app memberships billed on a schedule",
  },
  {
    id: "shopping",
    name: "Shopping",
    group: "lifestyle",
    description: "retail and online stores, home goods, clothing, electronics",
  },
  {
    id: "entertainment",
    name: "Entertainment",
    group: "lifestyle",
    description: "movies, concerts, video games, events, hobbies",
  },
  {
    id: "travel",
    name: "Travel",
    group: "lifestyle",
    description: "airlines, hotels, car rental, vacation rentals",
  },
  {
    id: "fitness",
    name: "Fitness",
    group: "lifestyle",
    description: "gyms, studios, sports memberships",
  },
  {
    id: "personal",
    name: "Personal Care",
    group: "lifestyle",
    description: "salons, barbers, spas, personal care",
  },
  {
    id: "gifts",
    name: "Gifts & Donations",
    group: "lifestyle",
    description: "donations, charities, gifts",
  },
  {
    id: "fees",
    name: "Fees & Interest",
    group: "financial",
    description: "bank fees, interest charges, late fees",
  },
  {
    id: "debt",
    name: "Loan Payments",
    group: "financial",
    description: "student, auto and personal loan payments",
  },
  {
    id: "savings",
    name: "Savings & Investing",
    group: "financial",
    description: "transfers to brokerage, retirement or savings products",
  },
  {
    id: "income",
    name: "Income",
    group: "income",
    description: "payroll, salary, interest earned, dividends, other money in",
  },
  {
    id: "refund",
    name: "Refunds",
    group: "income",
    description: "refunds and reversals from merchants",
  },
  {
    id: "transfer",
    name: "Transfers",
    group: "transfer",
    description: "money moved between your own accounts or sent to people",
  },
  {
    id: "cc_payment",
    name: "Credit Card Payments",
    group: "transfer",
    description: "paying off a credit card bill",
  },
  {
    id: "uncategorized",
    name: "Uncategorized",
    group: "uncategorized",
    description: "unknown; use only when nothing else fits",
  },
];

export const CATEGORY_BY_ID: ReadonlyMap<string, Category> = new Map(
  CATEGORIES.map((c) => [c.id, c]),
);

/** Categories that do not count as spending or income (money moving between your own accounts). */
export const NON_SPEND_CATEGORIES = new Set(["transfer", "cc_payment", "savings"]);
