import { CATEGORIES, CATEGORY_BY_ID, type CategoryTotal, type MonthSummary } from "@ezfin/core";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Cell, Pie, PieChart } from "recharts";
import { CategoryBadge } from "@/components/category-badge";
import { ErrorBlock, LoadingBlock, PageHeader, useSyncRefresh } from "@/components/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
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
import { api } from "@/lib/api";
import { categoryColor, moneyExact, monthLabel } from "@/lib/format";
import { useQuery } from "@/lib/use-query";

const RANGE_OPTIONS = [
  { value: "this", label: "This month" },
  { value: "last", label: "Last month" },
  { value: "3", label: "Last 3 months (avg)" },
  { value: "6", label: "Last 6 months (avg)" },
  { value: "12", label: "Last 12 months (avg)" },
];

export function CategoriesPage() {
  const summary = useQuery(() => api.summary(13));
  useSyncRefresh(summary.refetch);
  const [range, setRange] = useState("this");

  const view = useMemo(() => {
    if (!summary.data) return undefined;
    const months = summary.data.months;
    let selected: MonthSummary[];
    if (range === "this") selected = [summary.data.current];
    else if (range === "last") selected = months.slice(-2, -1);
    else selected = months.slice(-(Number(range) + 1), -1);
    if (selected.length === 0) selected = [summary.data.current];
    const n = selected.length;
    const acc = new Map<string, CategoryTotal>();
    for (const m of selected) {
      for (const c of m.byCategory) {
        const cur = acc.get(c.categoryId) ?? { categoryId: c.categoryId, total: 0, count: 0 };
        cur.total += c.total;
        cur.count += c.count;
        acc.set(c.categoryId, cur);
      }
    }
    const rows = [...acc.values()]
      .map((c) => ({
        ...c,
        total: Math.round((c.total / n) * 100) / 100,
        count: Math.round(c.count / n),
      }))
      .sort((a, b) => b.total - a.total);
    const total = rows.reduce((s, r) => s + r.total, 0);
    const label =
      n === 1
        ? monthLabel(selected[0]!.month)
        : `${monthLabel(selected[0]!.month)} to ${monthLabel(selected[n - 1]!.month)}, monthly average`;
    return { rows, total, label };
  }, [summary.data, range]);

  if (summary.error) return <ErrorBlock message={summary.error} />;
  if (!view) return <LoadingBlock rows={8} />;

  const chartData = view.rows.slice(0, 9);
  const rest = view.rows.slice(9).reduce((s, r) => s + r.total, 0);
  if (rest > 0) chartData.push({ categoryId: "other", total: rest, count: 0 });
  const groupIndex = new Map<string, number>();
  const colorFor = (id: string) => {
    const group = CATEGORY_BY_ID.get(id)?.group ?? "uncategorized";
    const i = groupIndex.get(group) ?? 0;
    groupIndex.set(group, i + 1);
    return categoryColor(group, i);
  };
  const config: ChartConfig = Object.fromEntries(
    chartData.map((d) => [
      d.categoryId,
      { label: CATEGORY_BY_ID.get(d.categoryId)?.name ?? "Other", color: colorFor(d.categoryId) },
    ]),
  );
  const byGroup = CATEGORIES.reduce<Record<string, number>>((acc, c) => {
    const row = view.rows.find((r) => r.categoryId === c.id);
    if (row) acc[c.group] = (acc[c.group] ?? 0) + row.total;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Categories"
        description="Where the money goes. Change a category on any transaction and ezfin learns the merchant."
        actions={
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{moneyExact(view.total)}</CardTitle>
            <CardDescription>{view.label}</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={config} className="mx-auto aspect-square max-h-64">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent nameKey="categoryId" hideLabel />} />
                <Pie
                  data={chartData}
                  dataKey="total"
                  nameKey="categoryId"
                  innerRadius={55}
                  strokeWidth={2}
                  paddingAngle={1}
                >
                  {chartData.map((d) => (
                    <Cell key={d.categoryId} fill={`var(--color-${d.categoryId})`} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <div className="mt-2 space-y-1 text-sm">
              {Object.entries(byGroup)
                .sort(([, a], [, b]) => b - a)
                .map(([g, t]) => (
                  <div key={g} className="flex justify-between">
                    <span className="capitalize text-muted-foreground">{g}</span>
                    <span className="tabular-nums">
                      {moneyExact(t)}{" "}
                      <span className="text-xs text-muted-foreground">
                        ({Math.round((t / view.total) * 100)}%)
                      </span>
                    </span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>By category</CardTitle>
            <CardDescription>Click a category to see its transactions.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="w-24 text-right">Txns</TableHead>
                  <TableHead className="w-24 text-right">Share</TableHead>
                  <TableHead className="w-32 text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.rows.map((r) => (
                  <TableRow key={r.categoryId}>
                    <TableCell>
                      <Link
                        to={`/transactions?categoryId=${r.categoryId}${range === "this" ? `&month=${summary.data!.current.month}` : ""}`}
                        className="hover:underline"
                      >
                        <CategoryBadge id={r.categoryId} />
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.count}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {Math.round((r.total / view.total) * 100)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{moneyExact(r.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
