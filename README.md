# ezfin

A local-first personal finance dashboard. Connect your bank and card accounts read-only, see where the money goes by category, and let the app figure out your subscriptions and recurring bills from the rhythm of your transactions.

Everything runs on your machine. See [PRIVACY.md](./PRIVACY.md) for the guarantees and how they are enforced.

## Stack

- **Vite+** (`vp`) as the toolchain: dev server, build, test, lint, format, and task runner in one CLI.
- **React 19 + TypeScript** with **Tailwind v4** and **shadcn/ui** (Nova preset, Radix primitives, Recharts).
- **Hono** on Node with the built-in `node:sqlite` for the local API. No native modules to compile.
- **Ollama** (or any OpenAI-compatible local server) for optional on-device AI categorization with a small model such as `qwen3:4b`.
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

That starts the API on `http://127.0.0.1:8787` and the UI on `http://127.0.0.1:5173`. The first visit asks you to create your account (username, email, password). In demo mode, synthetic data is generated for that account on the spot. Or run them separately with `vp run dev:api` and `vp run dev:web`.

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

## Accounts and sign-in

ezfin has its own tiny account system, built on Node's standard library with no auth framework:

- First run shows a one-time setup form. The account you create owns every financial account you connect afterwards.
- Passwords are hashed with scrypt and a random salt. Sessions are random tokens in an httpOnly, SameSite=Strict cookie; only a SHA-256 of the token is stored.
- Every financial route is scoped to the signed-in user. More people can be added from Settings, and each gets their own bank link, accounts and transactions. Merchant knowledge (rules the model or you taught it) is shared across people on the install.
- There is no password reset by design. Forget it and you delete the data folder and start over.

If you later want OAuth, passkeys or email flows, Better Auth is the library to reach for; it supports Hono and SQLite. For a local-only app the standard-library version above is smaller and has no network surface.

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
4. Sign in, open Settings, paste the setup token, press Connect. The first sync pulls about 13 months of history. The token is SimpleFIN's own one-time handshake (a base64-encoded claim URL); ezfin exchanges it immediately for a per-user credential file and you never see it again.

The adapter is hand-written against the public protocol spec (<https://www.simplefin.org/protocol.html>, v2) and the bridge developer guide (<https://beta-bridge.simplefin.org/info/developers>). It sends `version=2`, splits history into 90-day windows as the bridge requires, stays far below the 24-requests-per-day guideline, and shows every message from the bridge's error list in Settings.

The access URL is stored in `apps/api/data/simplefin.access` with 0600 permissions and is never displayed again. "Disconnect and wipe" deletes it along with the local database.

Other aggregators (Plaid, Teller, MX, a CSV importer) can be added by implementing the small `Provider` interface in `apps/api/src/providers/types.ts`.

## How categorization works

1. `normalizeMerchant` strips processor prefixes (`SQ *`, `TST*`), store numbers, reference codes, phone numbers, and trailing city/state so repeated charges collapse onto one merchant key.
2. `categorizeOne` checks user overrides first (exact merchant key to category), then an ordered list of regex rules in `packages/core/src/categorize.ts`.
3. In the UI, changing a transaction's category offers "Always file this merchant here". Accepting stores an override and recategorizes every other auto-categorized transaction from that merchant. Hand-set categories are never overwritten by later syncs.

## Local AI categorization (optional)

Rules get the obvious merchants right. For everything else, ezfin can ask a small language model running **on your machine** to say what a merchant is and which category it belongs to. The result is a plain-English label under each transaction (for example "ramen restaurant" or "cloud storage subscription") and a category for merchants the rules could not place.

Setup with Ollama, the default:

```sh
# install from https://ollama.com, then
ollama pull qwen3:4b
vp run start
```

Open Settings, confirm the Local AI card says "ready", and press **Categorize unknowns**. **Re-examine everything** lets the model overrule the rules when it is confident. The switch under the buttons runs the model on new unknown merchants after every sync.

How it works:

- The API groups transactions by merchant key and sends the model batches of merchants: the key, up to three raw descriptions, a typical amount and a count. Nothing else.
- The model answers with structured JSON (enforced by a JSON schema) containing a category id, a short label and a confidence.
- Answers are validated (unknown merchants and invalid categories are dropped) and stored in the local `merchant_insights` table.
- Categories resolve as: your own choices, then the model when confidence is at least `EZFIN_AI_MIN_CONFIDENCE` (0.6), then the built-in rules. Hand-set categories are never touched.
- "Forget model results" wipes the table and recategorizes from rules again.

Privacy enforcement: the API refuses any AI endpoint whose hostname is not loopback (or `host.docker.internal` inside the container). To point at something else you must set `EZFIN_AI_ALLOW_REMOTE=1` deliberately.

Other servers: any OpenAI-compatible endpoint (LM Studio, llama.cpp `llama-server`, vLLM) works with `EZFIN_AI_PROVIDER=openai`, `EZFIN_AI_URL=http://127.0.0.1:1234` and `EZFIN_AI_MODEL=<name>`. Models in the 3B to 4B range tested or expected to work well: `qwen3:4b` (tested), `gemma3:4b`, `llama3.2:3b`, `phi4-mini`. On a CPU-only machine a batch of 12 merchants takes about a minute; on Apple Silicon or a GPU it is a few seconds.

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
    auth.ts           scrypt passwords, cookie sessions, login limiter
    server.ts         entry point, loopback bind, serves web/dist when built
    db.ts             node:sqlite schema and queries
    sync.ts           provider -> categorize -> persist
    providers/        mock, simplefin
    ai/               local-model classifier (Ollama or OpenAI-compatible) and background job
  web/src/
    pages/            overview, transactions, categories, recurring, settings
    components/       layout, stat, category-badge, ui/ (shadcn)
    lib/              api client, formatting, query hook
packages/core/src/    types, categories, merchant, categorize, recurring, summary, synthetic
```
