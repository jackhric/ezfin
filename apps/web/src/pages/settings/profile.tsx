import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Field, Section } from "./layout";

export function ProfileSettings() {
  const { user, refresh } = useAuth();
  const [username, setUsername] = useState(user?.username ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setUsername(user?.username ?? "");
    setEmail(user?.email ?? "");
  }, [user]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(undefined);
    try {
      await api.updateMe({ username, email });
      await refresh();
      setMsg("Saved.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Profile"
      description="How you appear on this install. Nothing here is shared anywhere."
    >
      <form onSubmit={save} className="space-y-6">
        <Field label="Username" help="Used to sign in.">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </Field>
        <Field label="Email" help="Stored locally for your own reference. ezfin never sends mail.">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </Field>
        <Field label="Role">
          <div className="text-sm capitalize">{user?.role}</div>
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            Save changes
          </Button>
          {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
        </div>
      </form>
    </Section>
  );
}
