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
  provider: { id: "mock" | "simplefin"; connected: boolean; label: string; detail?: string };
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
  createdAt: string;
}

export const api = {
  authStatus: () => request<{ setupRequired: boolean; user: Me | null }>("/api/auth/status"),
  setup: (body: { username: string; email: string; password: string }) =>
    request<{ user: Me }>("/api/auth/setup", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { username: string; password: string }) =>
    request<{ user: Me }>("/api/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  addUser: (body: { username: string; email: string; password: string }) =>
    request<{ user: Me }>("/api/auth/users", { method: "POST", body: JSON.stringify(body) }),
  me: () => request<{ user: Me; accounts: Account[]; netWorth: Summary["netWorth"] }>("/api/me"),
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
    return request<{ transactions: Transaction[]; total: number }>(`/api/transactions?${qs}`);
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
  connectSimplefin: (setupToken: string) =>
    request<{ ok: true }>("/api/connect/simplefin", {
      method: "POST",
      body: JSON.stringify({ setupToken }),
    }),
  disconnect: () => request<{ ok: true }>("/api/disconnect", { method: "POST" }),
};
