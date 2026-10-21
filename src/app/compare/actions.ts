"use server";

import { DEFAULT_WEIGHTS, type ScoreKey, type Weights } from "@/lib/metrics";
import { supabaseAdmin } from "@/lib/supabase";

const KEYS = Object.keys(DEFAULT_WEIGHTS) as ScoreKey[];

function clean(input: Partial<Record<string, unknown>>): Weights {
  const out = { ...DEFAULT_WEIGHTS };
  for (const k of KEYS) {
    const v = Number(input[k]);
    if (Number.isFinite(v)) out[k] = Math.max(0, Math.min(3, Math.round(v * 4) / 4));
  }
  return out;
}

/** Persists scorecard weights (0–3 each) to app_settings.scorecard_weights. */
export async function saveScorecardWeights(weights: Partial<Record<string, unknown>>): Promise<Weights> {
  const value = clean(weights);
  const res = await supabaseAdmin()
    .from("app_settings")
    .upsert({ key: "scorecard_weights", value, updated_at: new Date().toISOString() });
  if (res.error) throw new Error(`Saving weights failed: ${res.error.message}`);
  return value;
}

export async function resetScorecardWeights(): Promise<Weights> {
  return saveScorecardWeights(DEFAULT_WEIGHTS);
}
