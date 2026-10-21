"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";

type Opt = { id: string; label: string; color: string; registered: boolean };

/** Chooses which test accounts to align, and the horizon in days. Stored in the URL. */
export function AccountPicker({ options, selected, horizon }: { options: Opt[]; selected: string[]; horizon: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  function set(next: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (!v) p.delete(k);
      else p.set(k, v);
    }
    start(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }));
  }

  function toggle(id: string) {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    set({ accounts: [...s].join(",") || null });
  }

  return (
    <div className={clsx("flex flex-wrap items-center gap-2", pending && "opacity-70")}>
      <span className="text-xs font-medium text-ink-2">Compare accounts:</span>
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            disabled={!o.registered}
            title={o.registered ? undefined : "Set the signup time first"}
            onClick={() => toggle(o.id)}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
              on ? "border-accent bg-accent/10 font-medium text-ink" : "border-line bg-surface text-ink-2 hover:bg-surface-2",
              !o.registered && "cursor-not-allowed opacity-50",
            )}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: o.color }} />
            {o.label}
          </button>
        );
      })}
      <select
        className="ml-auto rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
        value={String(horizon)}
        onChange={(e) => set({ horizon: e.target.value === "30" ? null : e.target.value })}
      >
        <option value="7">First 7 days</option>
        <option value="14">First 14 days</option>
        <option value="30">First 30 days</option>
        <option value="60">First 60 days</option>
        <option value="90">First 90 days</option>
      </select>
    </div>
  );
}
