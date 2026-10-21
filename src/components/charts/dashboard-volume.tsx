"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import clsx from "clsx";
import { chartChrome, seriesColor, useIsDark } from "./theme";

type Series = { id: string; name: string; color: string };
type Row = Record<string, number | string>;

const toggle = (active: boolean) =>
  clsx("rounded-md px-2 py-1 text-xs font-medium", active ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink");

/**
 * Stacked bars per brand. Emails and campaign launches are two measures, so they
 * are shown one at a time on the same single axis (never a dual axis).
 */
export function DashboardVolumeChart({ series, daily, weekly }: { series: Series[]; daily: Row[]; weekly: Row[] }) {
  const dark = useIsDark();
  const c = chartChrome(dark);
  const [bucket, setBucket] = useState<"day" | "week">(daily.length > 45 ? "week" : "day");
  const [measure, setMeasure] = useState<"emails" | "campaigns">("emails");
  const data = bucket === "day" ? daily : weekly;
  const key = (id: string) => (measure === "emails" ? id : `${id}__campaigns`);
  const total = data.reduce((s, r) => s + series.reduce((t, x) => t + Number(r[key(x.id)] ?? 0), 0), 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg border border-line p-0.5">
          <button type="button" className={toggle(measure === "emails")} onClick={() => setMeasure("emails")}>
            Promotional emails
          </button>
          <button type="button" className={toggle(measure === "campaigns")} onClick={() => setMeasure("campaigns")}>
            New campaigns
          </button>
        </div>
        <div className="flex gap-1 rounded-lg border border-line p-0.5">
          <button type="button" className={toggle(bucket === "day")} onClick={() => setBucket("day")}>
            Daily
          </button>
          <button type="button" className={toggle(bucket === "week")} onClick={() => setBucket("week")}>
            Weekly
          </button>
        </div>
      </div>
      {total === 0 ? (
        <p className="py-16 text-center text-sm text-muted">No {measure === "emails" ? "promotional emails" : "campaign launches"} in this period.</p>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke={c.grid} />
              <XAxis
                dataKey="date"
                tick={{ fill: c.muted, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: c.axis }}
                tickFormatter={(d: string) => d.slice(5)}
                minTickGap={16}
              />
              <YAxis allowDecimals={false} tick={{ fill: c.muted, fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: dark ? "rgba(255,255,255,0.05)" : "rgba(11,11,11,0.04)" }}
                contentStyle={{ background: c.surface, border: `1px solid ${c.axis}`, borderRadius: 8, fontSize: 12, color: c.ink }}
                labelStyle={{ color: c.ink, fontWeight: 600 }}
                itemStyle={{ color: c.ink2 }}
                labelFormatter={(d) => (bucket === "week" ? `Week of ${d}` : String(d))}
              />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: c.ink2 }} />
              {series.map((s, i) => (
                <Bar
                  key={s.id}
                  dataKey={key(s.id)}
                  name={s.name}
                  stackId="a"
                  fill={seriesColor(s.color, dark)}
                  stroke={c.surface}
                  strokeWidth={2}
                  radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
                  maxBarSize={36}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
