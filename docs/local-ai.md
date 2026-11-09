# Local AI categorization (optional)

Rules get the obvious merchants right. For everything else, ezfin can ask a small language model running **on your machine** to say what a merchant is and which category it belongs to. The result is a plain-English label under each transaction (for example "ramen restaurant" or "cloud storage subscription") and a category for merchants the rules could not place.

## Setup

With Ollama, the default:

```sh
# install from https://ollama.com, then
ollama pull qwen3:4b
vp run start
```

Open Settings > Local AI (administrators only), confirm the status badge says "ready", and press **Categorize unknowns**. **Re-examine everything** lets the model overrule the rules when it is confident. The switch under the buttons runs the model on new unknown merchants after every sync.

## How it works

- The API groups transactions by merchant key and sends the model batches of merchants: the key, up to three raw descriptions, a typical amount and a count. Nothing else.
- The model answers with structured JSON (enforced by a JSON schema) containing a category id, a short label and a confidence.
- Answers are validated (unknown merchants and invalid categories are dropped) and stored in the local `merchant_insights` table.
- Categories resolve as: your own choices, then the model when confidence is at least `EZFIN_AI_MIN_CONFIDENCE` (0.6), then the built-in rules. Hand-set categories are never touched.
- "Forget model results" wipes the table and recategorizes from rules again.

The code lives in `apps/api/src/ai/`: `classifier.ts` talks to the model server and validates its answers; `job.ts` is the one-at-a-time background job that walks merchants in batches and recategorizes afterwards. The HTTP routes are in `apps/api/src/routes/ai.ts`.

## Privacy enforcement

The API refuses any AI endpoint whose hostname is not loopback (or `host.docker.internal` inside the container); see `assertLocal` in `apps/api/src/ai/classifier.ts`. To point at something else you must set `EZFIN_AI_ALLOW_REMOTE=1` deliberately. There is no hosted-provider option and none should be added.

## Other servers and models

Any OpenAI-compatible endpoint (LM Studio, llama.cpp `llama-server`, vLLM) works with `EZFIN_AI_PROVIDER=openai`, `EZFIN_AI_URL=http://127.0.0.1:1234` and `EZFIN_AI_MODEL=<name>`. Models in the 3B to 4B range tested or expected to work well: `qwen3:4b` (tested), `gemma3:4b`, `llama3.2:3b`, `phi4-mini`. On a CPU-only machine a batch of 12 merchants takes about a minute; on Apple Silicon or a GPU it is a few seconds.

All `EZFIN_AI_*` variables are listed in [.env.example](../.env.example).

## Configuring and testing from the UI

Administrators can change the provider, server URL, model, confidence floor and batch size under Settings, Local AI, without restarting. Environment variables only supply the defaults. Every change passes the same loopback guard as the environment path, so a URL on another machine is refused unless `EZFIN_AI_ALLOW_REMOTE=1` was set at startup; that flag is deliberately not editable from the page.

**Test connection** sends one real request: it checks the server answers, that the model is installed (and lists what is), then classifies a fixed sample merchant and reports the round-trip time and the model's answer. Use it after installing Ollama, after pulling a new model, or when categorization seems stuck.

On the Data source page, each link has a **Test** button. For SimpleFIN it makes a single balances-only request (counted against the link's budget) and reports the accounts and institutions the bridge exposes plus any bridge messages, without importing anything.
