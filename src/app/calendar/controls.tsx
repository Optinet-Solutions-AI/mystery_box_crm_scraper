"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Opt = { value: string; label: string };

const select =
  "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink focus:border-accent focus:outline-none";

export function CalendarControls({
  title,
  prevDate,
  nextDate,
  groups,
  offerTypes,
}: {
  title: string;
  prevDate: string;
  nextDate: string;
  groups: Opt[];
  offerTypes: Opt[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const view = params.get("view") ?? "month";
  const dates = params.get("dates") ?? "email";

  function update(next: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") p.delete(k);
      else p.set(k, v);
    }
    start(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }));
  }

  const seg = (active: boolean) =>
    clsx("px-3 py-1.5 text-sm", active ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink");

  return (
    <div className={clsx("mb-4 flex flex-wrap items-center gap-2", pending && "opacity-70")}>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Previous" className="rounded-lg border border-line bg-surface p-1.5 text-ink hover:bg-surface-2" onClick={() => update({ date: prevDate })}>
          <ChevronLeft size={16} />
        </button>
        <button type="button" className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink hover:bg-surface-2" onClick={() => update({ date: null })}>
          Today
        </button>
        <button type="button" aria-label="Next" className="rounded-lg border border-line bg-surface p-1.5 text-ink hover:bg-surface-2" onClick={() => update({ date: nextDate })}>
          <ChevronRight size={16} />
        </button>
        <span className="ml-2 text-base font-semibold text-ink">{title}</span>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-line bg-surface" role="tablist" aria-label="View">
          {(["month", "week", "day"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className={seg(view === v)} onClick={() => update({ view: v === "month" ? null : v })}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-lg border border-line bg-surface" role="tablist" aria-label="Dates shown">
          <button type="button" role="tab" aria-selected={dates === "email"} className={seg(dates === "email")} onClick={() => update({ dates: null })}>
            Email send dates
          </button>
          <button type="button" role="tab" aria-selected={dates === "promo"} className={seg(dates === "promo")} onClick={() => update({ dates: "promo" })}>
            Advertised promo dates
          </button>
        </div>
        <select className={select} value={params.get("group") ?? ""} onChange={(e) => update({ group: e.target.value })} aria-label="Campaign type">
          <option value="">All campaign types</option>
          {groups.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
        <select className={select} value={params.get("offer") ?? ""} onChange={(e) => update({ offer: e.target.value })} aria-label="Promotion type">
          <option value="">All promotion types</option>
          {offerTypes.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
