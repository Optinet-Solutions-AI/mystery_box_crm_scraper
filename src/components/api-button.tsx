"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { buttonClass, secondaryButtonClass } from "./ui";

/** Button that POSTs JSON to an API route, shows the outcome and refreshes the page. */
export function ApiButton({
  endpoint,
  body,
  children,
  primary,
  confirm,
  describe,
}: {
  endpoint: string;
  body?: unknown;
  children: ReactNode;
  primary?: boolean;
  confirm?: string;
  /** How to summarize the JSON response ("sync" understands sync/process results). */
  describe?: "sync" | "discover" | "plain";
}) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; msg: string | null; error: boolean }>({ busy: false, msg: null, error: false });

  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    setState({ busy: true, msg: null, error: false });
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || json.ok === false) throw new Error(String(json.error ?? `Request failed (${res.status})`));
      setState({ busy: false, msg: describe === "sync" ? describeSync(json) : describe === "discover" ? `Checked ${json.scanned ?? 0} emails · ${json.created ?? 0} new senders · ${json.triaged ?? 0} reviewed` : "Done", error: false });
      router.refresh();
    } catch (err) {
      setState({ busy: false, msg: err instanceof Error ? err.message : String(err), error: true });
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={run} disabled={state.busy} className={primary ? buttonClass : secondaryButtonClass}>
        {state.busy ? "Working…" : children}
      </button>
      {state.msg && <span className={state.error ? "text-xs text-bad" : "text-xs text-ink-2"}>{state.msg}</span>}
    </span>
  );
}

export function describeSync(json: Record<string, unknown>): string {
  const sync = json.sync as Record<string, unknown> | undefined;
  const processed = json.processed as { analyzed?: number; remaining?: number } | null | undefined;
  const parts: string[] = [];
  const add = (s: { inserted?: number; duplicates?: number; ignored?: number; error?: string }, label?: string) => {
    if (s.error) parts.push(`${label ? label + ": " : ""}${s.error}`);
    else parts.push(`${label ? label + ": " : ""}${s.inserted ?? 0} new, ${s.duplicates ?? 0} already stored`);
  };
  if (sync && "inserted" in sync) add(sync as never);
  else if (sync) for (const [k, v] of Object.entries(sync)) add(v as never, k);
  if (processed) parts.push(`${processed.analyzed ?? 0} analyzed, ${processed.remaining ?? 0} queued`);
  return parts.join(" · ") || "Done";
}
