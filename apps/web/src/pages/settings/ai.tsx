import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { api, type AiStatus } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { Section } from "./_shared";

/** Settings section for the on-device categorization model. Polls while a job runs. */
export function AiSettings() {
  const [status, setStatus] = useState<AiStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setStatus(await api.aiStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const running = status?.job?.running ?? false;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => void refresh(), 1500);
    return () => clearInterval(id);
  }, [running]);

  async function run(scope: "uncategorized" | "all") {
    setBusy(true);
    setError(undefined);
    try {
      await api.aiCategorize(scope);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function forget() {
    if (
      !confirm(
        "Discard everything the model concluded and go back to the built-in rules? Your own category choices are kept.",
      )
    )
      return;
    await api.aiForget();
    await refresh();
    window.dispatchEvent(new Event("ezfin:synced"));
  }

  const job = status?.job;
  const ready = Boolean(status?.reachable && status?.modelAvailable);

  return (
    <Section
      title="Local AI"
      description="Server-wide. A small model on this machine that explains merchants and fills categorization gaps for everyone. Nothing is sent anywhere else."
    >
      {status && (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2 text-muted-foreground">
            <span>Status</span>
            <span className="text-right">
              <Badge variant={ready ? "default" : "outline"}>
                {status.reachable ? (status.modelAvailable ? "ready" : "model missing") : "offline"}
              </Badge>
            </span>
            <span>Server</span>
            <span className="truncate text-right text-foreground">
              {status.provider} at {status.url}
            </span>
            <span>Model</span>
            <span className="text-right text-foreground">{status.model}</span>
            <span>Merchants understood</span>
            <span className="text-right text-foreground">{status.insights}</span>
          </div>

          {!status.reachable && (
            <div className="rounded-md border bg-muted/40 p-3 text-muted-foreground">
              <p className="font-medium text-foreground">No model server found.</p>
              <p className="mt-1">
                Install Ollama from ollama.com, then run{" "}
                <code className="rounded bg-muted px-1">ollama pull {status.model}</code>. It only
                needs to be running on this computer. Reload this page afterwards.
              </p>
              {status.error && <p className="mt-1 text-xs">{status.error}</p>}
            </div>
          )}
          {status.reachable && !status.modelAvailable && (
            <div className="rounded-md border bg-muted/40 p-3 text-muted-foreground">
              Model <code>{status.model}</code> is not installed. Run{" "}
              <code className="rounded bg-muted px-1">ollama pull {status.model}</code>.
              {status.models && status.models.length > 0 && (
                <> Installed: {status.models.join(", ")}. Set EZFIN_AI_MODEL to use one of them.</>
              )}
            </div>
          )}

          {job?.running && (
            <div>
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>
                  Asking the model about{" "}
                  {job.scope === "all" ? "every merchant" : "unknown merchants"}
                </span>
                <span>
                  {job.done} / {job.total}
                </span>
              </div>
              <Progress value={job.total ? (job.done / job.total) * 100 : 0} />
            </div>
          )}
          {job && !job.running && job.finishedAt && (
            <p className="text-muted-foreground">
              Last run {relativeTime(job.finishedAt)}: understood {job.classified} merchants,
              recategorized {job.recategorized} transactions.
              {job.error && <span className="text-destructive"> Stopped: {job.error}</span>}
            </p>
          )}
          {error && <p className="text-destructive">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => run("uncategorized")} disabled={!ready || busy || running}>
              Categorize unknowns
            </Button>
            <Button
              variant="outline"
              onClick={() => run("all")}
              disabled={!ready || busy || running}
            >
              Re-examine everything
            </Button>
            {(status.insights ?? 0) > 0 && (
              <Button variant="ghost" onClick={forget} disabled={running}>
                Forget model results
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="ai-auto"
              checked={status.auto ?? false}
              onCheckedChange={async (v) => {
                await api.aiAuto(v);
                await refresh();
              }}
            />
            <Label htmlFor="ai-auto">Run on unknown merchants after every sync</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Resolution order: your own choices, then the model when it is at least{" "}
            {Math.round((status.minConfidence ?? 0.6) * 100)}% confident, then the built-in rules.
            "Categorize unknowns" only touches merchants the rules could not place; "Re-examine
            everything" lets the model overrule the rules for spending categories. Transfers, card
            payments and income always follow the rules so spending is never double counted.
          </p>
        </div>
      )}
    </Section>
  );
}
