import "server-only";
import type OpenAI from "openai";
import { z } from "zod";
import { env } from "../env";
import { openai } from "./client";
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

const MAX_ROUNDS = 10;

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

/** Function-tool definitions in the Responses API shape (JSON schema from each Zod schema). */
const toolDefs: OpenAI.Responses.FunctionTool[] = analystTools.map((t) => ({
  type: "function",
  name: t.name,
  description: t.description,
  parameters: jsonSchema(t.inputSchema),
  strict: false, // inputs are validated with Zod below
}));

async function runTool(call: OpenAI.Responses.ResponseFunctionToolCall): Promise<string> {
  const tool = analystTools.find((t) => t.name === call.name);
  if (!tool) return JSON.stringify({ error: `Unknown tool ${call.name}` });
  let args: unknown;
  try {
    args = call.arguments ? JSON.parse(call.arguments) : {};
  } catch {
    return JSON.stringify({ error: "Arguments were not valid JSON. Try again." });
  }
  const parsed = tool.inputSchema.safeParse(args);
  if (!parsed.success) return JSON.stringify({ error: "Invalid arguments", issues: parsed.error.issues.slice(0, 5) });
  try {
    const result = await (tool.run as (input: unknown) => unknown)(parsed.data);
    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

/** Runs the analyst agent over the conversation and returns the final Markdown answer. */
export async function runAnalyst(history: ChatTurn[]): Promise<string> {
  const today = new Date();
  const dateLine = `Current date: ${today.toISOString().slice(0, 10)} (${today.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}, UTC).`;

  let input: OpenAI.Responses.ResponseInput = history.map((t, i) =>
    i === history.length - 1 && t.role === "user"
      ? { role: "user" as const, content: `${dateLine}

${t.content}` }
      : { role: t.role, content: t.content },
  );
  let previousId: string | undefined;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await openai().responses.create({
      model: env.aiModel,
      instructions: SYSTEM_PROMPT,
      input,
      tools: toolDefs,
      reasoning: { effort: "medium" },
      max_output_tokens: 16000,
      ...(previousId ? { previous_response_id: previousId } : {}),
    });
    previousId = response.id;

    const refusal = response.output.flatMap((o) => (o.type === "message" ? o.content : [])).find((c) => c.type === "refusal");
    if (refusal) throw new AnalystError("The analyst declined to answer this request. Try rephrasing the question around the tracked competitor data.");

    const calls = response.output.filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === "function_call");
    if (calls.length === 0) {
      const text = response.output_text.trim();
      if (!text) {
        if (response.status === "incomplete") throw new AnalystError("The answer was cut off. Try asking for a shorter summary.");
        throw new AnalystError("The analyst returned an empty answer. Please try again.");
      }
      return response.status === "incomplete" ? `${text}

_(Answer was cut off - ask a narrower question for the rest.)_` : text;
    }

    // Run this round's tool calls in parallel and send all results back together.
    const outputs = await Promise.all(calls.map(async (c) => ({ type: "function_call_output" as const, call_id: c.call_id, output: await runTool(c) })));
    input = outputs;
  }
  throw new AnalystError("The question needed more lookups than allowed in one answer. Try narrowing it to fewer brands or a shorter period.");
}
