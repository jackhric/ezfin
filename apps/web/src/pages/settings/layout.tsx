import type { LucideIcon } from "lucide-react";
import { Brain, Database, KeyRound, Server, ShieldCheck, UserRound, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, NavLink, Outlet } from "react-router-dom";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface Item {
  to: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Settings follow the usual two-group convention: things about *you* and things
 * about *this server*. The second group is only rendered for administrators.
 */
const ACCOUNT: Item[] = [
  { to: "/settings/profile", label: "Profile", icon: UserRound },
  { to: "/settings/security", label: "Security", icon: KeyRound },
  { to: "/settings/data-source", label: "Data source", icon: Database },
  { to: "/settings/privacy", label: "Privacy", icon: ShieldCheck },
];
const ADMIN: Item[] = [
  { to: "/settings/users", label: "Users", icon: Users },
  { to: "/settings/ai", label: "Local AI", icon: Brain },
  { to: "/settings/server", label: "Server", icon: Server },
];

export function SettingsLayout() {
  const { user } = useAuth();
  const groups = [
    { title: "Account", items: ACCOUNT },
    ...(user?.role === "admin" ? [{ title: "Administration", items: ADMIN }] : []),
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account, and {user?.role === "admin" ? "this server" : "your data"}.
        </p>
      </div>
      <Separator />
      <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
        <aside className="lg:w-56 lg:shrink-0">
          <nav className="flex gap-4 overflow-x-auto lg:flex-col lg:gap-5">
            {groups.map((g) => (
              <div key={g.title} className="flex shrink-0 gap-1 lg:flex-col">
                <div className="hidden px-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase lg:block">
                  {g.title}
                </div>
                {g.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm whitespace-nowrap hover:bg-muted",
                        isActive ? "bg-muted font-medium" : "text-muted-foreground",
                      )
                    }
                  >
                    <Icon className="size-4" />
                    {label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 flex-1 lg:max-w-3xl">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

/** Wrap administration sections so a member who types the URL is sent back to their profile. */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== "admin") return <Navigate to="/settings/profile" replace />;
  return <>{children}</>;
}
