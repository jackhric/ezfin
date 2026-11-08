import { addDays, daysBetween, median, round2 } from "./dates.ts";
import type { Cadence, RecurringSeries, Transaction } from "./types.ts";

interface CadenceSpec {
  cadence: Cadence;
  days: number;
  min: number;
  max: number;
  perMonth: number;
}

const CADENCES: CadenceSpec[] = [
  { cadence: "weekly", days: 7, min: 5, max: 9, perMonth: 52 / 12 },
  { cadence: "biweekly", days: 14, min: 12, max: 16, perMonth: 26 / 12 },
  { cadence: "monthly", days: 30, min: 26, max: 35, perMonth: 1 },
  { cadence: "quarterly", days: 91, min: 80, max: 100, perMonth: 1 / 3 },
  { cadence: "annual", days: 365, min: 350, max: 380, perMonth: 1 / 12 },
];

export interface DetectOptions {
  /** Minimum charges before a merchant can be considered recurring. */
  minOccurrences?: number;
  /** Relative amount tolerance for a "fixed" subscription (0.15 = 15%). */
  fixedTolerance?: number;
  /** Absolute amount tolerance in currency units, used alongside fixedTolerance. */
  fixedAbsTolerance?: number;
  /** Share of intervals that must fit the cadence window (0..1). */
  minIntervalFit?: number;
  /** "Today" for next-expected / cancelled computation (ISO date). Defaults to the latest transaction date. */
  today?: string;
  /** Categories that should never be treated as subscriptions (transfers, income, etc). */
  excludeCategories?: ReadonlySet<string>;
}

const DEFAULT_EXCLUDE = new Set([
  "income",
  "refund",
  "transfer",
  "cc_payment",
  "savings",
  "groceries",
  "dining",
  "gas",
]);

/**
 * Detect recurring charges purely from transaction history.
 *
 * Algorithm, per normalized merchant:
 *  1. Collect debits, sorted by date, and compute gaps between consecutive charges.
 *  2. Pick the cadence whose [min,max] window fits the most gaps; require a minimum fit ratio.
 *  3. Decide if the amount is fixed (subscription-like) or variable (utility-like) using
 *     median absolute deviation vs tolerances.
 *  4. Score confidence from interval fit, amount stability and occurrence count.
 *  5. Project the next expected date and flag series that look cancelled.
 *
 * Deterministic, dependency-free, and runs entirely on-device.
 */
export function detectRecurring(
  transactions: Transaction[],
  options: DetectOptions = {},
): RecurringSeries[] {
  const minOcc = options.minOccurrences ?? 3;
  const relTol = options.fixedTolerance ?? 0.15;
  const absTol = options.fixedAbsTolerance ?? 2;
  const minFit = options.minIntervalFit ?? 0.6;
  const exclude = options.excludeCategories ?? DEFAULT_EXCLUDE;

  const debits = transactions.filter((t) => t.amount < 0 && !t.pending);
  const today =
    options.today ?? debits.reduce((max, t) => (t.postedAt > max ? t.postedAt : max), "0000-00-00");

  const byMerchant = new Map<string, Transaction[]>();
  for (const t of debits) {
    if (exclude.has(t.categoryId)) continue;
    const list = byMerchant.get(t.merchant);
    if (list) list.push(t);
    else byMerchant.set(t.merchant, [t]);
  }

  const out: RecurringSeries[] = [];
  for (const [merchant, list] of byMerchant) {
    if (list.length < minOcc) continue;
    list.sort((a, b) => a.postedAt.localeCompare(b.postedAt));

    // Collapse same-day duplicates (split charges) into one occurrence.
    const occurrences = collapseSameDay(list);
    if (occurrences.length < minOcc) continue;

    const gaps: number[] = [];
    for (let i = 1; i < occurrences.length; i++) {
      gaps.push(daysBetween(occurrences[i - 1]!.postedAt, occurrences[i]!.postedAt));
    }

    let best: { spec: CadenceSpec; fit: number } | undefined;
    for (const spec of CADENCES) {
      const hits = gaps.filter((g) => g >= spec.min && g <= spec.max).length;
      const fit = hits / gaps.length;
      if (!best || fit > best.fit) best = { spec, fit };
    }
    if (!best || best.fit < minFit) continue;

    const amounts = occurrences.map((o) => Math.abs(o.amount));
    const typical = median(amounts);
    const deviation = median(amounts.map((a) => Math.abs(a - typical)));
    const variableAmount = deviation > Math.max(absTol, typical * relTol);

    const amountScore = variableAmount
      ? 0.6
      : 1 - Math.min(1, deviation / Math.max(absTol, typical * relTol)) * 0.3;
    const countScore = Math.min(1, occurrences.length / 6);
    const confidence = round2(0.5 * best.fit + 0.3 * amountScore + 0.2 * countScore);

    const last = occurrences[occurrences.length - 1]!;
    const nextExpected = addDays(last.postedAt, best.spec.days);
    const overdueDays = daysBetween(nextExpected, today);
    const possiblyCancelled = overdueDays > best.spec.days * 0.5 + 5;

    // Category: majority vote across the series.
    const categoryId = majority(occurrences.map((o) => o.categoryId));

    out.push({
      id: `rec_${slug(merchant)}`,
      merchant,
      categoryId,
      cadence: best.spec.cadence,
      typicalAmount: round2(typical),
      monthlyEquivalent: round2(typical * best.spec.perMonth),
      variableAmount,
      confidence,
      occurrences: occurrences.length,
      firstSeen: occurrences[0]!.postedAt,
      lastSeen: last.postedAt,
      nextExpected,
      possiblyCancelled,
      transactionIds: list.map((t) => t.id),
    });
  }

  return out.sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);
}

function collapseSameDay(sorted: Transaction[]): Transaction[] {
  const out: Transaction[] = [];
  for (const t of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.postedAt === t.postedAt) {
      out[out.length - 1] = { ...prev, amount: prev.amount + t.amount };
    } else {
      out.push({ ...t });
    }
  }
  return out;
}

function majority(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? "uncategorized";
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
