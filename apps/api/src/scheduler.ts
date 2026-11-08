import type { Db } from "./db.ts";
import { syncUser, type SyncDeps } from "./sync.ts";

/**
 * Syncs every user's links at fixed local times of day (default 05:23 and 17:35).
 *
 * Deliberately simple: a timer wakes every 30 seconds and fires when the wall
 * clock matches a configured slot that has not fired today. The last fired slot
 * is persisted so a restart inside the same minute does not double-fire. All
 * times are the server's local time zone (set TZ in the container).
 */
export interface ScheduleConfig {
  enabled: boolean;
  /** "HH:MM" entries, local time. */
  times: string[];
}

export interface ScheduleRun {
  startedAt: string;
  finishedAt: string;
  slot: string;
  users: number;
  links: number;
  transactions: number;
  errors: { linkId: string; error: string }[];
}

export const DEFAULT_SCHEDULE: ScheduleConfig = { enabled: true, times: ["05:23", "17:35"] };
const KEY_CONFIG = "sync.schedule";
const KEY_LAST_SLOT = "sync.schedule.lastSlot";
const KEY_LAST_RUN = "sync.schedule.lastRun";

export function readSchedule(db: Db): ScheduleConfig {
  const raw = db.getSetting(KEY_CONFIG);
  if (!raw) return DEFAULT_SCHEDULE;
  try {
    const parsed = JSON.parse(raw) as Partial<ScheduleConfig>;
    const times = validTimes(parsed.times ?? DEFAULT_SCHEDULE.times);
    return { enabled: parsed.enabled !== false, times: times ?? DEFAULT_SCHEDULE.times };
  } catch {
    return DEFAULT_SCHEDULE;
  }
}

export function writeSchedule(db: Db, cfg: ScheduleConfig): void {
  db.setSetting(KEY_CONFIG, JSON.stringify(cfg));
}

/** Returns normalized, sorted, de-duplicated times, or undefined if any entry is invalid. */
export function validTimes(input: unknown): string[] | undefined {
  if (!Array.isArray(input) || input.length === 0 || input.length > 6) return undefined;
  const out = new Set<string>();
  for (const t of input) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t).trim());
    if (!m) return undefined;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return undefined;
    out.add(`${String(h).padStart(2, "0")}:${m[2]}`);
  }
  return [...out].sort();
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function nextRun(cfg: ScheduleConfig, now: Date): Date | undefined {
  if (!cfg.enabled || cfg.times.length === 0) return undefined;
  for (const dayOffset of [0, 1]) {
    for (const t of cfg.times) {
      const [h, m] = t.split(":").map(Number);
      const candidate = new Date(now);
      candidate.setDate(now.getDate() + dayOffset);
      candidate.setHours(h!, m!, 0, 0);
      if (candidate > now) return candidate;
    }
  }
  return undefined;
}

export class SyncScheduler {
  private timer?: NodeJS.Timeout;
  running = false;

  constructor(
    private readonly db: Db,
    private readonly deps: SyncDeps,
  ) {}

  start(intervalMs = 30_000): void {
    this.stop();
    this.timer = setInterval(() => void this.tick(new Date()), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  status(now = new Date()) {
    const cfg = readSchedule(this.db);
    const lastRunRaw = this.db.getSetting(KEY_LAST_RUN);
    return {
      config: cfg,
      running: this.running,
      nextRunAt: nextRun(cfg, now)?.toISOString() ?? null,
      lastRun: lastRunRaw ? (JSON.parse(lastRunRaw) as ScheduleRun) : null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  /** Fire if `now` lands on a configured slot that has not fired yet today. Exposed for tests. */
  async tick(now: Date): Promise<boolean> {
    const cfg = readSchedule(this.db);
    if (!cfg.enabled || this.running) return false;
    const time = localTime(now);
    if (!cfg.times.includes(time)) return false;
    const slot = `${localDate(now)} ${time}`;
    if (this.db.getSetting(KEY_LAST_SLOT) === slot) return false;
    this.db.setSetting(KEY_LAST_SLOT, slot);
    await this.runAll(slot);
    return true;
  }

  /** Sync every link of every user. Also used by the admin "Run now" button. */
  async runAll(slot = "manual"): Promise<ScheduleRun> {
    this.running = true;
    const startedAt = new Date().toISOString();
    const userIds = [...new Set(this.db.listAllLinks().map((l) => l.userId))];
    let links = 0;
    let transactions = 0;
    const errors: ScheduleRun["errors"] = [];
    try {
      for (const userId of userIds) {
        const r = await syncUser(this.db, userId, this.deps);
        links += r.results.length;
        transactions += r.results.reduce((n, x) => n + x.transactions, 0);
        errors.push(...r.errors);
      }
    } finally {
      this.running = false;
    }
    const run: ScheduleRun = {
      startedAt,
      finishedAt: new Date().toISOString(),
      slot,
      users: userIds.length,
      links,
      transactions,
      errors,
    };
    this.db.setSetting(KEY_LAST_RUN, JSON.stringify(run));
    return run;
  }
}
