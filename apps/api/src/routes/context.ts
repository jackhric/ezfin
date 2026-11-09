import { categorizeOne } from "@ezfin/core";
import type { Hono } from "hono";
import type { Classifier } from "../ai/classifier.ts";
import type { AiJob } from "../ai/job.ts";
import type { Db, User } from "../db/index.ts";
import { SimpleFinProvider } from "../providers/simplefin.ts";
import type { SyncScheduler } from "../scheduler.ts";
import type { SecretStore } from "../secrets.ts";
import { BUDGET_WINDOW_MS, DEFAULT_REQUEST_LIMIT, type SyncDeps } from "../sync.ts";

/** Hono environment: `requireUser` stores the signed-in user on the context. */
export type Env = { Variables: { user: User } };
export type Api = Hono<Env>;

export interface AppDeps {
  db: Db;
  providers: SyncDeps["providers"];
  secrets: SecretStore;
  /** Optional local-model categorization. Absent when no classifier is configured. */
  ai?: { job: AiJob; classifier: Classifier; minConfidence: number };
  /** Optional scheduled sync. Absent in tests that do not need it. */
  scheduler?: SyncScheduler;
}

/** Everything a route module needs, built once in `createApp` and shared by every group. */
export interface RouteContext extends AppDeps {
  minConfidence: number;
  /** Per-link outbound request limit, read from settings on every call so admin changes apply at once. */
  requestLimit: () => number;
  syncDeps: SyncDeps;
  /** Links of one user with their accounts, request usage and a human-readable detail line. */
  linkView: (userId: string) => LinkView[];
  /** The category resolver with the current overrides and model insights baked in. */
  resolver: () => (t: Parameters<typeof categorizeOne>[0]) => string;
}

export type LinkView = ReturnType<Db["listLinks"]>[number] & {
  accounts: ReturnType<Db["listAccounts"]>;
  requests: { used: number; limit: number; windowHours: number };
  detail: string;
};

/** Never let a password hash leave the process. */
export const strip = <T extends { passwordHash?: string }>(u: T): Omit<T, "passwordHash"> => {
  const { passwordHash: _omit, ...rest } = u;
  return rest;
};

export function buildContext(deps: AppDeps): RouteContext {
  const { db, providers, secrets, ai } = deps;
  const minConfidence = ai?.minConfidence ?? 0.6;
  const requestLimit = () => Number(db.getSetting("sync.requestLimit") ?? DEFAULT_REQUEST_LIMIT);
  const syncDeps: SyncDeps = {
    providers,
    secrets,
    minConfidence,
    get requestLimit() {
      return requestLimit();
    },
  };
  const linkView = (userId: string) =>
    db.listLinks(userId).map((l) => ({
      ...l,
      accounts: db.listAccounts(userId).filter((a) => a.linkId === l.id),
      requests: {
        used: db.countRequests(l.id, new Date(Date.now() - BUDGET_WINDOW_MS).toISOString()),
        limit: requestLimit(),
        windowHours: 24,
      },
      detail:
        l.provider === "simplefin"
          ? `SimpleFIN Bridge at ${SimpleFinProvider.host(secrets.get(l.id) ?? "")}`
          : "Synthetic accounts and transactions generated locally, no real financial data",
    }));
  const resolver = () => {
    const overrides = db.getOverrides();
    const insights = db.getInsights();
    return (t: Parameters<typeof categorizeOne>[0]) =>
      categorizeOne(t, { overrides, insights, minConfidence });
  };
  return { ...deps, minConfidence, requestLimit, syncDeps, linkView, resolver };
}
