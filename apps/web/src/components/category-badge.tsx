import { CATEGORY_BY_ID, type CategoryGroup } from "@ezfin/core";
import { Badge } from "@/components/ui/badge";
import { groupColor } from "@/lib/format";

export function CategoryBadge({ id }: { id: string }) {
  const cat = CATEGORY_BY_ID.get(id);
  const group: CategoryGroup = cat?.group ?? "uncategorized";
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className="size-2 rounded-full" style={{ background: groupColor[group] }} />
      {cat?.name ?? id}
    </Badge>
  );
}
