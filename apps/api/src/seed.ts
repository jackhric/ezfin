/**
 * Reset the local database (users, links, accounts, everything). Credential files
 * in the data folder are removed too. Run this to start over.
 */
import fs from "node:fs";
import path from "node:path";
import { openDb } from "./db.ts";
import { env } from "./env.ts";

const file = path.join(env.dataDir, "ezfin.db");
for (const suffix of ["", "-wal", "-shm"]) {
  try {
    fs.rmSync(file + suffix);
  } catch {
    /* not present */
  }
}
for (const f of fs.readdirSync(env.dataDir))
  if (f.endsWith(".secret")) fs.rmSync(path.join(env.dataDir, f));
const db = openDb(file);
db.close();
console.log(
  `Reset ${file}. Open the app and create your account; add demo data or link SimpleFIN from Settings.`,
);
