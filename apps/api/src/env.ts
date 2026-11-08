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
};

export function dbPath(): string {
  return path.join(env.dataDir, env.provider === "mock" ? "ezfin-demo.db" : "ezfin.db");
}
