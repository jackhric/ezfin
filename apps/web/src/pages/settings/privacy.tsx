import { CATEGORY_BY_ID } from "@ezfin/core";
import { CategoryBadge } from "@/components/category-badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { Field, Section } from "./_shared";

export function PrivacySettings() {
  const cats = useQuery(() => api.categories());
  const rules = Object.entries(cats.data?.overrides ?? {});
  return (
    <Section
      title="Privacy"
      description="What this app does and does not do with your data, and what it has learned from you."
    >
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
        <li>
          Bank data is pulled by the API process on this computer and stored in a SQLite file in the
          data folder.
        </li>
        <li>
          The API listens on 127.0.0.1 only and rejects requests whose Host header is not local.
        </li>
        <li>
          The web app has a Content Security Policy that forbids connecting to any origin except
          itself.
        </li>
        <li>
          Categorization and subscription detection run locally. The optional AI step talks only to
          a model server on this machine; the API refuses any other address.
        </li>
        <li>
          The only outbound connections are from the API to your aggregator when you press Sync, and
          to your local model server when you run AI categorization.
        </li>
        <li>
          Every account, transaction and bank credential belongs to one user. Other people on this
          install cannot see yours.
        </li>
        <li>
          The data folder and all database files are ignored by git, so they cannot be committed by
          accident.
        </li>
      </ul>

      <div className="border-t pt-6">
        <Field
          label="Learned merchant rules"
          help='Created when you choose "Always file here" on a transaction. Shared by everyone on this install.'
        >
          {rules.length === 0 && <p className="text-sm text-muted-foreground">No rules yet.</p>}
          <div className="divide-y">
            {rules.map(([merchant, categoryId]) => (
              <div key={merchant} className="flex items-center justify-between py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="font-medium capitalize">{merchant}</span>
                  <CategoryBadge id={categoryId} />
                  <span className="sr-only">{CATEGORY_BY_ID.get(categoryId)?.name}</span>
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={async () => {
                    await api.deleteRule(merchant);
                    cats.refetch();
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </Field>
      </div>
    </Section>
  );
}
