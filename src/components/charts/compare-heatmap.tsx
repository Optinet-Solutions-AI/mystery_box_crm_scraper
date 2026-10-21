"use client";

import { useState } from "react";
import { useIsDark } from "./theme";

export type HeatRow = { brandId: string; name: string; counts: Record<string, number>; total: number };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Sequential blue ramp (reference instance), light -> dark.
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];

/**
 * Weekday × brand heatmap of promotional send volume. Each row is shaded by its
 * own share (so a low-volume brand's pattern is still visible); exact counts
 * are in the tooltip and the screen-reader table.
 */
export function CompareHeatmap({ rows }: { rows: HeatRow[] }) {
  const dark = useIsDark();
  const [hover, setHover] = useState<{ brand: string; day: string; count: number; share: number } | null>(null);
  const empty = dark ? "#232321" : "#f3f2ef";

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[420px] gap-[2px]" style={{ gridTemplateColumns: "minmax(110px,auto) repeat(7, minmax(36px,1fr))" }}>
          <div />
          {DAYS.map((d) => (
            <div key={d} className="pb-1 text-center text-xs text-muted">
              {d}
            </div>
          ))}
          {rows.map((r) => {
            const max = Math.max(1, ...DAYS.map((d) => r.counts[d] ?? 0));
            return [
              <div key={`${r.brandId}-name`} className="truncate pr-2 text-sm text-ink-2" title={r.name}>
                {r.name}
              </div>,
              ...DAYS.map((d) => {
                const count = r.counts[d] ?? 0;
                const share = r.total ? count / r.total : 0;
                const step = count === 0 ? -1 : Math.min(RAMP.length - 1, Math.floor((count / max) * (RAMP.length - 1)));
                return (
                  <div
                    key={`${r.brandId}-${d}`}
                    className="h-8 rounded-[4px]"
                    style={{ background: step < 0 ? empty : RAMP[step] }}
                    onMouseEnter={() => setHover({ brand: r.name, day: d, count, share })}
                    onMouseLeave={() => setHover(null)}
                    title={`${r.name} · ${d}: ${count} promo emails (${Math.round(share * 100)}%)`}
                  />
                );
              }),
            ];
          })}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
        <span className="min-h-4">
          {hover ? `${hover.brand} · ${hover.day}: ${hover.count} promo emails (${Math.round(hover.share * 100)}% of the brand's sends)` : "Hover a cell for counts. Days are UTC."}
        </span>
        <span className="inline-flex items-center gap-1">
          fewer
          {RAMP.map((c) => (
            <span key={c} className="h-2.5 w-4 rounded-sm" style={{ background: c }} />
          ))}
          more
        </span>
      </div>
      <table className="sr-only">
        <caption>Promotional emails by weekday</caption>
        <thead>
          <tr>
            <th>Brand</th>
            {DAYS.map((d) => (
              <th key={d}>{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.brandId}>
              <th>{r.name}</th>
              {DAYS.map((d) => (
                <td key={d}>{r.counts[d] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
