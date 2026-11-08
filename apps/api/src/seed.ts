/**
 * Reset the demo database. Safe to run anytime; touches only ezfin-demo.db.
 * Demo data is generated for a user when they finish setup, so this just wipes.
 */
import fs from "node:fs";
import path from "node:path";
import { openDb } from "./db.ts";
import { env } from "./env.ts";

const file = path.join(env.dataDir, "ezfin-demo.db");
for (const suffix of ["", "-wal", "-shm"]) {
  try {
    fs.rmSync(file + suffix);
  } catch {
    /* not present */
  }
}
const db = openDb(file);
db.close();
console.log(
  `Reset ${file}. Open the app, create your account, and demo data will be generated for it.`,
);
