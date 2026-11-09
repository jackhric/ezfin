import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Db } from "./index.ts";
import { toUser, type UserRow } from "./rows.ts";

type UsersSlice = Pick<
  Db,
  | "countUsers"
  | "listUsers"
  | "createUser"
  | "updateUser"
  | "setPassword"
  | "deleteUser"
  | "deleteSessionsForUser"
  | "getUserByUsername"
  | "getUserById"
  | "createSession"
  | "getSessionUser"
  | "deleteSession"
>;

/* ---- users and sessions ---- */

export function usersSlice(raw: DatabaseSync): UsersSlice {
  return {
    countUsers() {
      return (raw.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
    },
    listUsers() {
      const rows = raw
        .prepare(`
        SELECT u.*, (SELECT COUNT(*) FROM accounts a WHERE a.user_id = u.id) AS accounts,
               (SELECT MAX(created_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen
        FROM users u ORDER BY u.created_at`)
        .all() as (UserRow & { accounts: number; last_seen: string | null })[];
      return rows.map((r) => ({ ...toUser(r), accounts: r.accounts, lastSeenAt: r.last_seen }));
    },
    createUser(u) {
      const row: UserRow = {
        id: `usr_${randomUUID()}`,
        username: u.username,
        email: u.email,
        password_hash: u.passwordHash,
        role: u.role,
        created_at: new Date().toISOString(),
      };
      raw
        .prepare(
          "INSERT INTO users (id, username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(row.id, row.username, row.email, row.password_hash, row.role, row.created_at);
      return toUser(row);
    },
    updateUser(id, patch) {
      const r = raw.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
      if (!r) return undefined;
      raw
        .prepare("UPDATE users SET username = ?, email = ?, role = ? WHERE id = ?")
        .run(patch.username ?? r.username, patch.email ?? r.email, patch.role ?? r.role, id);
      const updated = raw.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
      return toUser(updated);
    },
    setPassword(id, passwordHash) {
      raw.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
    },
    deleteUser(id) {
      raw.exec("BEGIN");
      try {
        raw.prepare("DELETE FROM transactions WHERE user_id = ?").run(id);
        raw.prepare("DELETE FROM accounts WHERE user_id = ?").run(id);
        raw.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
        raw.prepare("DELETE FROM links WHERE user_id = ?").run(id);
        raw.prepare("DELETE FROM settings WHERE key LIKE ?").run(`%:${id}`);
        raw.prepare("DELETE FROM users WHERE id = ?").run(id);
        raw.exec("COMMIT");
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
    deleteSessionsForUser(userId, exceptTokenHash) {
      if (exceptTokenHash)
        raw
          .prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?")
          .run(userId, exceptTokenHash);
      else raw.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    },
    getUserByUsername(username) {
      const r = raw.prepare("SELECT * FROM users WHERE username = ?").get(username) as
        | UserRow
        | undefined;
      return r ? { ...toUser(r), passwordHash: r.password_hash } : undefined;
    },
    getUserById(id) {
      const r = raw.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
      return r ? { ...toUser(r), passwordHash: r.password_hash } : undefined;
    },
    createSession(userId, tokenHash, expiresAt) {
      raw
        .prepare(
          "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        )
        .run(tokenHash, userId, new Date().toISOString(), expiresAt);
      raw.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
    },
    getSessionUser(tokenHash) {
      const r = raw
        .prepare(
          "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
        )
        .get(tokenHash, new Date().toISOString()) as UserRow | undefined;
      return r ? toUser(r) : undefined;
    },
    deleteSession(tokenHash) {
      raw.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    },
  };
}
