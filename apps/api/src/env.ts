import path from "node:path";

/**
 * Runtime configuration. Everything defaults to "local only":
 * the API binds to loopback and stores data in ./data next to this app.
 */
export const env = {
  host: process.env.EZFIN_HOST ?? "127.0.0.1",
  port: Number(process.env.EZFIN_PORT ?? 8787),
  dataDir: process.env.EZFIN_DATA_DIR ?? path.resolve(import.meta.dirname, "../data"),
  /** "mock" ships synthetic data. "simplefin" pulls your real accounts via SimpleFIN Bridge. */
  provider: (process.env.EZFIN_PROVIDER ?? "mock") as "mock" | "simplefin",
  /** Optional: a SimpleFIN access URL. If unset, the one claimed through the UI (stored in dataDir) is used. */
  simplefinAccessUrl: process.env.SIMPLEFIN_ACCESS_URL,
  /** Directory holding the built web app. When it exists, the API serves it so one process is the whole app. */
  staticDir: process.env.EZFIN_STATIC_DIR ?? path.resolve(import.meta.dirname, "../../web/dist"),
  /** Local AI. Defaults to an Ollama server on this machine. */
  ai: {
    /** "ollama" uses Ollama's native /api/chat. "openai" uses an OpenAI-compatible /v1/chat/completions (LM Studio, llama.cpp server, vLLM). */
    provider: (process.env.EZFIN_AI_PROVIDER ?? "ollama") as "ollama" | "openai",
    url: process.env.EZFIN_AI_URL ?? "http://127.0.0.1:11434",
    model: process.env.EZFIN_AI_MODEL ?? "qwen3:4b",
    /** Model conclusions below this confidence are ignored. */
    minConfidence: Number(process.env.EZFIN_AI_MIN_CONFIDENCE ?? 0.6),
    /** Merchants per model request. */
    batchSize: Number(process.env.EZFIN_AI_BATCH ?? 12),
    /** Escape hatch for an inference server that is not on loopback. Off by default on purpose. */
    allowRemote: process.env.EZFIN_AI_ALLOW_REMOTE === "1",
  },
  /** Set by the Dockerfile: inside a container the process must bind to the container interface. */
  allowNonLocalBind: process.env.EZFIN_ALLOW_NONLOCAL_BIND === "1",
};

export const VERSION = "0.1.0";
export const STARTED_AT = new Date().toISOString();

export function dbPath(): string {
  return path.join(env.dataDir, env.provider === "mock" ? "ezfin-demo.db" : "ezfin.db");
}
