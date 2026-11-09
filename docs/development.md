# Development

ezfin is a pnpm workspace driven by the Vite+ CLI (`vp`). Read [CLAUDE.md](../CLAUDE.md) for the house rules and [PRIVACY.md](../PRIVACY.md) before touching `apps/api`.

## Scripts

Workspace root (`package.json`):

| Command           | What it does                                                                |
| ----------------- | --------------------------------------------------------------------------- |
| `vp install`      | Install dependencies. Run after pulling.                                    |
| `vp run dev`      | API on `127.0.0.1:8787` and the Vite dev server on `127.0.0.1:5173`.        |
| `vp run dev:api`  | API only (`vpx --watch src/server.ts`).                                     |
| `vp run dev:web`  | UI only.                                                                    |
| `vp run start`    | Build the UI, then serve it from the API process. What the Dockerfile does. |
| `vp run reset`    | Delete the local database and every `.secret` credential file. Start over.  |
| `vp check`        | Format, lint and type-check everything (`--fix` applies formatting).        |
| `vp run -r test`  | Unit tests in `packages/core` and `apps/api`.                               |
| `vp run -r build` | Type-check the API and produce `apps/web/dist`.                             |
| `vp run ready`    | `vp check && vp run -r test && vp run -r build`.                            |

Per package: `vp run api#<script>` and `vp run web#<script>` run that package's `package.json` scripts.

Configuration is read from the process environment only (no `.env` file is loaded); see [.env.example](../.env.example).

## Layout

```
apps/
  api/
    src/
      server.ts           entry point: opens the db, wires providers, AI and scheduler, binds to loopback, serves web/dist
      app.ts              createApp(): Hono instance, host check, middleware order, route registration
      env.ts              runtime config from EZFIN_* variables; loopback defaults
      auth.ts             scrypt passwords, cookie sessions, requireUser/requireAdmin, login limiter
      sync.ts             syncLink/syncUser: provider -> categorize -> persist; budgetFor()
      scheduler.ts        twice-daily sync at configured local times; runAll() for "Run now"
      secrets.ts          SecretStore interface; FileSecretStore (0600 files), MemorySecretStore (tests)
      reset.ts            `vp run reset`
      routes/
        context.ts        Env/AppDeps/RouteContext types, buildContext(), strip()
        auth.ts           /api/auth/* (public): status, setup, login, logout
        me.ts             /api/me, password change, sign out elsewhere
        users.ts          /api/users (admin): list, create, edit, reset password, delete
        server.ts         /api/server/info and /api/server/sync-schedule (admin)
        finance.ts        status, accounts, categories, transactions, rules, summary, recurring, sync
        links.ts          /api/links: SimpleFIN claim, demo, per-link sync, unlink, disconnect
        ai.ts             /api/ai: status, categorize, auto toggle, forget insights
      db/
        index.ts          Db interface, User/Link/MerchantProfile types, openDb() facade
        schema.ts         CREATE TABLE statements and migrate()
        rows.ts           snake_case row types and toUser/toLink/toAccount/toTx
        users.ts          users and sessions
        links.ts          links and the provider_requests log
        ledger.ts         accounts, transactions, category overrides, recategorize, clearData
        insights.ts       merchant_insights and listMerchants (the model's view)
        settings.ts       key/value settings
      providers/
        types.ts          Provider, RequestBudget, BudgetExceededError, ProviderFetch
        simplefin.ts      SimpleFIN Bridge adapter (claim, 90-day windows, mapResponse)
        mock.ts           demo provider backed by synthetic data
        index.ts          re-exports
      ai/
        classifier.ts     LocalClassifier (Ollama or OpenAI-compatible), assertLocal, parseResults
        job.ts            AiJob: one background categorization run at a time
    tests/                see below
    data/                 SQLite file and .secret files; gitignored
  web/
    src/
      main.tsx            router, OS color scheme, providers
      index.css           Tailwind v4 theme tokens
      components/
        layout.tsx        app shell: nav, sync button, user menu
        page.tsx          PageHeader, LoadingBlock
        stat.tsx          big-number tile
        category-badge.tsx
        ui/               vendored shadcn components (not linted)
      lib/
        api.ts            typed fetch client and response types
        auth.tsx          AuthProvider/useAuth
        use-query.ts      minimal data hook
        format.ts         money, dates, category colors
        utils.ts          cn()
      pages/
        overview.tsx, transactions.tsx, categories.tsx, recurring.tsx, auth.tsx
        settings/
          layout.tsx      SettingsLayout (two-group nav) and AdminOnly
          _shared.tsx     Section and Field primitives every settings page uses
          profile.tsx, security.tsx, data-source.tsx, privacy.tsx      (Account group)
          users.tsx, ai.tsx, server.tsx, schedule.tsx                   (Administration group; schedule is embedded in server)
packages/
  core/
    src/
      types.ts            Account, Transaction, MerchantInsight, ...
      categories.ts       CATEGORIES and CATEGORY_BY_ID
      merchant.ts         normalizeMerchant(): raw description -> stable merchant key
      categorize.ts       DEFAULT_RULES and categorizeOne(): override > insight > rules
      recurring.ts        detectRecurring()
      summary.ts          summarizeByMonth, totalsByCategory, netWorth
      synthetic.ts        seeded synthetic accounts and transactions
      dates.ts            ISO date helpers
      index.ts            public exports
    tests/
docs/                     this folder
```

