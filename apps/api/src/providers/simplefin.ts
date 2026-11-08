import fs from "node:fs";
import path from "node:path";
import {
  addDays,
  normalizeMerchant,
  round2,
  toISODate,
  type Account,
  type Transaction,
} from "@ezfin/core";
import type { Provider, ProviderFetch } from "./types.ts";

/**
 * SimpleFIN Bridge provider.
 *
 * Implements the public SimpleFIN protocol as documented at
 *   https://www.simplefin.org/protocol.html            (spec, v2.0.0-draft)
 *   https://beta-bridge.simplefin.org/info/developers  (bridge developer guide)
 * There is no SDK, OpenAPI file, or code generation involved: the types below
 * are hand-written from those two pages, and the fields they name are the only
 * ones this adapter reads.
 *
 * Protocol in one paragraph: the user obtains a *setup token* from the bridge.
 * It is a base64-encoded claim URL. One POST to that URL (one-time use) returns
 * an *access URL* with HTTP Basic credentials embedded. GET `{accessUrl}/accounts`
 * then returns balances and transactions. The server exposes only GET /info,
 * GET /create, POST /claim/:token and GET /accounts; nothing can move money.
 *
 * Bridge rules we follow: at most 90 days per request, well under 24 requests
 * per day, `version=2`, and every error the bridge reports is shown to the user.
 *
 * The access URL is a secret. It is stored only in a 0600 file inside the local
 * data directory and never leaves this machine except to the bridge itself.
 */
export class SimpleFinProvider implements Provider {
  readonly id = "simplefin" as const;
  private readonly secretFile: string;

  constructor(
    dataDir: string,
    private readonly envAccessUrl?: string,
  ) {
    this.secretFile = path.join(dataDir, "simplefin.access");
  }

  hasAccessUrl(): boolean {
    return Boolean(this.getAccessUrl());
  }

  private getAccessUrl(): string | undefined {
    if (this.envAccessUrl) return this.envAccessUrl;
    try {
      return fs.readFileSync(this.secretFile, "utf8").trim() || undefined;
    } catch {
      return undefined;
    }
  }

  /** POST /claim/:token. Exchange a one-time setup token for an access URL and persist it locally. */
  async claim(setupToken: string): Promise<void> {
    const claimUrl = Buffer.from(setupToken.trim(), "base64").toString("utf8");
    if (!claimUrl.startsWith("https://"))
      throw new Error("Setup token did not decode to an https claim URL");
    const res = await fetch(claimUrl, { method: "POST", headers: { "Content-Length": "0" } });
    if (res.status === 403) {
      // Spec: 403 means the token does not exist or was already claimed by someone else.
      throw new Error(
        "Claim refused (403). The token was already used or is invalid. If you did not use it, treat it as compromised and generate a new one.",
      );
    }
    if (!res.ok) throw new Error(`Claim failed: HTTP ${res.status}`);
    const accessUrl = (await res.text()).trim();
    if (!/^https:\/\/.+@.+/.test(accessUrl))
      throw new Error("Bridge returned an unexpected access URL");
    fs.mkdirSync(path.dirname(this.secretFile), { recursive: true });
    fs.writeFileSync(this.secretFile, accessUrl + "\n", { mode: 0o600 });
  }

  disconnect(): void {
    try {
      fs.rmSync(this.secretFile);
    } catch {
      /* already gone */
    }
  }

  async describe() {
    const url = this.getAccessUrl();
    if (!url)
      return {
        id: this.id,
        connected: false,
        label: "SimpleFIN",
        detail: "Not connected. Paste a setup token to connect.",
      };
    const host = safeHost(url);
    return {
      id: this.id,
      connected: true,
      label: "SimpleFIN",
      detail: `Connected to ${host}. Access URL stored locally in ${path.basename(this.secretFile)}.`,
    };
  }

  /** GET /accounts, split into windows of at most 90 days as the bridge requires. */
  async fetch(sinceISO: string): Promise<ProviderFetch> {
    const accessUrl = this.getAccessUrl();
    if (!accessUrl) throw new Error("SimpleFIN is not connected");
    const { base, auth } = splitAccessUrl(accessUrl);

    const today = toISODate(new Date());
    const windows = dateWindows(sinceISO, today, MAX_WINDOW_DAYS);
    const merged: ProviderFetch = { accounts: [], transactions: [], warnings: [] };
    const seenAccounts = new Map<string, Account>();
    const seenTx = new Set<string>();

    for (const [from, to] of windows) {
      const endpoint = new URL(`${base}/accounts`);
      endpoint.searchParams.set("version", "2");
      endpoint.searchParams.set("start-date", String(unix(from)));
      // end-date is exclusive per spec, so ask for the day after the window end.
      endpoint.searchParams.set("end-date", String(unix(addDays(to, 1))));
      endpoint.searchParams.set("pending", "1");

      const res = await fetch(endpoint, { headers: { Authorization: `Basic ${auth}` } });
      if (res.status === 403)
        throw new Error(
          "SimpleFIN refused the request (403): access was revoked or the credentials are wrong. Disconnect and claim a new setup token.",
        );
      if (res.status === 402)
        throw new Error("SimpleFIN returned 402 Payment Required: check your bridge subscription.");
      if (!res.ok) throw new Error(`SimpleFIN request failed: HTTP ${res.status}`);
      const page = mapResponse((await res.json()) as SimpleFinResponse);

      // Later windows carry the freshest balances; keep the last copy of each account.
      for (const a of page.accounts) seenAccounts.set(a.id, a);
      for (const t of page.transactions) {
        if (seenTx.has(t.id)) continue;
        seenTx.add(t.id);
        merged.transactions.push(t);
      }
      for (const w of page.warnings ?? [])
        if (!merged.warnings!.includes(w)) merged.warnings!.push(w);
    }
    merged.accounts = [...seenAccounts.values()];
    return merged;
  }
}

