import "server-only";
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

/** Reads ANTHROPIC_API_KEY (or another configured credential) from the environment. */
export function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Server-side fallback: if the model declines a request for policy reasons,
 * the API retries it on Anthropic's recommended fallback model in the same call.
 */
export const FALLBACK_PARAMS = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default" as const,
};
