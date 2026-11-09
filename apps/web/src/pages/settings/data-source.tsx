import { Database, Landmark, PlugZap, RefreshCw } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ErrorBlock, LoadingBlock } from "@/components/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type Link } from "@/lib/api";
import { moneyExact, relativeTime } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { Section } from "./_shared";

const notifySynced = () => window.dispatchEvent(new Event("ezfin:synced"));

/**
 * Each person links their own data sources. A SimpleFIN link imports every
 * account the bridge exposes; demo data is a link like any other.
 */
export function DataSourceSettings() {
  const links = useQuery(() => api.links());
  const [params, setParams] = useSearchParams();
  const [linking, setLinking] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState<Link>();
  const [busyId, setBusyId] = useState<string>();
  const [msg, setMsg] = useState<string>();

  // Deep link from the empty-state "Load demo data" button.
  useEffect(() => {
    if (params.get("demo") === "1") {
      setParams({}, { replace: true });
      void loadDemo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadDemo() {
    setBusyId("demo");
    setMsg(undefined);
    try {
      const { result } = await api.linkDemo();
      setMsg(`Loaded demo data: ${result.accounts} accounts, ${result.transactions} transactions.`);
      links.refetch();
      notifySynced();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(undefined);
    }
  }

  async function sync(link: Link) {
    setBusyId(link.id);
    setMsg(undefined);
    try {
      const { result } = await api.syncLink(link.id);
      setMsg(
        `${link.label}: ${result.accounts} accounts, ${result.transactions} transactions pulled.`,
      );
      links.refetch();
      notifySynced();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(undefined);
    }
  }

  async function testLink(link: Link) {
    setBusyId(link.id);
    setMsg(undefined);
    try {
      const r = await api.testLink(link.id);
      if (!r.ok) setMsg(`${link.label}: ${r.error ?? "test failed"}`);
      else if (r.provider === "demo") setMsg(`${link.label}: demo data, nothing to reach.`);
      else {
        const list = Array.isArray(r.accounts) ? r.accounts : [];
        const warn = r.warnings?.length ? ` Bridge says: ${r.warnings.join("; ")}` : "";
        setMsg(
          `${link.label}: bridge answered in ${r.latencyMs} ms with ${list.length} accounts (${[...new Set(list.map((a) => a.institution))].join(", ")}).${warn}`,
        );
      }
      links.refetch();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(undefined);
    }
  }

  async function unlink(link: Link) {
    await api.unlink(link.id);
    setMsg(`Removed ${link.label} and everything imported through it.`);
    links.refetch();
    notifySynced();
  }

  if (links.error) return <ErrorBlock message={links.error} />;
  if (!links.data) return <LoadingBlock />;
  const hasDemo = links.data.links.some((l) => l.provider === "demo");

  return (
    <Section
      title="Data source"
      description="Where your accounts and transactions come from. Links belong to you; other people on this install have their own."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setLinking(true)}>
          <Landmark className="size-4" /> Link SimpleFIN
        </Button>
        {!hasDemo && (
          <Button variant="outline" onClick={loadDemo} disabled={busyId === "demo"}>
            <Database className="size-4" /> Load demo data
          </Button>
        )}
        {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
      </div>

      {links.data.links.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing linked yet. SimpleFIN is a read-only bridge to your bank: you authorize your
          institutions there once, paste the setup token here, and every account it exposes is
          imported.
        </p>
      )}

      <div className="space-y-4">
        {links.data.links.map((link) => (
          <div key={link.id} className="rounded-lg border">
            <div className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{link.label}</span>
                  <Badge variant={link.provider === "simplefin" ? "default" : "secondary"}>
                    {link.provider === "simplefin" ? "SimpleFIN" : "demo"}
                  </Badge>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {link.detail}. Linked {relativeTime(link.createdAt)}, last sync{" "}
                  {relativeTime(link.lastSyncedAt)}.
                  {link.provider === "simplefin" && (
                    <>
                      {" "}
                      {link.requests.used} of {link.requests.limit} bridge requests used in the last{" "}
                      {link.requests.windowHours} h.
                    </>
                  )}
                </div>
                {link.warnings.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-xs text-amber-700 dark:text-amber-400">
                    {link.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => sync(link)}
                  disabled={busyId === link.id}
                >
                  <RefreshCw className={cn("size-3.5", busyId === link.id && "animate-spin")} />{" "}
                  Sync
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => testLink(link)}
                  disabled={busyId === link.id}
                  title="One balances-only request; imports nothing"
                >
                  <PlugZap className="size-3.5" /> Test
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setUnlinkTarget(link)}>
                  Unlink
                </Button>
              </div>
            </div>
            <div className="divide-y border-t">
              {link.accounts.length === 0 && (
                <div className="px-4 py-3 text-sm text-muted-foreground">
                  No accounts imported yet. Try Sync.
                </div>
              )}
              {link.accounts.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <div>
                    <div>{a.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.institution} · {a.type}
                    </div>
                  </div>
                  <div className={cn("tabular-nums", a.balance < 0 && "text-destructive")}>
                    {moneyExact(a.balance)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <LinkSimplefinDialog
        open={linking}
        onOpenChange={setLinking}
        onDone={(text) => {
          setMsg(text);
          links.refetch();
          notifySynced();
        }}
      />

      <AlertDialog
        open={Boolean(unlinkTarget)}
        onOpenChange={(o) => !o && setUnlinkTarget(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink {unlinkTarget?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the stored credential and deletes the{" "}
              {unlinkTarget?.accounts.length ?? 0} accounts and all transactions imported through it
              from this computer. You can link again later, which re-imports from scratch.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={() => unlinkTarget && unlink(unlinkTarget)}>
              Unlink
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

function LinkSimplefinDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: (msg: string) => void;
}) {
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const { link, result } = await api.linkSimplefin(token.trim(), label.trim() || undefined);
      setToken("");
      setLabel("");
      onOpenChange(false);
      onDone(
        result
          ? `Linked ${link.label}: imported ${result.accounts} accounts and ${result.transactions} transactions.`
          : `Linked ${link.label}, but the first import failed. Use Sync to retry.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Link SimpleFIN</DialogTitle>
            <DialogDescription>
              At bridge.simplefin.org, connect your institutions and generate a setup token. Paste
              it below. It is exchanged once for a read-only credential that is stored in a private
              local file; every account the bridge exposes is imported.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="sf-token">Setup token</Label>
            <Input
              id="sf-token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sf-label">Label (optional)</Label>
            <Input
              id="sf-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Personal banks"
              autoComplete="off"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !token.trim()}>
              {busy ? "Importing" : "Link and import"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
