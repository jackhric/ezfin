import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { FileSecretStore } from "../src/secrets.ts";

describe("FileSecretStore", () => {
  const dirs: string[] = [];
  const tempDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ezfin-secrets-"));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it("writes, reads back and deletes one file per link", () => {
    const dir = tempDir();
    const store = new FileSecretStore(path.join(dir, "nested"));
    expect(store.get("lnk_a")).toBeUndefined();

    store.set("lnk_a", "https://user:pass@bridge.example/simplefin");
    expect(store.get("lnk_a")).toBe("https://user:pass@bridge.example/simplefin");
    expect(fs.existsSync(path.join(dir, "nested", "lnk_a.secret"))).toBe(true);
    // Each link has its own file.
    store.set("lnk_b", "other");
    expect(store.get("lnk_a")).toBe("https://user:pass@bridge.example/simplefin");
    expect(store.get("lnk_b")).toBe("other");

    store.delete("lnk_a");
    expect(store.get("lnk_a")).toBeUndefined();
    expect(fs.existsSync(path.join(dir, "nested", "lnk_a.secret"))).toBe(false);
    // Deleting twice is fine.
    expect(() => store.delete("lnk_a")).not.toThrow();
  });

  it("keeps the credential file private (mode 0600)", () => {
    const dir = tempDir();
    const store = new FileSecretStore(dir);
    store.set("lnk_a", "secret");
    if (process.platform === "win32") return; // no POSIX modes
    expect(fs.statSync(path.join(dir, "lnk_a.secret")).mode & 0o777).toBe(0o600);
  });

  it("only ever writes inside its own directory", () => {
    const dir = tempDir();
    const store = new FileSecretStore(dir);
    store.set("../escape", "x");
    expect(fs.readdirSync(dir)).toEqual(["escape.secret"]);
    expect(fs.existsSync(path.join(dir, "..", "escape.secret"))).toBe(false);
  });
});
