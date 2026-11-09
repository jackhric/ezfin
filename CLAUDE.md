<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Running Scripts

Run TypeScript and JavaScript files with `vpx <file>`, for example `vpx ./scripts/seed.ts --dry-run`. It handles enums, decorators, JSX, and tsconfig `paths`, so do not add `tsx` or `ts-node` to run scripts. `vpx --watch <file>` reruns the file when a file it uses changes, in place of `tsx watch`. `vp node <file>` runs plain Node.js.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# ezfin project notes

- Every outbound provider request must go through `RequestBudget.spend()` so the per-link quota (`provider_requests`) stays accurate. The scheduler lives in `apps/api/src/scheduler.ts`.
- Bank access is a per-user link (`links` table in `apps/api/src/db/links.ts`, synced by `apps/api/src/sync.ts`), never a server-wide setting. Credentials go through `SecretStore`, never into SQLite.
- Every financial route must be scoped to `c.get("user").id`. A new `Db` method that touches accounts or transactions takes a `userId`.
- API routes live in `apps/api/src/routes/*.ts`, one module per group, each `registerXRoutes(app, ctx)` called from `createApp` in `apps/api/src/app.ts`. The middleware order there (host check, public auth routes, `requireUser`, `requireAdmin`) is the access control; register new routes after it, never before.
- The `Db` interface and `openDb` facade are in `apps/api/src/db/index.ts`; queries are split into per-table slices beside it (`users`, `links`, `ledger`, `insights`, `settings`), with SQL and migrations in `db/schema.ts`.
- Privacy is the product. Never add network calls from the web app, never log transaction contents, never widen the API bind address, and never commit anything under `apps/api/data`. Read `PRIVACY.md` before touching `apps/api`.
- All development happens against synthetic data from `packages/core/src/synthetic.ts`. Do not ask for, paste, or fabricate real financial records.
- AI settings are runtime-editable through `AiService` (`apps/api/src/ai/service.ts`); `allowRemote` stays env-only. The AI step (`apps/api/src/ai`) may only talk to a loopback model server. Never add a hosted LLM provider. Prompts send merchant keys and descriptions only.
- `packages/core` must stay dependency-free and pure. New categorization rules go in `categorize.ts` with a test in `packages/core/tests`.
- UI components come from shadcn (`pnpm dlx shadcn@latest add <name>` inside `apps/web`). Prefer them over hand-rolled widgets.
- Run `vp check` and `vp run -r test` before committing. `vp run reset` (`apps/api/src/reset.ts`) wipes the local database and credentials.
- Longer documentation lives in `docs/` (`simplefin.md`, `local-ai.md`, `recurring.md`, `development.md`); the README only links to it. Update the layout tree in `docs/development.md` when files move.
- `vp run start` builds the UI and serves it from the API process. The Dockerfile does the same; keep its COPY list in sync with the workspace layout.
