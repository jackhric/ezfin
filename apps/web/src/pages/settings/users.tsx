import { MoreHorizontal } from "lucide-react";
import { useState, type FormEvent } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, type ManagedUser } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { relativeTime } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { Section } from "./layout";

type Role = "admin" | "member";

export function UsersSettings() {
  const { user: me } = useAuth();
  const users = useQuery(() => api.users());
  const [adding, setAdding] = useState(false);
  const [resetTarget, setResetTarget] = useState<ManagedUser>();
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser>();
  const [error, setError] = useState<string>();

  async function setRole(u: ManagedUser, role: Role) {
    setError(undefined);
    try {
      await api.updateUser(u.id, { role });
      users.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (users.error) return <ErrorBlock message={users.error} />;
  if (!users.data) return <LoadingBlock />;

  return (
    <Section
      title="Users"
      description="People who can sign in to this install. Each has their own bank link and data. Administrators can manage users and server settings."
    >
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {users.data.users.length} {users.data.users.length === 1 ? "person" : "people"}
        </p>
        <Button onClick={() => setAdding(true)}>Add user</Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Accounts</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.data.users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="font-medium">
                    {u.username}{" "}
                    {u.id === me?.id && (
                      <span className="text-xs text-muted-foreground">(you)</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell>
                  <Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{u.accounts}</TableCell>
                <TableCell className="text-muted-foreground">
                  {relativeTime(u.lastSeenAt)}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Actions for ${u.username}`}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {u.role === "admin" ? (
                        <DropdownMenuItem onClick={() => setRole(u, "member")}>
                          Make member
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => setRole(u, "admin")}>
                          Make administrator
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => setResetTarget(u)}>
                        Reset password
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={u.id === me?.id}
                        onClick={() => setDeleteTarget(u)}
                      >
                        Delete user
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AddUserDialog open={adding} onOpenChange={setAdding} onDone={users.refetch} />
      <ResetPasswordDialog
        user={resetTarget}
        onOpenChange={(o) => !o && setResetTarget(undefined)}
      />
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.username}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes their sign-in, bank credential, {deleteTarget?.accounts ?? 0} accounts
              and every transaction. It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleteTarget) return;
                try {
                  await api.deleteUser(deleteTarget.id);
                  users.refetch();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

function AddUserDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(undefined);
    try {
      await api.createUser({ username, email, password, role });
      setUsername("");
      setEmail("");
      setPassword("");
      setRole("member");
      onOpenChange(false);
      onDone();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>
              Give them the password out of band. They can change it under Security.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="au-username">Username</Label>
            <Input
              id="au-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="au-email">Email</Label>
            <Input
              id="au-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="au-password">Temporary password</Label>
            <Input
              id="au-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={10}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member: their own data only</SelectItem>
                <SelectItem value="admin">Administrator: can manage users and server</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {msg && <p className="text-sm text-destructive">{msg}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Add user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  user?: ManagedUser;
  onOpenChange: (o: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setMsg(undefined);
    try {
      await api.resetUserPassword(user.id, password);
      setPassword("");
      onOpenChange(false);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Reset password for {user?.username}</DialogTitle>
            <DialogDescription>
              They will be signed out everywhere and must use this new password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="rp-password">New password</Label>
            <Input
              id="rp-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={10}
              autoComplete="new-password"
            />
          </div>
          {msg && <p className="text-sm text-destructive">{msg}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Reset
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
