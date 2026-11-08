import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

/** Let a signed-in user add another person to this install. Each person's bank links and data are separate. */
export function AddUserCard() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(undefined);
    try {
      const { user } = await api.addUser({ username, email, password });
      setMsg(`Added ${user.username}. They can sign in now.`);
      setUsername("");
      setEmail("");
      setPassword("");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>People on this install</CardTitle>
        <CardDescription>
          Add someone else who uses this computer. Their bank links, accounts and transactions stay
          separate from yours.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="nu">Username</Label>
            <Input
              id="nu"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ne">Email</Label>
            <Input
              id="ne"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="np">Password</Label>
            <Input
              id="np"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={10}
              autoComplete="new-password"
            />
          </div>
          <div className="flex items-center gap-3 sm:col-span-3">
            <Button type="submit" disabled={busy}>
              Add person
            </Button>
            {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
