import type { CategoryGroup } from "@ezfin/core";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const money = (n: number) => usd.format(n);
export const moneyExact = (n: number) => usdCents.format(n);
export const signed = (n: number) => (n > 0 ? `+${usdCents.format(n)}` : usdCents.format(n));

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function dateLabel(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

export const groupColor: Record<CategoryGroup, string> = {
  essentials: "var(--cat-essentials)",
  lifestyle: "var(--cat-lifestyle)",
  financial: "var(--cat-financial)",
  income: "var(--cat-income)",
  transfer: "var(--cat-transfer)",
  uncategorized: "var(--cat-uncategorized)",
};

/** Deterministic per-category shade within its group color, so adjacent slices differ. */
export function categoryColor(group: CategoryGroup, index: number): string {
  const base = groupColor[group];
  const mix = [0, 18, 36, 54, 70][index % 5]!;
  return mix === 0 ? base : `color-mix(in oklch, ${base}, var(--background) ${mix}%)`;
}
