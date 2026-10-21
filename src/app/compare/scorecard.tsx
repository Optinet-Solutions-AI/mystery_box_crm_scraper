"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { resetScorecardWeights, saveScorecardWeights } from "./actions";
import { seriesColor, useIsDark } from "@/components/charts/theme";

export type ScoreRow = {
  brandId: string;
  name: string;
  color: string;
  scores: Record<ScoreKey, number>;
  coverage: { promoEmails: number; days: number; campaigns: number };
  confidence: "low" | "medium" | "high";
};

type ScoreKey = "aggressiveness" | "intensity" | "variety" | "lifecycle" | "creative" | "consistency";
type Weights = Record<ScoreKey, number>;
type Formulas = Record<ScoreKey, { label: string; formula: string }>;
const KEYS: ScoreKey[] = ["aggressiveness", "intensity", "variety", "lifecycle", "creative", "consistency"];
const DEFAULT_WEIGHTS: Weights = { aggressiveness: 1, intensity: 1, variety: 1, lifecycle: 1, creative: 1, consistency: 1 };

function overall(scores: Record<ScoreKey, number>, w: Weights) {
  const total = KEYS.reduce((s, k) => s + (w[k] ?? 0), 0) || 1;
  return Math.round(KEYS.reduce((s, k) => s + scores[k] * (w[k] ?? 0), 0) / total);
}

/** One-hue meter: fill carries the value, the track is a lighter step of the same blue. */
function Meter({ value, dark }: { value: number; dark: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: dark ? "#184f95" : "#cde2fb" }}>
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: dark ? "#3987e5" : "#2a78d6" }} />
      </div>
      <span className="tabular w-7 text-right text-sm text-ink">{value}</span>
    </div>
  );
}

export function Scorecard({ rows, initialWeights, formulas: SCORE_FORMULAS }: { rows: ScoreRow[]; initialWeights: Weights; formulas: Formulas }) {
  const dark = useIsDark();
  const [weights, setWeights] = useState<Weights>({ ...DEFAULT_WEIGHTS, ...initialWeights });
  const [saved, setSaved] = useState(true);
  const [pending, start] = useTransition();
  const [showFormulas, setShowFormulas] = useState(false);

  const ranked = [...rows].sort((a, b) => overall(b.scores, weights) - overall(a.scores, weights));

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-ink-2">
              <th className="px-3 py-2 font-medium">Brand</th>
              <th className="px-3 py-2 font-medium">Overall</th>
              {KEYS.map((k) => (
                <th key={k} className="px-3 py-2 font-medium whitespace-nowrap" title={SCORE_FORMULAS[k].formula}>
                  {SCORE_FORMULAS[k].label}
                </th>
              ))}
              <th className="px-3 py-2 font-medium whitespace-nowrap">Data coverage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ranked.map((r) => (
              <tr key={r.brandId}>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Link href={`/brands/${r.brandId}`} className="inline-flex items-center gap-1.5 font-medium text-ink hover:underline">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: seriesColor(r.color, dark) }} aria-hidden />
                    {r.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-lg font-semibold text-ink tabular">{overall(r.scores, weights)}</td>
                {KEYS.map((k) => (
                  <td key={k} className="px-3 py-2">
                    <Meter value={r.scores[k]} dark={dark} />
                  </td>
                ))}
                <td className="px-3 py-2 text-xs whitespace-nowrap text-ink-2">
                  {r.coverage.promoEmails} promo emails · {r.coverage.campaigns} campaigns · {r.coverage.days} days
                  <span
                    className={
                      "ml-2 rounded-md border px-1.5 py-0.5 font-medium " +
                      (r.confidence === "high" ? "border-good/30 text-good" : r.confidence === "medium" ? "border-line text-ink-2" : "border-[#fab219]/50 text-ink")
                    }
                  >
                    {r.confidence === "low" ? "⚠ " : ""}
                    {r.confidence} confidence
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-line bg-surface-2 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-ink-2">Weights for the overall score (0 = ignore, 3 = triple weight)</p>
          <div className="flex items-center gap-2 text-xs">
            <button type="button" className="text-accent hover:underline" onClick={() => setShowFormulas((s) => !s)}>
              {showFormulas ? "Hide formulas" : "Show formulas"}
            </button>
            <button
              type="button"
              disabled={pending}
              className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-surface-2"
              onClick={() =>
                start(async () => {
                  setWeights(await resetScorecardWeights());
                  setSaved(true);
                })
              }
            >
              Reset
            </button>
            <button
              type="button"
              disabled={pending || saved}
              className="rounded-md bg-accent px-2 py-1 font-medium text-accent-ink disabled:opacity-50"
              onClick={() =>
                start(async () => {
                  setWeights(await saveScorecardWeights(weights));
                  setSaved(true);
                })
              }
            >
              {pending ? "Saving…" : saved ? "Saved" : "Save weights"}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {KEYS.map((k) => (
            <label key={k} className="flex items-center gap-3 text-sm">
              <span className="w-48 shrink-0 text-ink-2">{SCORE_FORMULAS[k].label}</span>
              <input
                type="range"
                min={0}
                max={3}
                step={0.25}
                value={weights[k]}
                onChange={(e) => {
                  setWeights({ ...weights, [k]: Number(e.target.value) });
                  setSaved(false);
                }}
                className="flex-1 accent-[var(--accent)]"
                aria-label={`${SCORE_FORMULAS[k].label} weight`}
              />
              <span className="tabular w-8 text-right text-ink">{weights[k]}</span>
            </label>
          ))}
        </div>
        {showFormulas && (
          <dl className="mt-3 space-y-2 border-t border-line pt-3 text-xs">
            {KEYS.map((k) => (
              <div key={k}>
                <dt className="font-medium text-ink">{SCORE_FORMULAS[k].label}</dt>
                <dd className="text-ink-2">{SCORE_FORMULAS[k].formula}</dd>
              </div>
            ))}
            <div>
              <dt className="font-medium text-ink">Overall</dt>
              <dd className="text-ink-2">Weighted average of the six scores using the weights above.</dd>
            </div>
            <div>
              <dt className="font-medium text-ink">Confidence</dt>
              <dd className="text-ink-2">High: 30+ promotional emails in the period · Medium: 10–29 · Low: under 10.</dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  );
}