## Tests

Both packages use `vp test` (Vitest). `packages/core` must stay dependency-free, so its tests exercise pure functions on synthetic data.

`apps/api/tests`:

| File                | Covers                                                                  |
| ------------------- | ----------------------------------------------------------------------- |
| `helpers.ts`        | `makeApp()`: in-memory db, first user signed in, demo link; `Json` type |
| `api.test.ts`       | Host check, demo sync, summaries, merchant rules, bad SimpleFIN token   |
| `auth.test.ts`      | Password hashing, sessions, user isolation                              |
| `admin.test.ts`     | Profile edits, server info, user management rules                       |
| `links.test.ts`     | SimpleFIN link lifecycle against a fake bridge                          |
| `simplefin.test.ts` | `mapResponse` (v1 and v2) and `dateWindows`                             |
| `budget.test.ts`    | Request budget counting and the admin limit                             |
| `scheduler.test.ts` | Time validation, `nextRun`, `tick`, `start()`/`stop()` with fake timers |
| `secrets.test.ts`   | `FileSecretStore` in a temp dir, including the 0600 mode                |
| `ai.test.ts`        | `assertLocal`, result parsing, `AiJob` with a stub classifier           |

Routes are tested through `app.request()`; no port is opened. Use `MemorySecretStore` and `openDb(":memory:")`.

## Recipes

### Adding a provider

1. Implement `Provider` from `apps/api/src/providers/types.ts`. `fetch(sinceISO, secret, budget)` returns accounts and transactions without categories. Check `budget.remaining` before starting and call `budget.spend()` for every outbound request; see `simplefin.ts`.
2. Add the id to `LinkProvider` in `apps/api/src/db/index.ts` and to `Provider["id"]`, and map the row value in `toLink` (`db/rows.ts`).
3. Register an instance in `providers` in `apps/api/src/server.ts` (and in `tests/helpers.ts`).
4. Add a route that creates the link and stores its credential through `SecretStore` in `apps/api/src/routes/links.ts`, following `/api/links/simplefin`. Credentials never go into SQLite.
5. Add a card to `apps/web/src/pages/settings/data-source.tsx` and a `detail` line in `linkView` (`routes/context.ts`).

### Adding a route module

1. Create `apps/api/src/routes/<name>.ts` exporting `register<Name>Routes(app: Api, ctx: RouteContext)`. Everything shared (db, secrets, `syncDeps`, `linkView`, `resolver`, `requestLimit`) is on `ctx`.
2. Call it from `createApp` in `apps/api/src/app.ts` **after** `requireUser` (and after the `requireAdmin` lines for admin routes). Hono only applies middleware registered before a handler, so the order in `app.ts` is the access control.
3. Scope every query to `c.get("user").id`. A new `Db` method that touches accounts or transactions takes a `userId`.
4. Add the client call to `apps/web/src/lib/api.ts` and a smoke test in `apps/api/tests`.

### Adding a categorization rule

1. Add an entry to `DEFAULT_RULES` in `packages/core/src/categorize.ts`. Order matters: first match wins. Use `direction` to restrict to credits or debits.
2. Add an assertion to `packages/core/tests/categorize.test.ts` with a realistic raw description.
3. If the merchant key comes out wrong, fix `normalizeMerchant` in `merchant.ts` and add a case to `merchant.test.ts` instead.

### Adding a settings section

1. Create `apps/web/src/pages/settings/<name>.tsx`. Wrap the page in `Section` and use `Field` rows from `./_shared`.
2. Add the route in `apps/web/src/main.tsx` under `settings`. Wrap administration pages in `AdminOnly`.
3. Add a nav item to `ACCOUNT` or `ADMIN` in `pages/settings/layout.tsx`.
4. If it needs new data, add the API call to `lib/api.ts` and the route on the server (admin routes live under `/api/server/*`).

UI widgets come from shadcn: `pnpm dlx shadcn@latest add <name>` inside `apps/web`.