/** The bridge limits each /accounts call to 90 days of history. */
export const MAX_WINDOW_DAYS = 90;

/** Inclusive [from, to] windows covering from..to, each at most `size` days. Exported for tests. */
export function dateWindows(from: string, to: string, size: number): [string, string][] {
  const out: [string, string][] = [];
  let start = from;
  while (start <= to) {
    const end = addDays(start, size - 1);
    out.push([start, end < to ? end : to]);
    start = addDays(end, 1);
  }
  return out;
}

function unix(iso: string): number {
  return Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 1000);
}

function splitAccessUrl(accessUrl: string): { base: string; auth: string } {
  const u = new URL(accessUrl);
  const auth = Buffer.from(
    `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`,
  ).toString("base64");
  u.username = "";
  u.password = "";
  return { base: u.href.replace(/\/$/, ""), auth };
}

/* ---- Wire types, hand-written from the protocol page. Field names are the spec's. ---- */

/** "Error" object (v2). */
interface SimpleFinError {
  code: string;
  msg: string;
  conn_id?: string;
  account_id?: string;
}

/** "Connection" object (v2). Replaces the v1 "Organization" object. */
interface SimpleFinConnection {
  conn_id: string;
  name: string;
  org_id: string;
  org_url?: string;
  sfin_url: string;
}

/** "Transaction" object. Amounts are numeric strings; times are unix seconds. */
interface SimpleFinTransaction {
  id: string;
  posted: number; // may be 0 when pending
  amount: string; // positive = deposit into the account
  description: string;
  transacted_at?: number;
  pending?: boolean;
  extra?: Record<string, unknown>;
}

/** "Account" object. */
interface SimpleFinAccount {
  id: string;
  name: string;
  conn_id?: string; // v2
  currency: string;
  balance: string;
  "available-balance"?: string;
  "balance-date": number;
  transactions?: SimpleFinTransaction[];
  extra?: Record<string, unknown>;
  /** v1 only: the institution. Kept so a v1 server still maps cleanly. */
  org?: { name?: string; domain?: string; "sfin-url"?: string };
}

/** "Account Set": the GET /accounts response body. */
export interface SimpleFinResponse {
  errlist?: SimpleFinError[]; // v2
  errors?: string[]; // v1, deprecated in v2 but still sent by the bridge
  connections?: SimpleFinConnection[]; // v2
  accounts: SimpleFinAccount[];
}

export function mapResponse(body: SimpleFinResponse): ProviderFetch {
  const accounts: Account[] = [];
  const transactions: Omit<Transaction, "categoryId">[] = [];
  const connections = new Map((body.connections ?? []).map((c) => [c.conn_id, c]));
  const now = new Date().toISOString();

  for (const a of body.accounts ?? []) {
    const balance = round2(Number(a.balance));
    const conn = a.conn_id ? connections.get(a.conn_id) : undefined;
    accounts.push({
      id: a.id,
      name: a.name,
      institution: conn?.name ?? a.org?.name ?? a.org?.domain ?? "Unknown",
      type: inferType(a.name, balance),
      currency: a.currency || "USD",
      balance,
      availableBalance:
        a["available-balance"] != null ? round2(Number(a["available-balance"])) : undefined,
      lastSyncedAt: now,
    });
    for (const t of a.transactions ?? []) {
      // `posted` may be 0 for pending transactions; fall back to transacted_at, then "now".
      const when = t.posted || t.transacted_at || Math.floor(Date.now() / 1000);
      transactions.push({
        id: `${a.id}:${t.id}`,
        accountId: a.id,
        postedAt: toISODate(new Date(when * 1000)),
        amount: round2(Number(t.amount)),
        description: t.description,
        merchant: normalizeMerchant(t.description),
        pending: Boolean(t.pending),
      });
    }
  }

  // The spec says every message here must be shown to the user (and sanitized: we render as text only).
  const warnings = [
    ...(body.errlist ?? []).map((e) => `${e.code}: ${e.msg}`),
    ...(body.errors ?? []),
  ].map((w) => String(w).slice(0, 500));

  return { accounts, transactions, warnings };
}

function inferType(name: string, balance: number): Account["type"] {
  const n = name.toLowerCase();
  if (/credit|visa|mastercard|amex|card/.test(n) || balance < 0) return "credit";
  if (/saving|hysa|money market/.test(n)) return "savings";
  if (/401|ira|brokerage|invest/.test(n)) return "investment";
  if (/loan|mortgage/.test(n)) return "loan";
  return "checking";
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "bridge";
  }
}
