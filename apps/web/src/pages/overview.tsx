import { CATEGORY_BY_ID } from "@ezfin/core";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { CategoryBadge } from "@/components/category-badge";
import { ErrorBlock, LoadingBlock, PageHeader, useSyncRefresh } from "@/components/page";
import { Stat } from "@/components/stat";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import { money, moneyExact, monthLabel, signed } from "@/lib/format";
import { useQuery } from "@/lib/use-query";

const chartConfig = {
  income: { label: "Income", color: "var(--chart-2)" },
  spending: { label: "Spending", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function OverviewPage() {
  const summary = useQuery(() => api.summary(12));
  const recurring = useQuery(() => api.recurring());
  const accounts = useQuery(() => api.accounts());
  useSyncRefresh(() => {
    summary.refetch();
    recurring.refetch();
    accounts.refetch();
  });

  if (summary.error) return <ErrorBlock message={summary.error} />;
  if (!summary.data) return <LoadingBlock rows={6} />;

  const s = summary.data;
  const prev = s.months.length >= 2 ? s.months[s.months.length - 2] : undefined;
  const monthsToShow = s.months.slice(-12);
  const topCats = s.current.byCategory.slice(0, 6);
  const maxCat = topCats[0]?.total ?? 1;

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Where things stand for ${monthLabel(s.current.month)}.`}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Net worth"
          value={money(s.netWorth.net)}
          hint={`${money(s.netWorth.assets)} assets, ${money(s.netWorth.debts)} debt`}
        />
        <Stat
          label="Spent this month"
          value={money(s.current.spending)}
          hint={
            prev
              ? `${signed(s.current.spending - prev.spending)} vs ${monthLabel(prev.month)}`
              : undefined
          }
        />
        <Stat
          label="Income this month"
          value={money(s.current.income)}
          hint={
            <span
              className={
                s.current.net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
              }
            >
              Net {signed(s.current.net)}
            </span>
          }
        />
        <Stat
          label="Recurring / month"
          value={recurring.data ? money(recurring.data.monthlyTotal) : "…"}
          hint={
            recurring.data
              ? `${recurring.data.activeCount} active subscriptions and bills`
              : undefined
          }
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Income vs spending</CardTitle>
            <CardDescription>Monthly totals, transfers and card payments excluded.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-64 w-full">
              <BarChart data={monthsToShow} margin={{ left: 4, right: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={monthLabel}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tickFormatter={(v: number) => money(v)}
                />
                <ChartTooltip
                  content={<ChartTooltipContent labelFormatter={(l) => monthLabel(String(l))} />}
                />
                <Bar dataKey="income" fill="var(--color-income)" radius={4} />
                <Bar dataKey="spending" fill="var(--color-spending)" radius={4} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top categories</CardTitle>
            <CardDescription>
              This month.{" "}
              <Link to="/categories" className="underline underline-offset-4">
                See all
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {topCats.length === 0 && (
              <p className="text-sm text-muted-foreground">No spending yet this month.</p>
            )}
            {topCats.map((c) => (
              <div key={c.categoryId}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <CategoryBadge id={c.categoryId} />
                  <span className="tabular-nums">{moneyExact(c.total)}</span>
                </div>
                <Progress value={(c.total / maxCat) * 100} className="h-1.5" />
              </div>
            ))}
            {s.uncategorized > 0 && (
              <p className="pt-1 text-xs text-muted-foreground">
                {s.uncategorized} uncategorized transactions.{" "}
                <Link
                  to="/transactions?categoryId=uncategorized"
                  className="underline underline-offset-4"
                >
                  Review
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {accounts.data?.accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.institution} · {a.type}
                  </div>
                </div>
                <div className={`tabular-nums ${a.balance < 0 ? "text-destructive" : ""}`}>
                  {moneyExact(a.balance)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Biggest recurring charges</CardTitle>
            <CardDescription>
              Detected from your history.{" "}
              <Link to="/recurring" className="underline underline-offset-4">
                Full list
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {recurring.data?.series
              .filter((r) => !r.possiblyCancelled)
              .slice(0, 6)
              .map((r) => (
                <div key={r.id} className="flex items-center justify-between py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium capitalize">{r.merchant}</span>
                    <span className="text-xs text-muted-foreground">
                      {CATEGORY_BY_ID.get(r.categoryId)?.name} · {r.cadence}
                    </span>
                  </div>
                  <div className="tabular-nums">
                    {moneyExact(r.monthlyEquivalent)}
                    <span className="text-xs text-muted-foreground">/mo</span>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
