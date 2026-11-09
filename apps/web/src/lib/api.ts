import type {
  Account,
  Category,
  CategoryTotal,
  MonthSummary,
  RecurringSeries,
  Transaction,
} from "@ezfin/core";

/**
 * Thin fetch wrapper. All calls go to the same-origin `/api`, which the Vite dev
 * server proxies to the local API on 127.0.0.1. Nothing is sent anywhere else.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export interface Status {
  links: number;
  demoOnly: boolean;
  lastSyncAt: string | null;
  lastSyncWarnings: string[];
  accounts: number;
  transactions: number;
}

export interface Summary {
  netWorth: { assets: number; debts: number; net: number };
  current: MonthSummary;
  months: MonthSummary[];
  categoryTotals: CategoryTotal[];
  uncategorized: number;
}

export interface Recurring {
  series: RecurringSeries[];
  monthlyTotal: number;
  activeCount: number;
}

export interface AiStatus {
  configured: boolean;
  provider?: "ollama" | "openai";
  url?: string;
  model?: string;
  reachable?: boolean;
  modelAvailable?: boolean;
  models?: string[];
  error?: string;
  minConfidence?: number;
  batchSize?: number | null;
  editable?: boolean;
  auto?: boolean;
  insights?: number;
  job?: {
    running: boolean;
    scope?: "uncategorized" | "all";
    total: number;
    done: number;
    classified: number;
    recategorized: number;
    startedAt?: string;
    finishedAt?: string;
    error?: string;
  };
}

export interface Me {
  id: string;
  username: string;
  email: string;
  role: "admin" | "member";
  createdAt: string;
}

export interface ManagedUser extends Me {
  accounts: number;
  lastSeenAt: string | null;
}

export interface ServerInfo {
  version: string;
  node: string;
  startedAt: string;
  bind: string;
  dataDir: string;
  database: { path: string; bytes: number };
  ai: { provider: string; url: string; model: string };
  container: boolean;
  users: number;
}

export interface Link {
  id: string;
  provider: "simplefin" | "demo";
  label: string;
  createdAt: string;
  lastSyncedAt: string | null;
  warnings: string[];
  accounts: Account[];
  detail: string;
  requests: { used: number; limit: number; windowHours: number };
}

export interface ScheduleStatus {
  config: { enabled: boolean; times: string[] };
  running: boolean;
  nextRunAt: string | null;
  lastRun: {
    startedAt: string;
    finishedAt: string;
    slot: string;
    users: number;
    links: number;
    transactions: number;
    errors: { linkId: string; error: string }[];
  } | null;
  timezone: string;
  requestLimit: number;
  providerCeiling: number;
}

export interface SyncResult {
  accounts: number;
  transactions: number;
  syncedAt: string;
  warnings: string[];
}

export interface AiConfig {
  provider: "ollama" | "openai";
  url: string;
  model: string;
  minConfidence: number;
  batchSize: number;
}

export interface AiTestResult {
  ok: boolean;
  reachable: boolean;
  modelAvailable: boolean;
  models: string[];
  url: string;
  model: string;
  latencyMs?: number;
  sample?: { merchant: string; categoryId: string; label: string; confidence: number };
  error?: string;
}

export interface LinkTestResult {
  ok: boolean;
  provider: "simplefin" | "demo";
  accounts: number | { id: string; name: string; institution: string }[];
  warnings?: string[];
  latencyMs: number;
  error?: string;
}

export const api = {
  aiConfig: () => request<{ config: AiConfig }>("/api/ai/config"),
  updateAiConfig: (body: Partial<AiConfig>) =>
    request<{ config: AiConfig }>("/api/ai/config", { method: "PUT", body: JSON.stringify(body) }),
  aiModels: (provider: AiConfig["provider"], url: string) =>
    request<{
      provider: AiConfig["provider"];
      url: string;
      reachable: boolean;
      models: string[];
      error?: string;
    }>(`/api/ai/models?${new URLSearchParams({ provider, url })}`),
  aiTest: async () => {
    // 502 carries a useful body, so do not throw on it.
    const res = await fetch("/api/ai/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    return (await res.json()) as AiTestResult;
  },
  testLink: async (id: string) => {
    const res = await fetch(`/api/links/${id}/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const body = (await res.json()) as LinkTestResult & { error?: string };
    if (res.status === 404) throw new Error(body.error ?? "not found");
    return body;
  },
  schedule: () => request<ScheduleStatus>("/api/server/sync-schedule"),
  updateSchedule: (body: { enabled?: boolean; times?: string[]; requestLimit?: number }) =>
    request<ScheduleStatus>("/api/server/sync-schedule", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  runScheduleNow: () =>
    request<{ run: NonNullable<ScheduleStatus["lastRun"]> }>("/api/server/sync-schedule/run", {
      method: "POST",
    }),
  links: () => request<{ links: Link[] }>("/api/links"),
  linkSimplefin: (setupToken: string, label?: string) =>
    request<{ link: Link; result?: SyncResult }>("/api/links/simplefin", {
      method: "POST",
      body: JSON.stringify({ setupToken, label }),
    }),
  linkDemo: () =>
    request<{ link: Link; result: SyncResult }>("/api/links/demo", { method: "POST" }),
  syncLink: (id: string) =>
    request<{ result: SyncResult }>(`/api/links/${id}/sync`, { method: "POST" }),
  unlink: (id: string) => request<{ ok: true }>(`/api/links/${id}`, { method: "DELETE" }),
  authStatus: () => request<{ setupRequired: boolean; user: Me | null }>("/api/auth/status"),
  setup: (body: { username: string; email: string; password: string }) =>
    request<{ user: Me }>("/api/auth/setup", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { username: string; password: string }) =>
    request<{ user: Me }>("/api/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  me: () => request<{ user: Me; accounts: Account[]; netWorth: Summary["netWorth"] }>("/api/me"),
  updateMe: (body: { username?: string; email?: string }) =>
    request<{ user: Me }>("/api/me", { method: "PATCH", body: JSON.stringify(body) }),
  changePassword: (body: { current: string; next: string }) =>
    request<{ ok: true }>("/api/me/password", { method: "POST", body: JSON.stringify(body) }),
  signOutElsewhere: () => request<{ ok: true }>("/api/me/sessions", { method: "DELETE" }),
  serverInfo: () => request<ServerInfo>("/api/server/info"),
  users: () => request<{ users: ManagedUser[] }>("/api/users"),
  createUser: (body: {
    username: string;
    email: string;
    password: string;
    role: "admin" | "member";
  }) => request<{ user: Me }>("/api/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (
    id: string,
    body: { username?: string; email?: string; role?: "admin" | "member" },
  ) => request<{ user: Me }>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  resetUserPassword: (id: string, password: string) =>
    request<{ ok: true }>(`/api/users/${id}/password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  deleteUser: (id: string) => request<{ ok: true }>(`/api/users/${id}`, { method: "DELETE" }),
  aiStatus: () => request<AiStatus>("/api/ai/status"),
  aiCategorize: (scope: "uncategorized" | "all") =>
    request<{ started: boolean }>("/api/ai/categorize", {
      method: "POST",
      body: JSON.stringify({ scope }),
    }),
  aiAuto: (enabled: boolean) =>
    request<{ auto: boolean }>("/api/ai/auto", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),
  aiForget: () =>
    request<{ ok: true; recategorized: number }>("/api/ai/insights", { method: "DELETE" }),
  status: () => request<Status>("/api/status"),
  accounts: () => request<{ accounts: Account[]; netWorth: Summary["netWorth"] }>("/api/accounts"),
  categories: () =>
    request<{ categories: Category[]; overrides: Record<string, string> }>("/api/categories"),
  summary: (months = 12) => request<Summary>(`/api/summary?months=${months}`),
  recurring: () => request<Recurring>("/api/recurring"),
  transactions: (params: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
    );
    return request<{
      transactions: Transaction[];
      total: number;
      offset: number;
      hasMore: boolean;
    }>(`/api/transactions?${qs}`);
  },
  setCategory: (id: string, categoryId: string, applyToMerchant: boolean) =>
    request<{ transaction: Transaction; recategorized: number }>(
      `/api/transactions/${id}/category`,
      {
        method: "PATCH",
        body: JSON.stringify({ categoryId, applyToMerchant }),
      },
    ),
  deleteRule: (merchant: string) =>
    request<{ ok: true }>(`/api/rules/${encodeURIComponent(merchant)}`, { method: "DELETE" }),
  sync: () =>
    request<{ accounts: number; transactions: number; syncedAt: string; warnings: string[] }>(
      "/api/sync",
      {
        method: "POST",
      },
    ),
  disconnect: () => request<{ ok: true }>("/api/disconnect", { method: "POST" }),
};
