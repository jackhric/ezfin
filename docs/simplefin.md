# Connecting real accounts with SimpleFIN

Bank access is a **link on your user account**, not a server setting. Each person on an install links their own banks, and a link imports every account the bridge exposes.

ezfin ships a **SimpleFIN Bridge** adapter. SimpleFIN is a read-only aggregation protocol: you authorize your institutions once at the bridge, it issues a one-time setup token, and the app exchanges that for a read-only access URL. The protocol has no write operations.

## Linking

1. Create a bridge account and link your institutions at <https://beta-bridge.simplefin.org>.
2. Generate a setup token there.
3. In ezfin, open Settings > Data source, press **Link SimpleFIN**, paste the token. The token is SimpleFIN's own one-time handshake (a base64-encoded claim URL); ezfin exchanges it immediately for a per-link credential file and you never see it again. All accounts are imported on the spot, with about 13 months of history.
4. Press **Sync** on the link (or the global Sync button) whenever you want fresh data. **Unlink** removes the credential and everything imported through it.

You can have several links (two bridge accounts, or demo data alongside a real bank). Account and transaction ids are namespaced per link, so nothing collides.

## Scheduled sync and the request budget

SimpleFIN refreshes from banks about once a day and expects clients to make 24 or fewer requests per day per access token. ezfin handles both:

- A built-in scheduler (`apps/api/src/scheduler.ts`) syncs every person's links twice a day, at **05:23 and 17:35** server time by default, a few minutes off the hour because the bridge is busiest on the hour. Administrators change the times, switch it off, or press **Run now** under Settings > Server. In Docker, set `TZ` in `compose.yaml` so "05:00" means your 05:00.
- Every request to the bridge is logged per link in the `provider_requests` table. A link may make at most **16** requests in a rolling 24 hours (admin-adjustable, capped at 24). A sync that would exceed the budget is refused before any request is sent, with a message saying how many remain. A first import costs about 5 requests (90-day windows over 13 months); each later sync costs 1. Each link card shows its usage.

In code, the budget is the `RequestBudget` passed to every `Provider.fetch()` call (`apps/api/src/sync.ts`, `budgetFor`). A provider checks `remaining` before it starts and calls `spend()` for every request it actually sends. Any new outbound request must go through `spend()` or the quota drifts.

## The adapter

The adapter (`apps/api/src/providers/simplefin.ts`) is hand-written against the public protocol spec (<https://www.simplefin.org/protocol.html>, v2) and the bridge developer guide (<https://beta-bridge.simplefin.org/info/developers>). It sends `version=2`, splits history into 90-day windows as the bridge requires, stays far below the 24-requests-per-day guideline, and shows every message from the bridge's error list on the link.

Credentials are stored as `apps/api/data/<link id>.secret` with 0600 permissions, outside the database (`apps/api/src/secrets.ts`). Other aggregators (Plaid, Teller, MX, a CSV importer) can be added by implementing the small `Provider` interface in `apps/api/src/providers/types.ts` and registering it as a link provider; see [development.md](./development.md#adding-a-provider).
