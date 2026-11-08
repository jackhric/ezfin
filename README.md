# ezfin

A local-first personal finance dashboard. Connect your bank and card accounts read-only, see where the money goes by category, and let the app figure out your subscriptions and recurring bills from the rhythm of your transactions.

Everything runs on your machine. See [PRIVACY.md](./PRIVACY.md) for the guarantees and how they are enforced.

## Stack

- **Vite+** (`vp`) as the toolchain: dev server, build, test, lint, format, and task runner in one CLI.
- **React 19 + TypeScript** with **Tailwind v4** and **shadcn/ui** (Nova preset, Radix primitives, Recharts).
- **Hono** on Node with the built-in `node:sqlite` for the local API. No native modules to compile.
- **pnpm workspace** with three packages:

| Package         | Purpose                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`      | The dashboard UI                                                                                                                 |
| `apps/api`      | Local JSON API, SQLite storage, provider adapters, sync                                                                          |
| `packages/core` | Pure, dependency-free logic: types, merchant normalization, categorization rules, recurring detection, summaries, synthetic data |

## Quick start

Requires Node 22.18+ and the Vite+ CLI (`npm i -g vite-plus`).

```sh
vp install
vp run dev
```

That starts the API on `http://127.0.0.1:8787` and the UI on `http://127.0.0.1:5173`, seeded with synthetic demo data. Or run them separately with `vp run dev:api` and `vp run dev:web`.

To run it as a single process (the API serves the built UI, no Vite dev server):

```sh
vp run start
```

Then open <http://127.0.0.1:8787>.

Other tasks:

```sh
vp check           # format, lint, type-check everything
vp run -r test     # unit tests for core and api
vp run -r build    # production build
vp run seed        # regenerate the demo database
```

## Running in a container

```sh
docker compose up --build
```

Or without compose:

```sh
docker build -t ezfin .
docker run --rm -p 127.0.0.1:8787:8787 -v ezfin-data:/data ezfin
```

Open <http://127.0.0.1:8787>. The database and SimpleFIN credential live in the `ezfin-data` volume. Keep the port published on `127.0.0.1` so nothing else on your network can reach the dashboard. To connect real accounts in the container, set `EZFIN_PROVIDER=simplefin` (there is a commented line in `compose.yaml`) and paste your setup token in Settings.

## Connecting real accounts

ezfin ships with a **SimpleFIN Bridge** adapter. SimpleFIN is a read-only aggregation protocol: you authorize your institutions once at the bridge, it issues a one-time setup token, and the app exchanges that for a read-only access URL. The protocol has no write operations.

1. Create a bridge account and link your institutions at <https://beta-bridge.simplefin.org>.
2. Generate a setup token there.
3. Start in SimpleFIN mode, either as one process or with the dev servers:
   ```sh
   EZFIN_PROVIDER=simplefin vp run start
   # or
   EZFIN_PROVIDER=simplefin vp run dev:api
   vp run dev:web
   ```
4. Open Settings in the UI, paste the setup token, press Connect. The first sync pulls about 13 months of history.

The adapter is hand-written against the public protocol spec (<https://www.simplefin.org/protocol.html>, v2) and the bridge developer guide (<https://beta-bridge.simplefin.org/info/developers>). It sends `version=2`, splits history into 90-day windows as the bridge requires, stays far below the 24-requests-per-day guideline, and shows every message from the bridge's error list in Settings.

The access URL is stored in `apps/api/data/simplefin.access` with 0600 permissions and is never displayed again. "Disconnect and wipe" deletes it along with the local database.

Other aggregators (Plaid, Teller, MX, a CSV importer) can be added by implementing the small `Provider` interface in `apps/api/src/providers/types.ts`.

## How categorization works

1. `normalizeMerchant` strips processor prefixes (`SQ *`, `TST*`), store numbers, reference codes, phone numbers, and trailing city/state so repeated charges collapse onto one merchant key.
2. `categorizeOne` checks user overrides first (exact merchant key to category), then an ordered list of regex rules in `packages/core/src/categorize.ts`.
3. In the UI, changing a transaction's category offers "Always file this merchant here". Accepting stores an override and recategorizes every other auto-categorized transaction from that merchant. Hand-set categories are never overwritten by later syncs.

## How recurring detection works

`detectRecurring` in `packages/core/src/recurring.ts` needs no merchant list:

1. Group debits by merchant key and collapse same-day splits.
2. Measure the gaps between charges and find the cadence (weekly, biweekly, monthly, quarterly, annual) that fits most gaps. At least 60% of gaps must fit and there must be at least 3 charges.
3. Compare each charge to the median. Small deviation means a fixed subscription; large deviation means a variable bill like a utility.
4. Score confidence from interval fit, amount stability, and sample size.
5. Project the next expected date and flag a series as possibly cancelled if it is overdue by more than half an interval.

Everything is normalized to a monthly equivalent so annual plans and weekly charges compare on one axis.

## Configuration

See [.env.example](./.env.example). The defaults are safe: mock data, loopback only.

## Layout

```
apps/
  api/src/
    app.ts            Hono routes
    server.ts         entry point, loopback bind, serves web/dist when built
    db.ts             node:sqlite schema and queries
    sync.ts           provider -> categorize -> persist
    providers/        mock, simplefin
  web/src/
    pages/            overview, transactions, categories, recurring, settings
    components/       layout, stat, category-badge, ui/ (shadcn)
    lib/              api client, formatting, query hook
packages/core/src/    types, categories, merchant, categorize, recurring, summary, synthetic
```
