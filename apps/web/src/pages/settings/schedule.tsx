import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, type ScheduleStatus } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { Field } from "./layout";

const timeLabel = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "never";

/** Admin controls for the twice-daily sync and the per-link request budget. */
export function ScheduleSettings() {
  const [status, setStatus] = useState<ScheduleStatus>();
  const [times, setTimes] = useState("");
  const [limit, setLimit] = useState("");
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const s = await api.schedule();
    setStatus(s);
    setTimes(s.config.times.join(", "));
    setLimit(String(s.requestLimit));
  };
  useEffect(() => {
    void load().catch((e: unknown) => setMsg(e instanceof Error ? e.message : String(e)));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(undefined);
    try {
      const s = await api.updateSchedule({
        times: times
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        requestLimit: Number(limit),
      });
      setStatus(s);
      setMsg("Saved.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(enabled: boolean) {
    setStatus(await api.updateSchedule({ enabled }));
  }

  async function runNow() {
    setBusy(true);
    setMsg(undefined);
    try {
      const { run } = await api.runScheduleNow();
      setMsg(
        `Synced ${run.links} links for ${run.users} people, ${run.transactions} transactions pulled${run.errors.length ? `, ${run.errors.length} failed` : ""}.`,
      );
      await load();
      window.dispatchEvent(new Event("ezfin:synced"));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;
  const last = status.lastRun;

  return (
    <form onSubmit={save} className="space-y-6 border-t pt-6">
      <div>
        <h3 className="font-medium">Scheduled sync</h3>
        <p className="text-sm text-muted-foreground">
          Pulls every person's links at fixed times. SimpleFIN refreshes from banks about once a
          day, so twice daily is plenty.
        </p>
      </div>
      <Field label="Enabled">
        <div className="flex items-center gap-2">
          <Switch checked={status.config.enabled} onCheckedChange={toggle} />
          <span className="text-sm text-muted-foreground">
            {status.config.enabled
              ? `Next run ${timeLabel(status.nextRunAt)}`
              : "Off. Links only sync when someone presses Sync."}
          </span>
        </div>
      </Field>
      <Field
        label="Times"
        help={`Local time of the server (${status.timezone}). Comma separated, up to six. SimpleFIN is busiest on the hour, so a few minutes past is slightly faster.`}
      >
        <Input
          value={times}
          onChange={(e) => setTimes(e.target.value)}
          placeholder="05:00, 17:00"
        />
      </Field>
      <Field
        label="Request limit"
        help={`Max bridge requests per link in a rolling 24 hours. SimpleFIN allows about ${status.providerCeiling}; stay under it. A first import uses about 5, each later sync 1.`}
      >
        <Input
          type="number"
          min={1}
          max={status.providerCeiling}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className="w-28"
        />
      </Field>
      <Field label="Last run">
        <div className="text-sm">
          {last ? (
            <>
              {relativeTime(last.finishedAt)} ({last.slot}): {last.links} links, {last.users}{" "}
              people, {last.transactions} transactions.
              {last.errors.length > 0 && (
                <span className="text-destructive">
                  {" "}
                  {last.errors.length} failed: {last.errors.map((e) => e.error).join("; ")}
                </span>
              )}
            </>
          ) : (
            "Never"
          )}
        </div>
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy}>
          Save
        </Button>
        <Button type="button" variant="outline" onClick={runNow} disabled={busy || status.running}>
          {status.running ? "Running" : "Run now"}
        </Button>
        {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
      </div>
    </form>
  );
}
