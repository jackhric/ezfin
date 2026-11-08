import fs from "node:fs";
import path from "node:path";
import { normalizeMerchant, round2, toISODate, type Account, type Transaction } from "@ezfin/core";
import type { Provider } from "./types.ts";

/**
 * SimpleFIN Bridge provider (https://beta-bridge.simplefin.org).
 *
 * SimpleFIN is a read-only aggregation protocol: you authorize your bank at the
 * bridge, it hands you a one-time *setup token*, and claiming that token yields
 * an *access URL* with embedded credentials. From then on, a plain HTTPS GET of
 * `{accessUrl}/accounts` returns balances and transactions. There is no write
 * capability anywhere in the protocol.
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

  /** Exchange a setup token for an access URL and persist it locally. */
  async claim(setupToken: string): Promise<void> {
    const claimUrl = Buffer.from(setupToken.trim(), "base64").toString("utf8");
    if (!claimUrl.startsWith("https://"))
      throw new Error("Setup token did not decode to an https claim URL");
    const res = await fetch(claimUrl, { method: "POST", headers: { "Content-Length": "0" } });
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

  async fetch(sinceISO: string) {
    const accessUrl = this.getAccessUrl();
    if (!accessUrl) throw new Error("SimpleFIN is not connected");
    const u = new URL(accessUrl);
    const auth = Buffer.from(
      `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`,
    ).toString("base64");
    u.username = "";
    u.password = "";
    const start = Math.floor(new Date(`${sinceISO}T00:00:00Z`).getTime() / 1000);
    const endpoint = new URL(`${u.href.replace(/\/$/, "")}/accounts`);
    endpoint.searchParams.set("start-date", String(start));
    endpoint.searchParams.set("pending", "1");

    const res = await fetch(endpoint, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) throw new Error(`SimpleFIN request failed: HTTP ${res.status}`);
    const body = (await res.json()) as SimpleFinResponse;
    if (body.errors?.length) {
      // Errors are informational (e.g. a bank that needs re-authentication). Surface but do not fail.
      console.warn("[simplefin] bridge reported:", body.errors.join("; "));
    }
    return mapResponse(body);
  }
}

interface SimpleFinResponse {
  errors?: string[];
  accounts: {
    id: string;
    name: string;
    currency: string;
    balance: string;
    "available-balance"?: string;
    "balance-date": number;
    org: { name?: string; domain?: string; "sfin-url"?: string };
    transactions: {
      id: string;
      posted: number;
      transacted_at?: number;
      amount: string;
      description: string;
      payee?: string;
      memo?: string;
      pending?: boolean;
    }[];
  }[];
}

export function mapResponse(body: SimpleFinResponse): {
  accounts: Account[];
  transactions: Omit<Transaction, "categoryId">[];
} {
  const accounts: Account[] = [];
  const transactions: Omit<Transaction, "categoryId">[] = [];
  for (const a of body.accounts ?? []) {
    const balance = round2(Number(a.balance));
    accounts.push({
      id: a.id,
      name: a.name,
      institution: a.org?.name ?? a.org?.domain ?? "Unknown",
      type: inferType(a.name, balance),
      currency: a.currency || "USD",
      balance,
      availableBalance:
        a["available-balance"] != null ? round2(Number(a["available-balance"])) : undefined,
      lastSyncedAt: new Date().toISOString(),
    });
    for (const t of a.transactions ?? []) {
      const description =
        [t.payee, t.description, t.memo].filter(Boolean).join(" ").trim() || t.description;
      const when = t.posted || t.transacted_at || 0;
      transactions.push({
        id: `${a.id}:${t.id}`,
        accountId: a.id,
        postedAt: toISODate(new Date(when * 1000)),
        amount: round2(Number(t.amount)),
        description,
        merchant: normalizeMerchant(description),
        pending: Boolean(t.pending),
      });
    }
  }
  return { accounts, transactions };
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
