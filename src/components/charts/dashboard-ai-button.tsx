"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { secondaryButtonClass } from "@/components/ui";

/** Regenerates feed items + the AI summary for the current filters, then refreshes the page. */
export function DashboardAiButton() {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/insights?${params.toString()}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) throw new Error(body.error ?? `Request failed (${res.status})`);
      start(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="max-w-xs truncate text-xs text-bad" title={error}>{error}</span>}
      <button type="button" className={secondaryButtonClass} onClick={run} disabled={busy}>
        <Sparkles size={14} />
        {busy ? "Analyzing…" : "Generate summary"}
      </button>
    </div>
  );
}
