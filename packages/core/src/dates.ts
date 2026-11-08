const DAY_MS = 86_400_000;

export function parseDate(iso: string): Date {
  // Treat YYYY-MM-DD as UTC midnight to avoid timezone drift.
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return toISODate(new Date(parseDate(iso).getTime() + days * DAY_MS));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / DAY_MS);
}

/** YYYY-MM */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
