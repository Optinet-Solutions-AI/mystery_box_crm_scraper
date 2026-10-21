"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { seriesColor, useIsDark } from "./theme";

export type TimelineEvent = {
  id: string;
  brandId: string;
  t: number; // epoch ms
  subject: string;
  isLaunch: boolean;
  campaignId: string | null;
  campaignTitle: string | null;
};

type Lane = { id: string; name: string; color: string };

const LABEL_W = 110;
const LANE_H = 34;

/**
 * One lane per brand. Small dots = promotional emails; larger ringed marks =
 * campaign launches. Hover for details; click to open the email or campaign.
 */
export function DashboardTimeline({ lanes, events, from, to }: { lanes: Lane[]; events: TimelineEvent[]; from: number; to: number }) {
  const dark = useIsDark();
  const [hover, setHover] = useState<{ e: TimelineEvent; x: number; y: number } | null>(null);
  const span = Math.max(1, to - from);

  const ticks = useMemo(() => {
    const n = 6;
    return Array.from({ length: n + 1 }, (_, i) => from + (span * i) / n);
  }, [from, span]);

  if (events.length === 0) return <p className="py-10 text-center text-sm text-muted">No promotional emails in this period.</p>;

  const pct = (t: number) => ((t - from) / span) * 100;

  return (
    <div className="relative" data-timeline>
      <div className="space-y-0">
        {lanes.map((lane) => {
          const laneEvents = events.filter((e) => e.brandId === lane.id);
          const color = seriesColor(lane.color, dark);
          return (
            <div key={lane.id} className="flex items-center border-b border-line last:border-b-0" style={{ height: LANE_H }}>
              <div className="flex shrink-0 items-center gap-1.5 truncate pr-2 text-xs text-ink-2" style={{ width: LABEL_W }}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                <span className="truncate">{lane.name}</span>
                <span className="text-muted tabular">{laneEvents.length}</span>
              </div>
              <div className="relative h-full flex-1">
                {laneEvents
                  .sort((a, b) => Number(a.isLaunch) - Number(b.isLaunch)) // launches on top
                  .map((e) => {
                    const size = e.isLaunch ? 14 : 8;
                    return (
                      <Link
                        key={e.id}
                        href={e.isLaunch && e.campaignId ? `/campaigns/${e.campaignId}` : `/emails/${e.id}`}
                        aria-label={`${lane.name}: ${e.subject}`}
                        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 p-1.5"
                        style={{ left: `${pct(e.t)}%` }}
                        onMouseEnter={(ev) => {
                          const r = (ev.currentTarget.closest("[data-timeline]") as HTMLElement).getBoundingClientRect();
                          const me = ev.currentTarget.getBoundingClientRect();
                          setHover({ e, x: me.left - r.left + me.width / 2, y: me.top - r.top });
                        }}
                        onMouseLeave={() => setHover(null)}
                      >
                        <span
                          className="block rounded-full"
                          style={{
                            width: size,
                            height: size,
                            background: color,
                            boxShadow: e.isLaunch ? `0 0 0 2px var(--surface), 0 0 0 3.5px ${color}` : `0 0 0 2px var(--surface)`,
                          }}
                        />
                      </Link>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex" style={{ paddingLeft: LABEL_W }}>
        <div className="relative h-4 flex-1 text-[11px] text-muted tabular">
          {ticks.map((t, i) => (
            <span
              key={i}
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${pct(t)}%`, transform: i === 0 ? "none" : i === ticks.length - 1 ? "translateX(-100%)" : undefined }}
            >
              {new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-ink-2" /> Promotional email
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-ink-2" style={{ boxShadow: "0 0 0 2px var(--surface), 0 0 0 3.5px var(--ink-2)" }} /> Campaign
          launch (inferred)
        </span>
      </div>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 w-64 -translate-x-1/2 -translate-y-full rounded-lg border border-axis bg-surface p-2.5 text-xs shadow-lg"
          style={{ left: hover.x, top: hover.y - 6 }}
        >
          <div className="font-semibold text-ink">{lanes.find((l) => l.id === hover.e.brandId)?.name}</div>
          <div className="text-muted">{new Date(hover.e.t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</div>
          <div className="mt-1 text-ink-2">{hover.e.subject}</div>
          {hover.e.isLaunch && hover.e.campaignTitle && <div className="mt-1 text-ink">Launch: {hover.e.campaignTitle}</div>}
        </div>
      )}
    </div>
  );
}
