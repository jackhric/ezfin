# Privacy model

ezfin is built so that the person running it is the only party that ever sees their financial data. This document states the guarantees, how they are enforced in code, and the limits.

## Guarantees

1. **Your data stays on your machine.** Accounts and transactions are stored in a SQLite file in `apps/api/data/` (or `EZFIN_DATA_DIR`). The file is created with mode 0600.
2. **The API is loopback only.** `apps/api/src/server.ts` binds to `127.0.0.1` by default, and `apps/api/src/app.ts` rejects any request whose `Host` header is not a local address. Responses are sent with `Cache-Control: no-store`.
3. **The browser cannot phone home.** `apps/web/index.html` carries a Content Security Policy with `connect-src 'self'`, so the UI can only talk to the local API. No analytics, fonts, or scripts are loaded from the network.
4. **No AI or cloud processing.** Categorization (`packages/core/src/categorize.ts`) and recurring-charge detection (`packages/core/src/recurring.ts`) are deterministic, rule-based algorithms that run in the local process.
5. **One outbound connection, on demand.** The only network call the API makes is to your aggregator (SimpleFIN Bridge) when you press Sync. SimpleFIN is a read-only protocol; there is no way to move money through it.
6. **Secrets are not in the repo.** The SimpleFIN access URL is written to `apps/api/data/simplefin.access` (0600). That directory, every `*.db` file, and `.env*` files are gitignored.
7. **The code was written without access to real data.** Everything in this repository was developed and tested against the synthetic generator in `packages/core/src/synthetic.ts`. Seed 42 produces the demo you see on first run.

## Running in Docker

Inside a container the process has to bind to the container's interface (`0.0.0.0`), which is why the Dockerfile sets `EZFIN_ALLOW_NONLOCAL_BIND=1`. Isolation then comes from how you publish the port: `compose.yaml` and the README both publish `127.0.0.1:8787:8787`, so only the host machine can reach it. The Host-header check still applies, so a request addressed to your LAN IP is refused even if the port were published more widely. Data and the SimpleFIN credential live in the `ezfin-data` volume, not in the image.

## What you still have to do

- Run it on a computer you control. Anyone with your OS user account can read the data file.
- Do not set `EZFIN_HOST` to anything other than loopback. The server prints a warning if you do.
- Treat the setup token and the data folder like a password. "Disconnect and wipe" in Settings removes both.
- If you share screenshots or logs, remember the API logs sync counts only, never transaction contents, but the browser UI obviously shows everything.

## Threat model summary

| Threat                                         | Covered? | How                                                                               |
| ---------------------------------------------- | -------- | --------------------------------------------------------------------------------- |
| Developer or AI assistant seeing your data     | Yes      | Nothing is transmitted; the repo ships only synthetic data                        |
| Another device on your LAN reading the API     | Yes      | Loopback bind plus Host check                                                     |
| A malicious script in the UI exfiltrating data | Yes      | CSP `connect-src 'self'`                                                          |
| Accidental `git add` of your data              | Yes      | gitignore rules for the data dir, `*.db`, `.env*`                                 |
| Malware running as your OS user                | No       | Out of scope; use full-disk encryption and OS hygiene                             |
| Your bank aggregator's own security            | No       | SimpleFIN holds read-only bank credentials on your behalf; review their practices |
