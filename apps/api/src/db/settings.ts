import type { DatabaseSync } from "node:sqlite";
import type { Db } from "./index.ts";

type SettingsSlice = Pick<Db, "getSetting" | "setSetting" | "deleteSetting">;

/* ---- key/value settings (sync schedule, request limit, AI auto-run) ---- */

export function settingsSlice(raw: DatabaseSync): SettingsSlice {
  return {
    getSetting(key) {
      const row = raw.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
        | { value: string }
        | undefined;
      return row?.value;
    },
    setSetting(key, value) {
      raw
        .prepare(
          "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(key, value);
    },
    deleteSetting(key) {
      raw.prepare("DELETE FROM settings WHERE key = ?").run(key);
    },
  };
}
