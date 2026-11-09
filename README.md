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

That starts the API on `http://127.0.0.1:8787` and the UI on `http://127.0.0.1:5173`. The first visit asks you to create your account (username, email, password). Then link your bank through SimpleFIN, or load demo data to look around, from Settings > Data source. Or run them separately with `vp run dev:api` and `vp run dev:web`.

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
vp run reset       # wipe the local database and credentials
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

Open <http://127.0.0.1:8787>. The database and bank credentials live in the `ezfin-data` volume. Keep the port published on `127.0.0.1` so nothing else on your network can reach the dashboard.

## Accounts and sign-in

ezfin has its own tiny account system, built on Node's standard library with no auth framework. First run shows a one-time setup form; the account you create is the administrator and owns every financial account you connect afterwards. Passwords are hashed with scrypt; sessions are random tokens in an httpOnly, SameSite=Strict cookie, stored only as a SHA-256 hash. Every financial route is scoped to the signed-in user. Administrators add more people from Settings > Users, and each gets their own bank links, accounts and transactions. There is no password reset by design: forget it and you delete the data folder and start over.

## Configuration

Settings are read from the process environment; see [.env.example](./.env.example). The defaults are safe: loopback only, demo data optional.

## Layout

The workspace layout, one line per file, is in [docs/development.md](./docs/development.md#layout).

## Further reading

- [docs/simplefin.md](./docs/simplefin.md): connecting real accounts, the request budget and scheduled sync.
- [docs/local-ai.md](./docs/local-ai.md): optional on-device categorization with Ollama or any OpenAI-compatible server.
- [docs/recurring.md](./docs/recurring.md): how subscriptions and recurring bills are detected.
- [docs/development.md](./docs/development.md): scripts, layout, tests, and how to add a provider, a route module, a categorization rule or a settings section.
- [PRIVACY.md](./PRIVACY.md): the guarantees and how they are enforced.
