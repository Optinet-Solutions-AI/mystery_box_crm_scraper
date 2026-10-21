import OpenAI from "openai";
import { z } from "zod";
import { env } from "@/lib/env";
import { AnalystError, runAnalyst } from "@/lib/ai/analyst";

export const maxDuration = 300;

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(20000) }))
    .min(1)
    .max(40),
});

export async function POST(req: Request) {
  if (!env.hasAI) {
    return Response.json({ error: "The AI analyst needs OPENAI_API_KEY to be set in the environment." }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { messages } = parsed.data;
  if (messages[messages.length - 1].role !== "user") return Response.json({ error: "The last message must be from the user." }, { status: 400 });

  try {
    const answer = await runAnalyst(messages);
    return Response.json({ answer });
  } catch (err) {
    if (err instanceof AnalystError) return Response.json({ error: err.message }, { status: 422 });
    if (err instanceof OpenAI.RateLimitError) return Response.json({ error: "The AI service is rate limited. Try again in a minute." }, { status: 429 });
    if (err instanceof OpenAI.AuthenticationError) return Response.json({ error: "The OpenAI API key was rejected. Check OPENAI_API_KEY." }, { status: 500 });
    if (err instanceof OpenAI.BadRequestError) return Response.json({ error: `The AI request was rejected: ${err.message}` }, { status: 500 });
    if (err instanceof OpenAI.APIError) return Response.json({ error: `AI service error (${err.status ?? "network"}). Try again.` }, { status: 502 });
    console.error("analyst failed", err);
    return Response.json({ error: err instanceof Error ? err.message : "Something went wrong." }, { status: 500 });
  }
}
