import { CATEGORIES } from "@ezfin/core";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A native <select> dressed like our inputs. Used inside long tables where a
 * Radix dropdown per row (portal, listeners, 24 items each) is far too heavy:
 * 500 of those took seconds to mount; 500 of these are instant.
 */
export function CategorySelect({
  value,
  onChange,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (categoryId: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-full appearance-none rounded-md border border-transparent bg-transparent pr-6 pl-2 text-sm hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {CATEGORIES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
