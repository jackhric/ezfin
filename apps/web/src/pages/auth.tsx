import { CreditCard, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** First run: create the one account that owns this install. Afterwards: sign in. */
export function AuthPage() {
  const { setupRequired, refresh, error: statusError } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (setupRequired && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (setupRequired) await api.setup({ username, email, password });
      else await api.login({ username, password });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2 font-heading text-lg font-semibold">
            <CreditCard className="size-5" /> ezfin
          </div>
          <CardTitle>{setupRequired ? "Create your account" : "Sign in"}</CardTitle>
          <CardDescription>
            {setupRequired
              ? "This is a one-time setup. The account lives only on this computer and owns every bank account you connect."
              : "Welcome back."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </div>
            {setupRequired && (
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Kept locally. Nothing is ever sent to it.
                </p>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={setupRequired ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={setupRequired ? 10 : undefined}
              />
              {setupRequired && (
                <p className="text-xs text-muted-foreground">
                  At least 10 characters. A few words is best.
                </p>
              )}
            </div>
            {setupRequired && (
              <div className="space-y-1">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
            )}
            {(error ?? statusError) && (
              <p className="text-sm text-destructive">{error ?? statusError}</p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "One moment" : setupRequired ? "Create account" : "Sign in"}
            </Button>
          </form>
          <p className="mt-4 flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            Passwords are hashed with scrypt and stored in the local database. There is no password
            reset: if you forget it, delete the data folder and start over.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
