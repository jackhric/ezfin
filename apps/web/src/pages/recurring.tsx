import { CATEGORY_BY_ID, type RecurringSeries } from "@ezfin/core";
import { Link } from "react-router-dom";
import { CategoryBadge } from "@/components/category-badge";
import { ErrorBlock, LoadingBlock, PageHeader, useSyncRefresh } from "@/components/page";
import { Stat } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { dateLabel, money, moneyExact } from "@/lib/format";
import { useQuery } from "@/lib/use-query";

const SUBSCRIPTION_CATEGORIES = new Set(["subscriptions", "fitness", "entertainment"]);

export function RecurringPage() {
  const rec = useQuery(() => api.recurring());
  useSyncRefresh(rec.refetch);

  if (rec.error) return <ErrorBlock message={rec.error} />;
  if (!rec.data) return <LoadingBlock rows={8} />;

  const active = rec.data.series.filter((s) => !s.possiblyCancelled);
  const cancelled = rec.data.series.filter((s) => s.possiblyCancelled);
  const subs = active.filter((s) => SUBSCRIPTION_CATEGORIES.has(s.categoryId));
  const bills = active.filter((s) => !SUBSCRIPTION_CATEGORIES.has(s.categoryId));
  const sum = (xs: RecurringSeries[]) => xs.reduce((t, s) => t + s.monthlyEquivalent, 0);
  const upcoming = [...active]
    .sort((a, b) => a.nextExpected.localeCompare(b.nextExpected))
    .slice(0, 5);

  return (
    <>
      <PageHeader
        title="Recurring"
        description="Subscriptions and bills detected from the rhythm of your transactions. No merchant list required."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="All recurring"
          value={money(rec.data.monthlyTotal)}
          hint={`${active.length} series, per month`}
        />
        <Stat
          label="Subscriptions"
          value={money(sum(subs))}
          hint={`${subs.length} streaming, software, memberships`}
        />
        <Stat
          label="Bills"
          value={money(sum(bills))}
          hint={`${bills.length} rent, utilities, insurance, loans`}
        />
        <Stat
          label="Per year"
          value={money(rec.data.monthlyTotal * 12)}
          hint="If nothing changes"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Active</CardTitle>
            <CardDescription>
              Sorted by monthly cost. Variable means the amount changes month to month, like a
              utility.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SeriesTable rows={active} />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Coming up</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {upcoming.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium capitalize">{s.merchant}</div>
                    <div className="text-xs text-muted-foreground">
                      expected {dateLabel(s.nextExpected)}
                    </div>
                  </div>
                  <span className="tabular-nums">{moneyExact(s.typicalAmount)}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {cancelled.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Possibly cancelled</CardTitle>
                <CardDescription>Recurring before, but overdue now.</CardDescription>
              </CardHeader>
              <CardContent className="divide-y">
                {cancelled.map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <div className="font-medium capitalize">{s.merchant}</div>
                      <div className="text-xs text-muted-foreground">
                        last seen {dateLabel(s.lastSeen)}
                      </div>
                    </div>
                    <span className="tabular-nums text-muted-foreground line-through">
                      {moneyExact(s.typicalAmount)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function SeriesTable({ rows }: { rows: RecurringSeries[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Merchant</TableHead>
          <TableHead>Cadence</TableHead>
          <TableHead className="w-28 text-right">Charge</TableHead>
          <TableHead className="w-28 text-right">Per month</TableHead>
          <TableHead className="w-24 text-right">Confidence</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s) => (
          <TableRow key={s.id}>
            <TableCell>
              <Link
                to={`/transactions?q=${encodeURIComponent(s.merchant)}`}
                className="font-medium capitalize hover:underline"
              >
                {s.merchant}
              </Link>
              <div className="mt-0.5 flex items-center gap-1.5">
                <CategoryBadge id={s.categoryId} />
                {s.variableAmount && <Badge variant="secondary">variable</Badge>}
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {s.cadence}
              <div className="text-xs">
                {s.occurrences}× since {dateLabel(s.firstSeen)}
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{moneyExact(s.typicalAmount)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {moneyExact(s.monthlyEquivalent)}
            </TableCell>
            <TableCell className="text-right">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="tabular-nums">{Math.round(s.confidence * 100)}%</span>
                </TooltipTrigger>
                <TooltipContent>
                  Interval regularity, amount stability and sample size. Category:{" "}
                  {CATEGORY_BY_ID.get(s.categoryId)?.name}
                </TooltipContent>
              </Tooltip>
            </TableCell>
          </TableRow>
        ))}
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
              Nothing recurring detected yet. Sync at least two or three months of history.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
