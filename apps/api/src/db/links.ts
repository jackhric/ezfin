import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Db } from "./index.ts";
import { toLink, type LinkRow } from "./rows.ts";

type LinksSlice = Pick<
  Db,
  | "listLinks"
  | "listAllLinks"
  | "countRequests"
  | "recordRequest"
  | "getLink"
  | "createLink"
  | "markLinkSynced"
  | "deleteLink"
>;

/* ---- data-source links and the per-link provider_requests log ---- */

export function linksSlice(raw: DatabaseSync): LinksSlice {
  return {
    listLinks(userId) {
      return (
        raw
          .prepare("SELECT * FROM links WHERE user_id = ? ORDER BY created_at")
          .all(userId) as LinkRow[]
      ).map(toLink);
    },
    listAllLinks() {
      return (raw.prepare("SELECT * FROM links ORDER BY created_at").all() as LinkRow[]).map(
        toLink,
      );
    },
    countRequests(linkId, sinceISO) {
      return (
        raw
          .prepare("SELECT COUNT(*) AS n FROM provider_requests WHERE link_id = ? AND at >= ?")
          .get(linkId, sinceISO) as { n: number }
      ).n;
    },
    recordRequest(linkId) {
      raw
        .prepare("INSERT INTO provider_requests (link_id, at) VALUES (?, ?)")
        .run(linkId, new Date().toISOString());
      // Keep the log small: nothing older than two days matters.
      raw
        .prepare("DELETE FROM provider_requests WHERE at < ?")
        .run(new Date(Date.now() - 2 * 86_400_000).toISOString());
    },
    getLink(userId, id) {
      const r = raw.prepare("SELECT * FROM links WHERE user_id = ? AND id = ?").get(userId, id) as
        | LinkRow
        | undefined;
      return r ? toLink(r) : undefined;
    },
    createLink(userId, provider, label) {
      const row: LinkRow = {
        id: `lnk_${randomUUID()}`,
        user_id: userId,
        provider,
        label,
        created_at: new Date().toISOString(),
        last_synced_at: null,
        warnings: "[]",
      };
      raw
        .prepare(
          "INSERT INTO links (id, user_id, provider, label, created_at, last_synced_at, warnings) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(row.id, row.user_id, row.provider, row.label, row.created_at, null, row.warnings);
      return toLink(row);
    },
    markLinkSynced(id, warnings) {
      raw
        .prepare("UPDATE links SET last_synced_at = ?, warnings = ? WHERE id = ?")
        .run(new Date().toISOString(), JSON.stringify(warnings), id);
    },
    deleteLink(userId, id) {
      raw.exec("BEGIN");
      try {
        raw
          .prepare(
            "DELETE FROM transactions WHERE user_id = ? AND account_id IN (SELECT id FROM accounts WHERE link_id = ?)",
          )
          .run(userId, id);
        raw.prepare("DELETE FROM accounts WHERE user_id = ? AND link_id = ?").run(userId, id);
        raw.prepare("DELETE FROM provider_requests WHERE link_id = ?").run(id);
        raw.prepare("DELETE FROM links WHERE user_id = ? AND id = ?").run(userId, id);
        raw.exec("COMMIT");
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
