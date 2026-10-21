"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartChrome, seriesColor, useIsDark } from "./theme";

export type VolumeSeries = { brandId: string; name: string; color: string; weeks: { week: string; count: number }[]; perWeek: number };

/**
 * Small multiples: one column chart per brand, all on the same y-scale so
 * heights compare across panels. One series per panel, so no legend box.
 */
export function CompareVolume({ series }: { series: VolumeSeries[] }) {
  const dark = useIsDark();
  const c = chartChrome(dark);
  const max = Math.max(1, ...series.flatMap((s) => s.weeks.map((w) => w.count)));
  const niceMax = max <= 5 ? max : Math.ceil(max / 5) * 5;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {series.map((s) => (
        <figure key={s.brandId} className="min-w-0">
          <figcaption className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 font-medium text-ink">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: seriesColor(s.color, dark) }} aria-hidden />
              {s.name}
            </span>
            <span className="text-xs text-ink-2">{s.perWeek} / week avg</span>
          </figcaption>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={s.weeks} margin={{ top: 4, right: 4, bottom: 0, left: -24 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke={c.grid} strokeWidth={1} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: c.muted }} tickLine={false} axisLine={{ stroke: c.axis }} interval="preserveStartEnd" minTickGap={24} />
                <YAxis domain={[0, niceMax]} allowDecimals={false} tick={{ fontSize: 10, fill: c.muted }} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: dark ? "rgba(255,255,255,0.06)" : "rgba(11,11,11,0.05)" }}
                  contentStyle={{ background: c.surface, border: `1px solid ${c.grid}`, borderRadius: 8, fontSize: 12, color: c.ink }}
                  labelStyle={{ color: c.ink2 }}
                  formatter={(v) => [`${v} promo emails`, s.name]}
                  labelFormatter={(l) => `Week of ${l}`}
                />
                <Bar dataKey="count" fill={seriesColor(s.color, dark)} radius={[4, 4, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </figure>
      ))}
    </div>
  );
}
