import type { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";

/** Title block every settings section starts with. */
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-lg font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Separator />
      {children}
    </div>
  );
}

/** A labeled row inside a section: label and help on the left, control on the right. */
export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3 sm:gap-6">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {help && <div className="text-xs text-muted-foreground">{help}</div>}
      </div>
      <div className="sm:col-span-2">{children}</div>
    </div>
  );
}
