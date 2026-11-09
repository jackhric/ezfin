import { CheckCircle2, PlugZap, XCircle } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
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
import { Field } from "./_shared";

/**
 * Admin form for the local model server. Every change goes through the API's
 * loopback guard, so a non-local URL is refused with a clear message.
 */
export function AiConfigForm({ installed, onSaved }: { installed: string[]; onSaved: () => void }) {
  const [cfg, setCfg] = useState<AiConfig>();
  const [draft, setDraft] = useState<AiConfig>();
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<AiTestResult | "running">();

  useEffect(() => {
    api.aiConfig().then(
      ({ config }) => {
        setCfg(config);
        setDraft(config);
      },
      (e: unknown) => setMsg(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  if (!cfg || !draft) return null;
  const dirty = JSON.stringify(cfg) !== JSON.stringify(draft);
  const set = <K extends keyof AiConfig>(k: K, v: AiConfig[K]) => setDraft({ ...draft, [k]: v });

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
          Must be on this machine. Ollama on an Apple Silicon Mac is the easy path; LM Studio and
          llama.cpp work through the OpenAI-compatible option.
        </p>
      </div>
      <Field
        label="Provider"
        help="Ollama uses its native API. OpenAI-compatible covers LM Studio, llama.cpp server, vLLM."
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
      </Field>
      <Field
        label="Model"
        help={
          installed.length
            ? `Installed: ${installed.join(", ")}`
            : "The name as the server knows it, for example qwen3:4b."
        }
      >
        <Input
          value={draft.model}
          onChange={(e) => set("model", e.target.value)}
          list="ai-models"
          spellCheck={false}
        />
        <datalist id="ai-models">
          {installed.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>
      <Field
        label="Confidence floor"
        help="Model answers below this are ignored. 0.6 is a sensible default for a 4B model."
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
        <Button type="submit" disabled={busy || !dirty}>
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
