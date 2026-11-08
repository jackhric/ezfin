/**
 * Deterministic synthetic data for development and demos.
 *
 * Nothing here is real. The generator is seeded so the same seed always
 * produces the same accounts and transactions, which keeps screenshots,
 * tests and the mock provider stable. This is the ONLY data the project
 * ships with; real bank data is pulled locally by the user at runtime.
 */
import { addDays, round2, toISODate } from "./dates.ts";
import { normalizeMerchant } from "./merchant.ts";
import type { Account, Transaction } from "./types.ts";

export interface SyntheticOptions {
  seed?: number;
  /** Number of days of history to generate. */
  days?: number;
  /** ISO date for the last day of history. Defaults to today (UTC). */
  endDate?: string;
}

interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
}

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    pick: (arr) => arr[Math.floor(next() * arr.length)]!,
    chance: (p) => next() < p,
  };
}

const CHECKING = "acc_checking";
const SAVINGS = "acc_savings";
const CREDIT = "acc_credit";

interface Sub {
  desc: string;
  amount: number;
  dayOfMonth: number;
  account: string;
  /** monthly by default */
  everyDays?: number;
  variable?: number; // +/- fraction
  endAfterDays?: number; // stop charging after N days from start (simulate cancellation)
}

const SUBSCRIPTIONS: Sub[] = [
  { desc: "NETFLIX.COM", amount: 15.49, dayOfMonth: 3, account: CREDIT },
  { desc: "Spotify USA", amount: 11.99, dayOfMonth: 8, account: CREDIT },
  { desc: "APPLE.COM/BILL", amount: 2.99, dayOfMonth: 12, account: CREDIT },
  { desc: "GOOGLE *Google One", amount: 9.99, dayOfMonth: 15, account: CREDIT },
  { desc: "ADOBE *CREATIVE CLOUD", amount: 59.99, dayOfMonth: 20, account: CREDIT },
  { desc: "PLANET FITNESS", amount: 24.99, dayOfMonth: 17, account: CHECKING },
  { desc: "HULU 877-824-4858", amount: 17.99, dayOfMonth: 5, account: CREDIT, endAfterDays: 200 },
  { desc: "NYTimes Digital", amount: 25.0, dayOfMonth: 22, account: CREDIT, everyDays: 28 },
  { desc: "GEICO *AUTO", amount: 142.5, dayOfMonth: 1, account: CHECKING },
  { desc: "T-MOBILE *AUTOPAY", amount: 85.0, dayOfMonth: 9, account: CHECKING },
  { desc: "COMCAST XFINITY", amount: 79.99, dayOfMonth: 11, account: CHECKING },
  { desc: "PG&E ELECTRIC", amount: 118.0, dayOfMonth: 14, account: CHECKING, variable: 0.35 },
  { desc: "CITY WATER DEPT", amount: 64.0, dayOfMonth: 26, account: CHECKING, variable: 0.2 },
  { desc: "OAKWOOD APARTMENTS RENT", amount: 1850.0, dayOfMonth: 1, account: CHECKING },
  { desc: "NAVIENT STUDENT LOAN", amount: 310.0, dayOfMonth: 6, account: CHECKING },
  { desc: "1PASSWORD", amount: 35.88, dayOfMonth: 19, account: CREDIT, everyDays: 365 },
];

const GROCERY = [
  "TRADER JOE'S #0412",
  "WHOLE FOODS MKT 10502",
  "SAFEWAY STORE 1234",
  "COSTCO WHSE #0423",
];
const DINING = [
  "SQ *BLUE BOTTLE COFFEE",
  "CHIPOTLE 2291",
  "DOORDASH*TAQUERIA EL SOL",
  "STARBUCKS STORE 05512",
  "TST* RAMEN NAGI",
  "SWEETGREEN SOMA",
  "UBER EATS",
];
const GAS = ["SHELL OIL 57444", "CHEVRON 0209384", "COSTCO GAS #0423", "76 - CIRCLE K 3391"];
const SHOPPING = [
  "AMZN Mktp US*2K4LM",
  "TARGET 00021444",
  "AMAZON.COM*1L8ZQ",
  "IKEA EMERYVILLE",
  "REI #112 BERKELEY",
];
const TRANSPORT = ["UBER *TRIP", "LYFT *RIDE", "BART CLIPPER", "SFMTA PARKING"];
const HEALTH = ["CVS/PHARMACY #09922", "WALGREENS #05521", "ONE MEDICAL"];
const ENTERTAINMENT = ["AMC THEATRES 1234", "STEAMGAMES.COM", "TICKETMASTER"];
const PERSONAL = ["GREAT CLIPS", "SOL SALON"];

