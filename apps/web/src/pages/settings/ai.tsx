import { LocalAiCard } from "@/components/local-ai-card";
import { Section } from "./layout";

export function AiSettings() {
  return (
    <Section
      title="Local AI"
      description="Server-wide. A small model on this machine that explains merchants and fills categorization gaps for everyone."
    >
      <LocalAiCard />
    </Section>
  );
}
