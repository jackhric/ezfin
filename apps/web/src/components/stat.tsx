import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "good" | "bad";
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </div>
        <div
          className={cn(
            "mt-1 font-heading text-2xl font-semibold tabular-nums",
            tone === "good" && "text-emerald-600 dark:text-emerald-400",
            tone === "bad" && "text-destructive",
          )}
        >
          {value}
        </div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
