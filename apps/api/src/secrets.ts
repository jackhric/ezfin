import fs from "node:fs";
import path from "node:path";

/**
 * Where provider credentials live. One file per data-source link, mode 0600,
 * inside the data directory, never inside the database (so a copied .db file
 * is not enough to pull someone's bank data).
 */
export interface SecretStore {
  get(linkId: string): string | undefined;
  set(linkId: string, value: string): void;
  delete(linkId: string): void;
}

export class FileSecretStore implements SecretStore {
  constructor(private readonly dir: string) {}
  private file(linkId: string): string {
    return path.join(this.dir, `${linkId.replace(/[^a-z0-9_-]/gi, "")}.secret`);
  }
  get(linkId: string) {
    try {
      return fs.readFileSync(this.file(linkId), "utf8").trim() || undefined;
    } catch {
      return undefined;
    }
  }
  set(linkId: string, value: string) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file(linkId), value + "\n", { mode: 0o600 });
  }
  delete(linkId: string) {
    try {
      fs.rmSync(this.file(linkId));
    } catch {
      /* already gone */
    }
  }
}

/** For tests. */
export class MemorySecretStore implements SecretStore {
  private readonly map = new Map<string, string>();
  get(id: string) {
    return this.map.get(id);
  }
  set(id: string, v: string) {
    this.map.set(id, v);
  }
  delete(id: string) {
    this.map.delete(id);
  }
}
