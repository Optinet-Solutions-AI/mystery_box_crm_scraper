import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";

let client: OpenAI | null = null;

/** Reads OPENAI_API_KEY from the environment. */
export function openai(): OpenAI {
  if (!client) client = new OpenAI();
  return client;
}

/** A function tool the AI analyst can call: a Zod input schema plus the code that runs it. */
export type AnalystTool = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  run: (input: never) => unknown | Promise<unknown>;
};

export function defineTool<S extends z.ZodType>(tool: {
  name: string;
  description: string;
  inputSchema: S;
  run: (input: z.infer<S>) => unknown | Promise<unknown>;
}): AnalystTool {
  return tool as unknown as AnalystTool;
}

export class AIRefusedError extends Error {}

type InputContent = OpenAI.Responses.ResponseInputMessageContentList;

/**
 * One structured-output call: the reply is validated against `schema`
 * (strict JSON schema), so the result is always typed and complete.
 */
export async function parseStructured<S extends z.ZodType>(opts: {
  schema: S;
  name: string;
  instructions: string;
  content: InputContent | string;
  effort?: "low" | "medium" | "high";
  model: string;
}): Promise<z.infer<S>> {
  const response = await openai().responses.parse({
    model: opts.model,
    instructions: opts.instructions,
    input: [{ role: "user", content: opts.content }],
    text: { format: zodTextFormat(opts.schema, opts.name) },
    reasoning: { effort: opts.effort ?? "low" },
    max_output_tokens: 16000,
  });
  const refusal = response.output
    .flatMap((item) => (item.type === "message" ? item.content : []))
    .find((c) => c.type === "refusal");
  if (refusal) throw new AIRefusedError("The model declined this request.");
  if (response.status === "incomplete") {
    throw new Error(`The AI response was cut off (${response.incomplete_details?.reason ?? "incomplete"}).`);
  }
  if (response.output_parsed == null) throw new Error("The AI returned no structured output.");
  return response.output_parsed as z.infer<S>;
}
