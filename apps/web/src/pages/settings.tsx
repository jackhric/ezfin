import { CATEGORY_BY_ID } from "@ezfin/core";
import { useState } from "react";
import { CategoryBadge } from "@/components/category-badge";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { useQuery } from "@/lib/use-query";

export function SettingsPage() {
  const status = useQuery(() => api.status());
  const cats = useQuery(() => api.categories());
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
    if (!confirm("Remove the stored access credential and delete all local account data?")) return;
    await api.disconnect();
    status.refetch();
    setMsg("Disconnected and wiped local data.");
  }

  if (status.error) return <ErrorBlock message={status.error} />;
  if (!status.data) return <LoadingBlock />;
  const p = status.data.provider;

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Data source{" "}
              <Badge variant={p.connected ? "default" : "outline"}>
                {p.connected ? "connected" : "not connected"}
              </Badge>
            </CardTitle>
            <CardDescription>
              {p.label}. {p.detail}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-2 text-muted-foreground">
              <span>Accounts</span>
              <span className="text-right text-foreground">{status.data.accounts}</span>
              <span>Transactions</span>
              <span className="text-right text-foreground">{status.data.transactions}</span>
              <span>Last sync</span>
              <span className="text-right text-foreground">
                {relativeTime(status.data.lastSyncAt)}
              </span>
            </div>

            {status.data.lastSyncWarnings.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                <p className="font-medium">Messages from your bridge</p>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {status.data.lastSyncWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {p.id === "mock" && (
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="font-medium">You are looking at demo data.</p>
                <p className="mt-1 text-muted-foreground">
                  To connect real accounts, stop the API and start it with{" "}
                  <code className="rounded bg-muted px-1">
                    EZFIN_PROVIDER=simplefin vp run dev:api
                  </code>
                  , then come back here.
                </p>
              </div>
            )}

            {p.id === "simplefin" && (
              <div className="space-y-2">
                <Label htmlFor="token">SimpleFIN setup token</Label>
                <Input
                  id="token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste the one-time token from bridge.simplefin.org"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  The token is exchanged once for a read-only access URL, which is written to a
                  private file in the local data folder. It is never shown again and never leaves
                  this machine except to the bridge.
                </p>
                <div className="flex gap-2">
                  <Button onClick={connect} disabled={busy || !token}>
                    {p.connected ? "Replace connection" : "Connect"}
                  </Button>
                  {p.connected && (
                    <Button variant="destructive" onClick={disconnect} disabled={busy}>
                      Disconnect and wipe
                    </Button>
                  )}
                </div>
              </div>
            )}
            {msg && <p>{msg}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Privacy model</CardTitle>
            <CardDescription>What this app does and does not do with your data.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
              <li>
                Bank data is pulled by the API process on this computer and stored in a SQLite file
                under <code>apps/api/data</code>.
              </li>
              <li>
                The API listens on 127.0.0.1 only and rejects requests whose Host header is not
                local.
              </li>
              <li>
                The web app has a Content Security Policy that forbids connecting to any origin
                except itself.
              </li>
              <li>
                Categorization and subscription detection are rule-based and run locally. No AI
                service sees your transactions.
              </li>
              <li>
                The only outbound connection is from the API to your aggregator (SimpleFIN) when you
                press Sync.
              </li>
              <li>
                The data folder and all database files are ignored by git, so they cannot be
                committed by accident.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Learned merchant rules</CardTitle>
            <CardDescription>
              Created when you choose "Always file here" on a transaction. Remove one to fall back
              to the built-in rules.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {cats.data && Object.keys(cats.data.overrides).length === 0 && (
              <p className="text-sm text-muted-foreground">No rules yet.</p>
            )}
            <div className="divide-y">
              {cats.data &&
                Object.entries(cats.data.overrides).map(([merchant, categoryId]) => (
                  <div key={merchant} className="flex items-center justify-between py-2 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="font-medium capitalize">{merchant}</span>
                      <CategoryBadge id={categoryId} />
                      <span className="sr-only">{CATEGORY_BY_ID.get(categoryId)?.name}</span>
                    </div>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={async () => {
                        await api.deleteRule(merchant);
                        cats.refetch();
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
