import { CATEGORIES, CATEGORY_BY_ID, type MerchantInsight } from "@ezfin/core";
import type { MerchantProfile } from "../db.ts";

/**
 * Talks to a small language model running on this machine and asks it to
 * explain and categorize merchants. Two wire formats are supported:
 *
 *  - "ollama": Ollama's native POST /api/chat with `format` set to a JSON schema.
 *  - "openai": POST /v1/chat/completions with response_format json_schema, which
 *    LM Studio, llama.cpp's server, vLLM and friends all speak.
 *
 * What leaves the process: merchant keys, up to three raw descriptions per
 * merchant, a typical amount and a count. Never account ids, balances, dates
 * or anything that identifies you. And it only goes to loopback unless
 * EZFIN_AI_ALLOW_REMOTE=1 is set explicitly.
 */
export interface ClassifierConfig {
  provider: "ollama" | "openai";
  url: string;
  model: string;
  allowRemote: boolean;
  /** Hostnames other than loopback that are acceptable (e.g. host.docker.internal inside a container). */
  extraLocalHosts?: string[];
}

export interface ClassifierStatus {
  provider: ClassifierConfig["provider"];
  url: string;
  model: string;
  reachable: boolean;
  modelAvailable: boolean;
  /** Models the server reports, so the Settings page can suggest one. */
  models: string[];
  error?: string;
}

export interface Classifier {
  status(): Promise<ClassifierStatus>;
  classify(batch: MerchantProfile[]): Promise<MerchantInsight[]>;
  readonly model: string;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function assertLocal(
  url: string,
  cfg: Pick<ClassifierConfig, "allowRemote" | "extraLocalHosts">,
): void {
  const host = new URL(url).hostname;
  if (LOOPBACK.has(host) || cfg.extraLocalHosts?.includes(host) || cfg.allowRemote) return;
  throw new Error(
    `Refusing to send transaction data to ${host}: the AI endpoint must be on this machine. Set EZFIN_AI_ALLOW_REMOTE=1 only if you really mean it.`,
  );
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          merchant: { type: "string" },
          categoryId: { type: "string", enum: CATEGORIES.map((c) => c.id) },
          label: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["merchant", "categoryId", "label", "confidence"],
      },
    },
  },
  required: ["results"],
} as const;

export const SYSTEM_PROMPT = [
  "You classify bank transaction merchants for a personal finance app.",
  "For each merchant, pick exactly one category id from this list:",
  ...CATEGORIES.map((c) => `- ${c.id}: ${c.description}`),
  "",
  'Also write a short plain-English label (at most 6 words) saying what the merchant is, for example "ramen restaurant" or "cloud storage subscription".',
  "Give a confidence between 0 and 1. Negative amounts are money going out; positive amounts are money coming in.",
  'Money movement guidance: paying a credit card bill (e.g. "PAYMENT THANK YOU", "CARD AUTOPAY") is cc_payment, not debt. Interest paid TO the user (positive amount) is income. Moving money between the user\'s own accounts is transfer.',
  "Payment processor prefixes such as SQ, TST, PP, DD, AMZN are noise; focus on the business name.",
  "If you genuinely cannot tell, use uncategorized with a confidence below 0.5. Never invent a business that is not implied by the text.",
  "Echo the merchant key exactly as given.",
].join("\n");

export function buildUserMessage(batch: MerchantProfile[]): string {
  return JSON.stringify(
    batch.map((m) => ({
      merchant: m.merchant,
      samples: m.samples,
      typicalAmount: m.typicalAmount,
      count: m.count,
    })),
  );
}

/** Validate and normalize whatever the model returned. Unknown merchants and bad categories are dropped. */
export function parseResults(raw: unknown, batch: MerchantProfile[]): MerchantInsight[] {
  const wanted = new Set(batch.map((b) => b.merchant));
  const results = (raw as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const out: MerchantInsight[] = [];
  const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  for (const r of results as Record<string, unknown>[]) {
    const merchant = str(r.merchant).trim();
    const categoryId = str(r.categoryId);
    if (!wanted.has(merchant) || !CATEGORY_BY_ID.has(categoryId)) continue;
    const confidence = Math.max(0, Math.min(1, Number(r.confidence)));
    if (!Number.isFinite(confidence)) continue;
    out.push({
      merchant,
      categoryId,
      label: str(r.label).replace(/\s+/g, " ").trim().slice(0, 60),
      confidence: Math.round(confidence * 100) / 100,
    });
    wanted.delete(merchant);
  }
  return out;
}

export class LocalClassifier implements Classifier {
  readonly model: string;
  private readonly base: string;

  constructor(private readonly cfg: ClassifierConfig) {
    assertLocal(cfg.url, cfg);
    this.base = cfg.url.replace(/\/$/, "");
    this.model = cfg.model;
  }

  async status(): Promise<ClassifierStatus> {
    const s: ClassifierStatus = {
      provider: this.cfg.provider,
      url: this.base,
      model: this.model,
      reachable: false,
      modelAvailable: false,
      models: [],
    };
    try {
      const res =
        this.cfg.provider === "ollama"
          ? await fetch(`${this.base}/api/tags`, { signal: AbortSignal.timeout(3000) })
          : await fetch(`${this.base}/v1/models`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { models?: { name: string }[]; data?: { id: string }[] };
      s.models = (body.models ?? body.data ?? []).map((m) => ("name" in m ? m.name : m.id));
      s.reachable = true;
      s.modelAvailable = s.models.some(
        (m) => m === this.model || m.split(":")[0] === this.model.split(":")[0],
      );
      if (this.cfg.provider === "openai" && s.models.length === 0) s.modelAvailable = true; // some servers do not list
    } catch (e) {
      s.error = e instanceof Error ? e.message : String(e);
    }
    return s;
  }

  async classify(batch: MerchantProfile[]): Promise<MerchantInsight[]> {
    if (batch.length === 0) return [];
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(batch) },
    ];
    let content: string;
    if (this.cfg.provider === "ollama") {
      const res = await fetch(`${this.base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          think: false,
          format: RESPONSE_SCHEMA,
          options: { temperature: 0, num_ctx: 4096 },
        }),
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (!res.ok)
        throw new Error(
          `Local model request failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
        );
      content = ((await res.json()) as { message: { content: string } }).message.content;
    } else {
      const res = await fetch(`${this.base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0,
          response_format: {
            type: "json_schema",
            json_schema: { name: "merchants", schema: RESPONSE_SCHEMA, strict: true },
          },
        }),
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (!res.ok)
        throw new Error(
          `Local model request failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
        );
      content =
        ((await res.json()) as { choices: { message: { content: string } }[] }).choices[0]?.message
          .content ?? "";
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Local model returned something that is not JSON");
    }
    return parseResults(parsed, batch);
  }
}
