import type { Db, MerchantProfile } from "../db/index.ts";
import {
  assertLocal,
  LocalClassifier,
  type Classifier,
  type ClassifierConfig,
  type ClassifierStatus,
} from "./classifier.ts";

/**
 * Runtime-editable local AI configuration. Environment variables give the
 * defaults; administrators can change provider, server URL, model, confidence
 * floor and batch size from Settings. The loopback guard (`assertLocal`) applies
 * to every change, and `allowRemote` stays environment-only on purpose so the
 * web UI can never widen where transaction text is sent.
 */
export interface AiConfig {
  provider: "ollama" | "openai";
  url: string;
  model: string;
  minConfidence: number;
  batchSize: number;
}

export interface AiTestResult extends ClassifierStatus {
  ok: boolean;
  /** Round trip of one real classification request, when the server answered. */
  latencyMs?: number;
  sample?: { merchant: string; categoryId: string; label: string; confidence: number };
}

const KEY = "ai.config";
const SAMPLE: MerchantProfile = {
  merchant: "netflix",
  samples: ["NETFLIX.COM"],
  typicalAmount: -15.49,
  count: 3,
  categoryId: "uncategorized",
};

export class AiService {
  private current: AiConfig;
  private instance: LocalClassifier;

  constructor(
    private readonly db: Db,
    defaults: AiConfig,
    private readonly guard: Pick<ClassifierConfig, "allowRemote" | "extraLocalHosts">,
  ) {
    this.current = { ...defaults, ...this.load() };
    this.instance = this.build(this.current);
  }

  private load(): Partial<AiConfig> {
    try {
      return JSON.parse(this.db.getSetting(KEY) ?? "{}") as Partial<AiConfig>;
    } catch {
      return {};
    }
  }

  private build(cfg: AiConfig): LocalClassifier {
    return new LocalClassifier({
      provider: cfg.provider,
      url: cfg.url,
      model: cfg.model,
      ...this.guard,
    });
  }

  get config(): AiConfig {
    return { ...this.current };
  }

  get classifier(): Classifier {
    return this.instance;
  }

  get minConfidence(): number {
    return this.current.minConfidence;
  }

  get batchSize(): number {
    return this.current.batchSize;
  }

  /** Validate, persist and apply a change. Throws with a user-facing message on bad input. */
  reconfigure(patch: Partial<Record<keyof AiConfig, unknown>>): AiConfig {
    const next: AiConfig = { ...this.current };
    if (patch.provider !== undefined) {
      if (patch.provider !== "ollama" && patch.provider !== "openai")
        throw new Error('Provider must be "ollama" or "openai".');
      next.provider = patch.provider;
    }
    if (patch.url !== undefined) {
      const url = (typeof patch.url === "string" ? patch.url : "").trim();
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error("Server URL must be a full URL such as http://127.0.0.1:11434.");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        throw new Error("Server URL must start with http:// or https://.");
      assertLocal(url, this.guard);
      next.url = url.replace(/\/$/, "");
    }
    if (patch.model !== undefined) {
      const model = (typeof patch.model === "string" ? patch.model : "").trim();
      if (!/^[\w.:/-]{1,100}$/.test(model)) throw new Error("Model name looks wrong.");
      next.model = model;
    }
    if (patch.minConfidence !== undefined) {
      const n = Number(patch.minConfidence);
      if (!Number.isFinite(n) || n < 0 || n > 1)
        throw new Error("Confidence floor must be between 0 and 1.");
      next.minConfidence = Math.round(n * 100) / 100;
    }
    if (patch.batchSize !== undefined) {
      const n = Number(patch.batchSize);
      if (!Number.isInteger(n) || n < 1 || n > 50)
        throw new Error("Batch size must be a whole number from 1 to 50.");
      next.batchSize = n;
    }
    const instance = this.build(next);
    this.current = next;
    this.instance = instance;
    this.db.setSetting(KEY, JSON.stringify(next));
    return this.config;
  }

  /** Check reachability and model presence, then time one real classification. */
  async test(): Promise<AiTestResult> {
    const status = await this.instance.status();
    if (!status.reachable || !status.modelAvailable) return { ...status, ok: false };
    const started = Date.now();
    try {
      const [first] = await this.instance.classify([SAMPLE]);
      const latencyMs = Date.now() - started;
      if (!first)
        return {
          ...status,
          ok: false,
          latencyMs,
          error: "The model answered but returned no usable classification.",
        };
      return { ...status, ok: true, latencyMs, sample: first };
    } catch (e) {
      return {
        ...status,
        ok: false,
        latencyMs: Date.now() - started,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
