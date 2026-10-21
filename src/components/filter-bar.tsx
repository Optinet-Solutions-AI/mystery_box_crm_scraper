"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";

type Option = { id: string; name: string; color?: string };

export type FilterBarProps = {
  brands: Option[];
  industries: Option[];
  countries: string[];
  accounts: Option[];
  /** Which controls to show (all by default). */
  show?: ("brands" | "date" | "industry" | "country" | "account")[];
  /** Optional cap on brand selection (compare page uses 10). */
  maxBrands?: number;
};

const PRESETS = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 180, label: "Last 6 months" },
  { days: 365, label: "Last 12 months" },
];

const select =
  "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink focus:border-accent focus:outline-none";

/** Global filters, stored in the URL so every view is shareable and bookmarkable. */
export function FilterBar({ brands, industries, countries, accounts, show, maxBrands }: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const visible = (k: NonNullable<FilterBarProps["show"]>[number]) => !show || show.includes(k);

  const selected = (params.get("brands") ?? "").split(",").filter(Boolean);
  const days = params.get("days") ?? (params.get("from") ? "custom" : "30");

  function update(next: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") p.delete(k);
      else p.set(k, v);
    }
    start(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }));
  }

  function toggleBrand(id: string) {
    const set = new Set(selected);
    if (set.has(id)) set.delete(id);
    else {
      if (maxBrands && set.size >= maxBrands) return;
      set.add(id);
    }
    update({ brands: [...set].join(",") || null });
  }

  return (
    <div className={clsx("mb-6 flex flex-wrap items-center gap-2", pending && "opacity-70")}>
      {visible("brands") && (
        <div className="relative">
          <button type="button" className={clsx(select, "flex items-center gap-2")} onClick={() => setOpen((o) => !o)}>
            {selected.length === 0 ? "All brands" : `${selected.length} brand${selected.length > 1 ? "s" : ""}`}
            <ChevronDown size={14} />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute z-20 mt-1 max-h-80 w-64 overflow-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm text-ink-2 hover:bg-surface-2"
                  onClick={() => update({ brands: null })}
                >
                  All brands
                </button>
                {brands.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-surface-2"
                    onClick={() => toggleBrand(b.id)}
                  >
                    <span className="flex w-4 justify-center">{selected.includes(b.id) && <Check size={16} strokeWidth={3} />}</span>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />
                    {b.name}
                  </button>
                ))}
                {maxBrands && <p className="px-2 py-1 text-xs text-muted">Select up to {maxBrands}.</p>}
              </div>
            </>
          )}
        </div>
      )}

      {visible("date") && (
        <>
          <select
            className={select}
            value={days}
            onChange={(e) =>
              e.target.value === "custom"
                ? update({ days: null, from: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) })
                : update({ days: e.target.value, from: null, to: null })
            }
          >
            {PRESETS.map((p) => (
              <option key={p.days} value={p.days}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom range</option>
          </select>
          {days === "custom" && (
            <>
              <input type="date" className={select} value={params.get("from") ?? ""} onChange={(e) => update({ from: e.target.value })} />
              <span className="text-sm text-muted">to</span>
              <input type="date" className={select} value={params.get("to") ?? ""} onChange={(e) => update({ to: e.target.value })} />
            </>
          )}
        </>
      )}

      {visible("industry") && industries.length > 1 && (
        <select className={select} value={params.get("industry") ?? ""} onChange={(e) => update({ industry: e.target.value })}>
          <option value="">All industries</option>
          {industries.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      )}

      {visible("country") && countries.length > 0 && (
        <select className={select} value={params.get("country") ?? ""} onChange={(e) => update({ country: e.target.value })}>
          <option value="">All countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}

      {visible("account") && accounts.length > 0 && (
        <select className={select} value={params.get("account") ?? ""} onChange={(e) => update({ account: e.target.value })}>
          <option value="">All test accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