export function generateSynthetic(options: SyntheticOptions = {}): {
  accounts: Account[];
  transactions: Transaction[];
} {
  const rng = mulberry32(options.seed ?? 42);
  const days = options.days ?? 365;
  const end = options.endDate ?? toISODate(new Date());
  const start = addDays(end, -days);
  const now = `${end}T12:00:00.000Z`;

  const txs: Transaction[] = [];
  let n = 0;
  const push = (
    accountId: string,
    postedAt: string,
    amount: number,
    description: string,
    pending = false,
  ) => {
    n += 1;
    txs.push({
      id: `tx_${n.toString().padStart(5, "0")}`,
      accountId,
      postedAt,
      amount: round2(amount),
      description,
      merchant: normalizeMerchant(description),
      categoryId: "uncategorized",
      pending,
    });
  };

  // Payroll: biweekly on Fridays.
  let pay = start;
  while (new Date(`${pay}T00:00:00Z`).getUTCDay() !== 5) pay = addDays(pay, 1);
  for (; pay <= end; pay = addDays(pay, 14)) {
    push(CHECKING, pay, 2850 + rng.int(-20, 20), "ACME CORP PAYROLL DIRECT DEP");
  }

  // Monthly transfer to savings and credit card payment.
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const dom = Number(d.slice(8, 10));
    if (dom === 2) {
      push(CHECKING, d, -500, "ONLINE TRANSFER TO SAVINGS");
      push(SAVINGS, d, 500, "ONLINE TRANSFER FROM CHECKING");
    }
    if (dom === 28) push(SAVINGS, d, round2(3 + rng.next() * 2), "INTEREST PAID");
  }

  // Subscriptions.
  for (const sub of SUBSCRIPTIONS) {
    if (sub.everyDays) {
      let d = addDays(start, rng.int(0, Math.min(sub.everyDays, 60)));
      for (; d <= end; d = addDays(d, sub.everyDays)) push(sub.account, d, -sub.amount, sub.desc);
      continue;
    }
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (Number(d.slice(8, 10)) !== sub.dayOfMonth) continue;
      if (
        sub.endAfterDays &&
        Number(new Date(`${d}T00:00:00Z`)) - Number(new Date(`${start}T00:00:00Z`)) >
          sub.endAfterDays * 86_400_000
      )
        continue;
      // Occasional 1-2 day posting jitter.
      const posted = rng.chance(0.3) ? addDays(d, rng.int(0, 2)) : d;
      if (posted > end) continue;
      let amount = sub.amount;
      if (sub.variable) amount = round2(amount * (1 + (rng.next() * 2 - 1) * sub.variable));
      push(sub.account, posted, -amount, sub.desc);
    }
  }

  // Day-to-day spending.
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    if (rng.chance(weekend ? 0.55 : 0.3))
      push(CREDIT, d, -(25 + rng.next() * 110), rng.pick(GROCERY));
    if (rng.chance(weekend ? 0.7 : 0.45)) push(CREDIT, d, -(6 + rng.next() * 40), rng.pick(DINING));
    if (rng.chance(0.14)) push(CREDIT, d, -(38 + rng.next() * 34), rng.pick(GAS));
    if (rng.chance(0.18)) push(CREDIT, d, -(10 + rng.next() * 140), rng.pick(SHOPPING));
    if (rng.chance(0.2)) push(CREDIT, d, -(4 + rng.next() * 30), rng.pick(TRANSPORT));
    if (rng.chance(0.06)) push(CREDIT, d, -(8 + rng.next() * 60), rng.pick(HEALTH));
    if (rng.chance(weekend ? 0.12 : 0.04))
      push(CREDIT, d, -(12 + rng.next() * 70), rng.pick(ENTERTAINMENT));
    if (rng.chance(0.025)) push(CREDIT, d, -(25 + rng.next() * 60), rng.pick(PERSONAL));
    if (rng.chance(0.01)) push(CREDIT, d, 15 + rng.next() * 60, "AMAZON.COM REFUND");
  }

  // Credit card autopay on the 25th: pays off everything charged in the previous cycle.
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (Number(d.slice(8, 10)) !== 25) continue;
    const cycleStart = addDays(d, -30);
    const owed = txs
      .filter(
        (t) => t.accountId === CREDIT && t.postedAt > cycleStart && t.postedAt <= d && t.amount < 0,
      )
      .reduce((s, t) => s + t.amount, 0);
    if (owed >= 0) continue;
    push(CHECKING, d, owed, "CHASE CREDIT CRD AUTOPAY");
    push(CREDIT, d, -owed, "PAYMENT THANK YOU");
  }

  // A couple of pending charges at the end.
  push(CREDIT, end, -14.2, "SQ *BLUE BOTTLE COFFEE", true);
  push(CREDIT, end, -62.1, "WHOLE FOODS MKT 10502", true);

  txs.sort((a, b) => b.postedAt.localeCompare(a.postedAt) || a.id.localeCompare(b.id));

  const sum = (acc: string) =>
    round2(txs.filter((t) => t.accountId === acc && !t.pending).reduce((s, t) => s + t.amount, 0));
  const accounts: Account[] = [
    {
      id: CHECKING,
      name: "Everyday Checking",
      institution: "Demo Bank",
      type: "checking",
      currency: "USD",
      balance: round2(4200 + sum(CHECKING)),
      lastSyncedAt: now,
    },
    {
      id: SAVINGS,
      name: "High-Yield Savings",
      institution: "Demo Bank",
      type: "savings",
      currency: "USD",
      balance: round2(12000 + sum(SAVINGS)),
      lastSyncedAt: now,
    },
    {
      id: CREDIT,
      name: "Rewards Visa",
      institution: "Demo Card Co",
      type: "credit",
      currency: "USD",
      balance: round2(Math.min(0, sum(CREDIT))),
      lastSyncedAt: now,
    },
  ];
  return { accounts, transactions: txs };
}
