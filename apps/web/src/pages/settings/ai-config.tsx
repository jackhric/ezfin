import { CheckCircle2, PlugZap, RefreshCw, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CategoryBadge } from "@/components/category-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type AiConfig, type AiTestResult } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Field } from "./_shared";

const OTHER = "__other__";

/**
 * Admin form for the model server. The model dropdown is filled from whatever
 * server is in the URL field (saved or not), refetched when provider or URL
 * change. Every save goes through the API's network guard.
 */
export function AiConfigForm({ onSaved }: { onSaved: () => void }) {
  const [cfg, setCfg] = useState<AiConfig>();
  const [draft, setDraft] = useState<AiConfig>();
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<AiTestResult | "running">();
  const [models, setModels] = useState<{
    list: string[];
    reachable: boolean;
    error?: string;
    loading: boolean;
  }>({ list: [], reachable: false, loading: false });
  const [typing, setTyping] = useState(false);
  const fetchSeq = useRef(0);

  useEffect(() => {
    api.aiConfig().then(
      ({ config }) => {
        setCfg(config);
        setDraft(config);
      },
      (e: unknown) => setMsg(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  // Refetch the model list whenever the server changes, after a short pause in typing.
  const provider = draft?.provider;
  const url = draft?.url;
  useEffect(() => {
    if (!provider || !url) return;
    const seq = ++fetchSeq.current;
    setModels((m) => ({ ...m, loading: true }));
    const t = setTimeout(async () => {
      try {
        const r = await api.aiModels(provider, url);
        if (seq !== fetchSeq.current) return;
        setModels({ list: r.models, reachable: r.reachable, error: r.error, loading: false });
      } catch (e) {
        if (seq !== fetchSeq.current) return;
        setModels({
          list: [],
          reachable: false,
          error: e instanceof Error ? e.message : String(e),
          loading: false,
        });
      }
    }, 500);
    return () => clearTimeout(t);
  }, [provider, url]);

  if (!cfg || !draft) return null;
  const dirty = JSON.stringify(cfg) !== JSON.stringify(draft);
  const set = <K extends keyof AiConfig>(k: K, v: AiConfig[K]) => setDraft({ ...draft, [k]: v });
  const listed = models.list.includes(draft.model);
  const options = listed || !draft.model ? models.list : [draft.model, ...models.list];

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setMsg(undefined);
    try {
      const { config } = await api.updateAiConfig(draft);
      setCfg(config);
      setDraft(config);
      setMsg("Saved. Press Test connection to confirm the model answers.");
      onSaved();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setTest("running");
    setMsg(undefined);
    try {
      setTest(await api.aiTest());
      onSaved();
    } catch (err) {
      setTest({
        ok: false,
        reachable: false,
        modelAvailable: false,
        models: [],
        url: cfg?.url ?? "",
        model: cfg?.model ?? "",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <form onSubmit={save} className="space-y-6 border-t pt-6">
      <div>
        <h3 className="font-medium">Model server</h3>
        <p className="text-sm text-muted-foreground">
          Any machine on your own network: this one, a Mac mini over the LAN, or a Tailscale
          address. Public internet hosts are refused. Ollama is the easy path; mlx_lm.server, LM
          Studio and llama.cpp work through the OpenAI-compatible option.
        </p>
      </div>
      <Field
        label="Provider"
        help="Ollama uses its native API. OpenAI-compatible covers mlx_lm.server, LM Studio, llama.cpp server, vLLM."
      >
        <Select
          value={draft.provider}
          onValueChange={(v) => set("provider", v as AiConfig["provider"])}
        >
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ollama">Ollama</SelectItem>
            <SelectItem value="openai">OpenAI-compatible server</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field
        label="Server URL"
        help="http://127.0.0.1:11434 for a server on this machine, or a private address such as http://10.0.10.66:8080."
      >
        <Input
          value={draft.url}
          onChange={(e) => set("url", e.target.value)}
          placeholder="http://127.0.0.1:11434"
          spellCheck={false}
        />
        <p
          className={cn(
            "mt-1 text-xs",
            models.reachable ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {models.loading
            ? "Checking server…"
            : models.reachable
              ? `Server answered with ${models.list.length} model${models.list.length === 1 ? "" : "s"}.`
              : `No answer from this server${models.error ? `: ${models.error}` : ""}.`}
        </p>
      </Field>
      <Field
        label="Model"
        help={
          models.reachable && models.list.length === 0
            ? "This server does not list its models; type the name it expects."
            : "What the server reports as installed. Pull or download a model on the server to see it here."
        }
      >
        {typing || (models.reachable && models.list.length === 0) ? (
          <div className="flex gap-2">
            <Input
              value={draft.model}
              onChange={(e) => set("model", e.target.value)}
              placeholder="model name"
              spellCheck={false}
              autoFocus
            />
            {models.list.length > 0 && (
              <Button type="button" variant="ghost" onClick={() => setTyping(false)}>
                Pick from list
              </Button>
            )}
          </div>
        ) : (
          <div className="flex gap-2">
            <Select
              value={draft.model && options.includes(draft.model) ? draft.model : ""}
              onValueChange={(v) => (v === OTHER ? setTyping(true) : set("model", v))}
              disabled={models.loading && models.list.length === 0}
            >
              <SelectTrigger className="min-w-72">
                <SelectValue placeholder={models.reachable ? "Choose a model" : "Server offline"} />
              </SelectTrigger>
              <SelectContent>
                {options.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                    {!models.list.includes(m) ? " (not installed)" : ""}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER}>Other, type a name</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Refresh model list"
              onClick={() => setDraft({ ...draft })}
              disabled={models.loading}
            >
              <RefreshCw className={cn("size-4", models.loading && "animate-spin")} />
            </Button>
          </div>
        )}
      </Field>
      <Field
        label="Confidence floor"
        help="Model answers below this are ignored. 0.6 is a sensible default for a 4B model; 0.7 for a 14B."
      >
        <Input
          type="number"
          step={0.05}
          min={0}
          max={1}
          value={draft.minConfidence}
          onChange={(e) => set("minConfidence", Number(e.target.value))}
          className="w-28"
        />
      </Field>
      <Field
        label="Batch size"
        help="Merchants per request. Smaller is safer on CPU-only machines; 12 to 20 is fine on a GPU or Apple Silicon."
      >
        <Input
          type="number"
          min={1}
          max={50}
          value={draft.batchSize}
          onChange={(e) => set("batchSize", Number(e.target.value))}
          className="w-28"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || !dirty || !draft.model}>
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={runTest}
          disabled={busy || test === "running" || dirty}
          title={dirty ? "Save first" : undefined}
        >
          <PlugZap className="size-4" /> {test === "running" ? "Testing" : "Test connection"}
        </Button>
        {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
      </div>
      {test && test !== "running" && <TestReport r={test} />}
    </form>
  );
}

function TestReport({ r }: { r: AiTestResult }) {
  const Row = ({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) => (
    <div className="flex items-start gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" />
      ) : (
        <XCircle className="mt-0.5 size-4 text-destructive" />
      )}
      <div>
        <span>{label}</span>
        {detail && <span className="text-muted-foreground"> {detail}</span>}
      </div>
    </div>
  );
  return (
    <div className="space-y-1.5 rounded-md border p-3">
      <Row
        ok={r.reachable}
        label={r.reachable ? `Server answered at ${r.url}` : `No server at ${r.url}`}
        detail={!r.reachable ? r.error : undefined}
      />
      {r.reachable && (
        <Row
          ok={r.modelAvailable}
          label={r.modelAvailable ? `Model ${r.model} is installed` : `Model ${r.model} not found`}
          detail={
            !r.modelAvailable && r.models.length ? `Installed: ${r.models.join(", ")}` : undefined
          }
        />
      )}
      {r.reachable && r.modelAvailable && (
        <Row
          ok={r.ok}
          label={
            r.ok
              ? `Classified a sample merchant in ${r.latencyMs} ms`
              : "The model did not return a usable answer"
          }
          detail={r.ok ? undefined : r.error}
        />
      )}
      {r.sample && (
        <div className="flex items-center gap-2 pl-6 text-sm text-muted-foreground">
          NETFLIX.COM <span aria-hidden>→</span> <CategoryBadge id={r.sample.categoryId} /> "
          {r.sample.label}", {Math.round(r.sample.confidence * 100)}% confident
        </div>
      )}
    </div>
  );
}
