# How recurring detection works

`detectRecurring` in `packages/core/src/recurring.ts` finds subscriptions and recurring bills from the rhythm of your transactions. It needs no merchant list:

1. Group debits by merchant key and collapse same-day splits.
2. Measure the gaps between charges and find the cadence (weekly, biweekly, monthly, quarterly, annual) that fits most gaps. At least 60% of gaps must fit and there must be at least 3 charges.
3. Compare each charge to the median. Small deviation means a fixed subscription; large deviation means a variable bill like a utility.
4. Score confidence from interval fit, amount stability, and sample size.
5. Project the next expected date and flag a series as possibly cancelled if it is overdue by more than half an interval.

Everything is normalized to a monthly equivalent so annual plans and weekly charges compare on one axis.

The API exposes the result at `GET /api/recurring` (`apps/api/src/routes/finance.ts`), computed over the last 400 days of the signed-in user's transactions. The Recurring page (`apps/web/src/pages/recurring.tsx`) shows the series, the monthly total of active ones, and anything that looks cancelled.

Merchant keys come from `packages/core/src/merchant.ts`, which strips store numbers, card suffixes and payment-processor prefixes so "NETFLIX.COM 123" and "Netflix" are the same series. Tests live in `packages/core/tests/recurring.test.ts` and run against synthetic data from `packages/core/src/synthetic.ts`.
