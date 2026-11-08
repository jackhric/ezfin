import {
  CreditCard,
  LayoutDashboard,
  List,
  LogOut,
  PieChart,
  RefreshCw,
  Repeat,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { relativeTime } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/transactions", label: "Transactions", icon: List },
  { to: "/categories", label: "Categories", icon: PieChart },
  { to: "/recurring", label: "Recurring", icon: Repeat },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Layout() {
  const { user, logout } = useAuth();
  const status = useQuery(() => api.status());
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string>();

  async function sync() {
    setSyncing(true);
    setSyncError(undefined);
    try {
      await api.sync();
      status.refetch();
      // Pages subscribe to this event to refresh their own data.
      window.dispatchEvent(new Event("ezfin:synced"));
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-3 md:flex">
        <div className="flex items-center gap-2 px-2 py-3">
          <CreditCard className="size-5" />
          <span className="font-heading text-lg font-semibold tracking-tight">ezfin</span>
        </div>
        <nav className="mt-2 flex flex-col gap-0.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  isActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-2 px-2 pb-2 text-xs text-muted-foreground">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="size-3.5" />
                <span>Local only</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-56">
              Data lives in a SQLite file on this computer. The API listens on 127.0.0.1 and the UI
              never calls anything else.
            </TooltipContent>
          </Tooltip>
          {status.data && (
            <div>
              <Badge variant="outline" className="mb-1">
                {status.data.provider.label}
              </Badge>
              <div>Synced {relativeTime(status.data.lastSyncAt)}</div>
            </div>
          )}
          {user && (
            <div className="flex items-center justify-between gap-2 border-t pt-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">{user.username}</div>
                <div className="truncate">{user.email}</div>
              </div>
              <Button size="icon-xs" variant="ghost" onClick={logout} title="Sign out">
                <LogOut className="size-3.5" />
              </Button>
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b px-4 py-2 md:px-6">
          <nav className="flex gap-1 overflow-x-auto md:hidden">
            {NAV.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-2 py-1 text-sm whitespace-nowrap",
                    isActive ? "bg-muted font-medium" : "text-muted-foreground",
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {syncError && <span className="text-xs text-destructive">{syncError}</span>}
            <Button size="sm" variant="outline" onClick={sync} disabled={syncing}>
              <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
              {syncing ? "Syncing" : "Sync"}
            </Button>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
