/** Regenerate the demo database from synthetic data. Safe to run anytime; touches only ezfin-demo.db. */
import fs from "node:fs";
import path from "node:path";
import { openDb } from "./db.ts";
import { env } from "./env.ts";
import { MockProvider } from "./providers/mock.ts";
import { runSync } from "./sync.ts";

const file = path.join(env.dataDir, "ezfin-demo.db");
for (const suffix of ["", "-wal", "-shm"]) {
  try {
    fs.rmSync(file + suffix);
  } catch {
    /* not present */
  }
}
const db = openDb(file);
const result = await runSync(db, new MockProvider());
console.log(
  `Seeded ${result.accounts} accounts and ${result.transactions} transactions into ${file}`,
);
db.close();
