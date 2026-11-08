import { useState } from "react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { Field, Section } from "./layout";

export function DataSourceSettings() {
  const status = useQuery(() => api.status());
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();

  async function connect() {
    setBusy(true);
    setMsg(undefined);
    try {
      await api.connectSimplefin(token);
      setToken("");
      const r = await api.sync();
      setMsg(`Connected. Pulled ${r.accounts} accounts and ${r.transactions} transactions.`);
      status.refetch();
      window.dispatchEvent(new Event("ezfin:synced"));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await api.disconnect();
    status.refetch();
    setMsg("Disconnected and wiped your local data.");
    window.dispatchEvent(new Event("ezfin:synced"));
  }

  if (status.error) return <ErrorBlock message={status.error} />;
  if (!status.data) return <LoadingBlock />;
  const p = status.data.provider;

  return (
    <Section
      title="Data source"
      description="Where your accounts and transactions come from. Each person on this install has their own link."
    >
      <div className="space-y-6">
        <Field label="Provider">
          <div className="flex items-center gap-2 text-sm">
            {p.label}
            <Badge variant={p.connected ? "default" : "outline"}>
              {p.connected ? "connected" : "not connected"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{p.detail}</p>
        </Field>
        <Field label="Synced">
          <div className="text-sm">
            {status.data.accounts} accounts, {status.data.transactions} transactions, last sync{" "}
            {relativeTime(status.data.lastSyncAt)}.
          </div>
        </Field>

        {status.data.lastSyncWarnings.length > 0 && (
          <Field label="Messages from your bridge">
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {status.data.lastSyncWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Field>
        )}

        {p.id === "mock" && (
          <Field label="Demo mode" help="Synthetic data generated for your account at setup.">
            <p className="text-sm text-muted-foreground">
              To connect real accounts, restart with{" "}
              <code className="rounded bg-muted px-1">EZFIN_PROVIDER=simplefin vp run start</code>{" "}
              and come back here.
            </p>
          </Field>
        )}

        {p.id === "simplefin" && (
          <Field
            label="SimpleFIN setup token"
            help="One-time token from bridge.simplefin.org. Exchanged immediately for a read-only credential stored in a private local file; you never see it again."
          >
            <div className="flex gap-2">
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste setup token"
                autoComplete="off"
              />
              <Button onClick={connect} disabled={busy || !token}>
                {p.connected ? "Replace" : "Connect"}
              </Button>
            </div>
          </Field>
        )}
        {msg && <p className="text-sm text-muted-foreground">{msg}</p>}

        {(p.connected || status.data.accounts > 0) && (
          <div className="border-t pt-6">
            <Field
              label="Disconnect"
              help="Removes your bank link and deletes your accounts and transactions from this computer. Other people's data is untouched."
            >
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={busy}>
                    Disconnect and wipe my data
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Wipe your financial data?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This deletes your {status.data.accounts} accounts and{" "}
                      {status.data.transactions} transactions from this computer and removes the
                      bank credential. It cannot be undone, though you can connect again later.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep</AlertDialogCancel>
                    <AlertDialogAction onClick={disconnect}>Wipe</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </Field>
          </div>
        )}
      </div>
    </Section>
  );
}
