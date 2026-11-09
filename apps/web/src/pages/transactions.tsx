import { CATEGORIES, type Transaction } from "@ezfin/core";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CategoryBadge } from "@/components/category-badge";
import { CategorySelect } from "@/components/category-select";
import { ErrorBlock, LoadingBlock, PageHeader, useSyncRefresh } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { dateLabel, signed } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import { useQuery } from "@/lib/use-query";

const ALL = "__all__";
const PAGE = 100;

export function TransactionsPage() {
  const [params, setParams] = useSearchParams();
  const categoryId = params.get("categoryId") ?? ALL;
  const accountId = params.get("accountId") ?? ALL;
  const month = params.get("month") ?? ALL;
  const [q, setQ] = useState(params.get("q") ?? "");
  const query = useDebounced(q.trim(), 250);
  const [extra, setExtra] = useState<Transaction[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pending, setPending] = useState<{ tx: Transaction; categoryId: string } | undefined>();
  const [notice, setNotice] = useState<string>();

  const range = useMemo(() => {
    if (month === ALL) return {};
    const [y, m] = month.split("-").map(Number);
    const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
    return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
  }, [month]);

  const filters = useMemo(
    () => ({
      categoryId: categoryId === ALL ? undefined : categoryId,
      accountId: accountId === ALL ? undefined : accountId,
      q: query || undefined,
      ...range,
    }),
    [categoryId, accountId, query, range],
  );
  const txs = useQuery(
    () => api.transactions({ ...filters, limit: String(PAGE) }),
    [categoryId, accountId, query, month],
  );
  // Pages appended by "Load more" belong to the current filters only.
  useEffect(() => setExtra([]), [categoryId, accountId, query, month]);
  const accounts = useQuery(() => api.accounts());
  const accountName = useMemo(
    () => new Map(accounts.data?.accounts.map((a) => [a.id, a.name]) ?? []),
    [accounts.data],
  );
  const rows = useMemo(() => [...(txs.data?.transactions ?? []), ...extra], [txs.data, extra]);
  const hasMore = Boolean(txs.data) && rows.length < (txs.data?.total ?? 0);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const page = await api.transactions({
        ...filters,
        limit: String(PAGE),
        offset: String(rows.length),
      });
      setExtra((e) => [...e, ...page.transactions]);
    } finally {
      setLoadingMore(false);
    }
  }
  const summary = useQuery(() => api.summary(13));
  useSyncRefresh(txs.refetch);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value === ALL || !value) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  async function changeCategory(tx: Transaction, next: string, applyToMerchant: boolean) {
    const res = await api.setCategory(tx.id, next, applyToMerchant);
    setPending(applyToMerchant ? undefined : { tx: res.transaction, categoryId: next });
    if (applyToMerchant) setNotice(`Rule saved. ${res.recategorized} other transactions updated.`);
    txs.refetch();
    setExtra((e) => e.map((t) => (t.id === tx.id ? { ...t, categoryId: next } : t)));
  }

  const months = summary.data?.months.map((m) => m.month).reverse() ?? [];

  return (
    <>
      <PageHeader
        title="Transactions"
        description={txs.data ? `${txs.data.total} matching` : undefined}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          placeholder="Search description or merchant"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-64"
        />
        <Select value={month} onValueChange={(v) => setParam("month", v)}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All months</SelectItem>
            {months.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoryId} onValueChange={(v) => setParam("categoryId", v)}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={accountId} onValueChange={(v) => setParam("accountId", v)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Account" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All accounts</SelectItem>
            {accounts.data?.accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {pending && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span>
            Moved <span className="font-medium">{pending.tx.description}</span> to{" "}
            <CategoryBadge id={pending.categoryId} />.
          </span>
          <Button size="xs" onClick={() => changeCategory(pending.tx, pending.categoryId, true)}>
            Always file "{pending.tx.merchant}" here
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setPending(undefined)}>
            Dismiss
          </Button>
        </div>
      )}
      {notice && (
        <div className="mb-3 flex items-center justify-between rounded-md border px-3 py-2 text-sm">
          <span>{notice}</span>
          <Button size="xs" variant="ghost" onClick={() => setNotice(undefined)}>
            Dismiss
          </Button>
        </div>
      )}

      {txs.error && <ErrorBlock message={txs.error} />}
      {!txs.data && !txs.error && <LoadingBlock rows={10} />}
      {txs.data && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-56">Category</TableHead>
                <TableHead className="w-32 text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {dateLabel(t.postedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="truncate">{t.description}</span>
                      {t.pending && <Badge variant="secondary">pending</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t.merchantLabel && (
                        <span className="text-foreground/70">{t.merchantLabel} · </span>
                      )}
                      {accountName.get(t.accountId)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <CategorySelect
                      value={t.categoryId}
                      onChange={(v) => changeCategory(t, v, false)}
                      ariaLabel={`Category for ${t.description}`}
                    />
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${t.amount > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}
                  >
                    {signed(t.amount)}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No transactions match.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {hasMore && (
            <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
              <span>
                Showing {rows.length} of {txs.data.total}
              </span>
              <Button size="sm" variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore
                  ? "Loading"
                  : `Load ${Math.min(PAGE, txs.data.total - rows.length)} more`}
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
