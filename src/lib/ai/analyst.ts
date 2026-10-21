import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import { anthropic, FALLBACK_PARAMS } from "./client";
import { analystTools } from "./analyst-tools";

export type ChatTurn = { role: "user" | "assistant"; content: string };

// Kept byte-stable (no dates, ids or other per-request values) so it caches.
const SYSTEM_PROMPT = `You are the AI market intelligence analyst inside a CRM competitor-intelligence dashboard. The team signs up research test accounts at competitor brands (currently mystery box / card-rip operators, but the platform supports any industry) and every email those accounts receive is classified, and its offers are extracted into a structured database.

Always answer from the structured database through your tools. Never rely on memory or invent brands, numbers, offers, dates or emails. If the data is thin or missing, say so plainly and say what would fill the gap (more time, more test accounts, a brand not yet tracked).

Answer format (Markdown):
1. **Direct answer** - one or two sentences first.
2. **Numbers & comparison** - the relevant figures, compared across brands and/or periods. A small table is fine.
3. **Evidence** - link the supporting emails and campaigns using relative links exactly like [subject or title](/emails/<email_id>) and [campaign title](/campaigns/<campaign_id>). Every claim about a specific offer, campaign or email must link its source.
4. **Change vs previous period** - when relevant, what moved and by how much.
5. **Recommendations** - only when the data justifies them; keep them concrete and few.

Rules:
- Campaigns are inferred groupings of related emails; call them "inferred campaigns" when it matters, never official confirmed promotions.
- Lifecycle sequences are observed behavior for specific test accounts, not guaranteed sequences for all customers. Never assume a deposit, purchase or other action happened unless it appears in recorded_actions.
- Email counts are inbox-observed activity, not market share. Never claim anything about deliverability, open or conversion rates, revenue or profitability.
- Advertised values are what the email states; mention key conditions (minimums, caps, wagering, eligibility) when comparing offers.
- Resolve relative time phrases ("this week", "past 30 days", "this weekend") against the current date given in the user's message.
- For a "weekly report" request, cover: volume changes per brand, new inferred campaigns, new or changed offers, offers expiring soon, notable messaging shifts, and items the CRM team should review - each with evidence links.
- Be concise. Use brand names, not ids, in prose.`;

export class AnalystError extends Error {}

/** Runs the analyst agent over the conversation and returns the final Markdown answer. */
export async function runAnalyst(history: ChatTurn[]): Promise<string> {
  const today = new Date();
  const dateLine = `Current date: ${today.toISOString().slice(0, 10)} (${today.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}, UTC).`;

  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((t, i) =>
    i === history.length - 1 && t.role === "user"
      ? { role: "user", content: `${dateLine}\n\n${t.content}` }
      : { role: t.role, content: t.content },
  );

  const runner = anthropic().beta.messages.toolRunner({
    model: env.anthropicModel,
    max_tokens: 16000,
    ...FALLBACK_PARAMS,
    output_config: { effort: "medium" },
    cache_control: { type: "ephemeral" },
    system: SYSTEM_PROMPT,
    tools: analystTools,
    messages,
    max_iterations: 10,
  });

  const final = await runner.runUntilDone();

  if (final.stop_reason === "refusal") {
    throw new AnalystError("The analyst declined to answer this request. Try rephrasing the question around the tracked competitor data.");
  }
  const text = final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
  if (!text) {
    if (final.stop_reason === "tool_use") {
      throw new AnalystError("The question needed more lookups than allowed in one answer. Try narrowing it to fewer brands or a shorter period.");
    }
    if (final.stop_reason === "max_tokens") throw new AnalystError("The answer was cut off. Try asking for a shorter summary.");
    throw new AnalystError("The analyst returned an empty answer. Please try again.");
  }
  return final.stop_reason === "max_tokens" ? `${text}\n\n_(Answer was cut off - ask a narrower question for the rest.)_` : text;
}
