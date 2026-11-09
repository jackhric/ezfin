import { ErrorBlock, LoadingBlock } from "@/components/page";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { Field, Section } from "./_shared";
import { ScheduleSettings } from "./schedule";

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

export function ServerSettings() {
  const info = useQuery(() => api.serverInfo());
  if (info.error) return <ErrorBlock message={info.error} />;
  if (!info.data) return <LoadingBlock />;
  const i = info.data;
  return (
    <Section
      title="Server"
      description="How this instance is running. These values come from environment variables; change them in .env or compose.yaml and restart."
    >
      <div className="space-y-6">
        <Field label="Version">
          <div className="text-sm">
            ezfin {i.version} on Node {i.node}
          </div>
        </Field>
        <Field label="Uptime">
          <div className="text-sm">
            Started {relativeTime(i.startedAt)}
            {i.container ? ", running in a container" : ""}
          </div>
        </Field>
        <Field
          label="Listening on"
          help="Keep this on loopback unless the port is published to 127.0.0.1 by Docker."
        >
          <code className="text-sm">{i.bind}</code>
        </Field>
        <Field
          label="Data folder"
          help="Database, bank credentials. Back this folder up; it is everything."
        >
          <code className="text-sm break-all">{i.dataDir}</code>
        </Field>
        <Field label="Database">
          <div className="text-sm">
            <code className="break-all">{i.database.path}</code> ({mb(i.database.bytes)})
          </div>
        </Field>
        <Field label="Local AI">
          <div className="text-sm">
            {i.ai.provider} at <code>{i.ai.url}</code>, model <code>{i.ai.model}</code>
          </div>
        </Field>
        <Field label="Users">
          <div className="text-sm">{i.users}</div>
        </Field>
        <ScheduleSettings />
      </div>
    </Section>
  );
}
