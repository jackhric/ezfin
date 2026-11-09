import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { Field, Section } from "./_shared";

export function SecuritySettings() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sessionsMsg, setSessionsMsg] = useState<string>();

  async function change(e: FormEvent) {
    e.preventDefault();
    setMsg(undefined);
    if (next !== confirm) {
      setMsg("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword({ current, next });
      setCurrent("");
      setNext("");
      setConfirm("");
      setMsg("Password changed. Other devices were signed out.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Security" description="Your password and where you are signed in.">
      <form onSubmit={change} className="space-y-6">
        <Field label="Current password">
          <Input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <Field label="New password" help="At least 10 characters. A few words is best.">
          <Input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            required
            minLength={10}
          />
        </Field>
        <Field label="Confirm new password">
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            Change password
          </Button>
          {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
        </div>
      </form>

      <div className="space-y-6 border-t pt-6">
        <Field
          label="Sessions"
          help="Sign out of every other browser or device. This one stays signed in."
        >
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={async () => {
                await api.signOutElsewhere();
                setSessionsMsg("Done.");
              }}
            >
              Sign out elsewhere
            </Button>
            {sessionsMsg && <span className="text-sm text-muted-foreground">{sessionsMsg}</span>}
          </div>
        </Field>
        <Field
          label="Password reset"
          help="There is none, on purpose. An administrator can set a new password for you from Users."
        >
          <div />
        </Field>
      </div>
    </Section>
  );
}
