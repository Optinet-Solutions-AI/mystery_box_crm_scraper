import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import { env } from "@/lib/env";
import { AnalystChat } from "./chat";

export default async function AnalystPage() {
  await connection();
  const enabled = env.hasAI;
  return (
    <div>
      <PageHeader
        title="AI market analyst"
        description="Ask questions in plain language. The analyst queries the structured intelligence database (offers, campaigns, metrics, lifecycles) and cites the emails and campaigns behind every claim. Counts are inbox-observed activity, not market share."
      />
      {!enabled && (
        <div className="mb-4 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2">
          The analyst is turned off because <code>OPENAI_API_KEY</code> is not set. Add it to your environment and restart the app.
        </div>
      )}
      <AnalystChat enabled={enabled} />
    </div>
  );
}
