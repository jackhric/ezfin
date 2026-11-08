import { useEffect, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <div className="font-medium text-destructive">Could not reach the local API</div>
      <div className="mt-1 text-muted-foreground">
        {message}. Is the API running? Start it with{" "}
        <code className="rounded bg-muted px-1">vp run dev:api</code>.
      </div>
    </div>
  );
}

export function useSyncRefresh(refetch: () => void) {
  // Re-fetch page data after the header's global Sync button finishes.
  useEffect(() => {
    window.addEventListener("ezfin:synced", refetch);
    return () => window.removeEventListener("ezfin:synced", refetch);
  }, [refetch]);
}
