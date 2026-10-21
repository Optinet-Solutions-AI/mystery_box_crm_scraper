"use client";

import Link from "next/link";
import { useState } from "react";
import { CATEGORY_GROUPS } from "@/lib/constants";
import { chartChrome, useIsDark } from "./theme";

export type TimelineMark = {
  emailId: string;
  hours: number;
  at: string;
  subject: string | null;
  groupKey: string;
  groupLabel: string;
  color: string;
  categoryLabels: string[];
  offerText: string | null;
};

export type TimelineRecorded = { hours: number; at: string; type: string; note?: string };

export type TimelineLane = {
  id: string;
  title: string;
  subtitle: string;
  marks: TimelineMark[];
  recorded: TimelineRecorded[];
};

type Hover =
  | { kind: "email"; x: number; y: number; mark: TimelineMark }
  | { kind: "recorded"; x: number; y: number; rec: TimelineRecorded }
  | null;

const LANE_H = 44;
const LABEL_W = 170;
const PAD_R = 16;
const TOP = 22;
const WIDTH = 960;

function fmtOffset(h: number) {
  if (h < 1) return `${Math.max(0, Math.round(h * 60))} min after signup`;
  if (h < 24) return `${Math.round(h)}h after signup`;
  return `Day ${Math.floor(h / 24)} (${Math.round(h)}h after signup)`;
}

/**
 * Aligned journey timelines: one lane per test account, x = time since signup.
 * Marks are colored by category group; recorded actions are ink diamonds.
 */
export function LifecycleTimeline({ lanes, horizonDays }: { lanes: TimelineLane[]; horizonDays: number }) {
  const dark = useIsDark();
  const c = chartChrome(dark);
  const [hover, setHover] = useState<Hover>(null);
  const plotW = WIDTH - LABEL_W - PAD_R;
  const maxH = horizonDays * 24;
  const x = (h: number) => LABEL_W + (Math.min(Math.max(h, 0), maxH) / maxH) * plotW;
  const height = TOP + lanes.length * LANE_H + 26;
  const ticks = [0, 1, 2, 3, 7, 14, 21, 30, 45, 60, 90].filter((d) => d <= horizonDays);
  const usedGroups = new Set(lanes.flatMap((l) => l.marks.map((m) => m.groupKey)));

  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        {CATEGORY_GROUPS.filter((g) => usedGroups.has(g.key)).map((g) => (
          <span key={g.key} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
            {g.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden>
            <rect x="2" y="2" width="6" height="6" transform="rotate(45 5 5)" fill={c.ink} />
          </svg>
          Recorded action (manual)
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="relative min-w-[720px]">
        <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full" role="img" aria-label="Aligned CRM journey timelines">
          {ticks.map((d) => (
            <g key={d}>
              <line x1={x(d * 24)} x2={x(d * 24)} y1={TOP - 6} y2={TOP + lanes.length * LANE_H} stroke={c.grid} strokeWidth={1} />
              <text x={x(d * 24)} y={TOP + lanes.length * LANE_H + 16} textAnchor="middle" fontSize={11} fill={c.muted}>
                {d === 0 ? "Signup" : `Day ${d}`}
              </text>
            </g>
          ))}
          {lanes.map((lane, i) => {
            const cy = TOP + i * LANE_H + LANE_H / 2;
            return (
              <g key={lane.id}>
                <line x1={LABEL_W} x2={WIDTH - PAD_R} y1={cy} y2={cy} stroke={c.axis} strokeWidth={1} />
                <text x={0} y={cy - 3} fontSize={12} fontWeight={600} fill={c.ink}>
                  {lane.title.length > 24 ? lane.title.slice(0, 23) + "…" : lane.title}
                </text>
                <text x={0} y={cy + 12} fontSize={11} fill={c.muted}>
                  {lane.subtitle.length > 28 ? lane.subtitle.slice(0, 27) + "…" : lane.subtitle}
                </text>
                {lane.recorded
                  .filter((r) => r.hours >= 0 && r.hours <= maxH)
                  .map((r, j) => (
                    <g
                      key={`r${j}`}
                      onMouseEnter={() => setHover({ kind: "recorded", x: x(r.hours), y: cy - 12, rec: r })}
                      onMouseLeave={() => setHover(null)}
                    >
                      <rect x={x(r.hours) - 4} y={cy - 18} width={8} height={8} transform={`rotate(45 ${x(r.hours)} ${cy - 14})`} fill={c.ink} stroke={c.surface} strokeWidth={2} />
                      <rect x={x(r.hours) - 10} y={cy - 24} width={20} height={20} fill="transparent" />
                    </g>
                  ))}
                {lane.marks
                  .filter((m) => m.hours >= 0 && m.hours <= maxH)
                  .map((m) => (
                    <Link key={m.emailId} href={`/emails/${m.emailId}`}>
                      <g onMouseEnter={() => setHover({ kind: "email", x: x(m.hours), y: cy, mark: m })} onMouseLeave={() => setHover(null)} className="cursor-pointer">
                        <circle cx={x(m.hours)} cy={cy} r={11} fill="transparent" />
                        <circle cx={x(m.hours)} cy={cy} r={5} fill={m.color} stroke={c.surface} strokeWidth={2} />
                      </g>
                    </Link>
                  ))}
              </g>
            );
          })}
        </svg>
        {hover && (
          <div
            className="pointer-events-none absolute z-10 w-64 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
            style={{
              left: `${(hover.x / WIDTH) * 100}%`,
              top: `${(hover.y / height) * 100}%`,
              transform: `translate(${hover.x > WIDTH * 0.7 ? "calc(-100% - 12px)" : "12px"}, ${hover.y > height / 2 ? "calc(-100% - 8px)" : "8px"})`,
            }}
          >
            {hover.kind === "email" ? (
            <>
              <div className="font-medium text-ink">{hover.mark.subject ?? "(no subject)"}</div>
              <div className="mt-0.5 text-ink-2">{fmtOffset(hover.mark.hours)}</div>
              <div className="mt-1 text-ink-2">{hover.mark.categoryLabels.join(", ") || hover.mark.groupLabel}</div>
              {hover.mark.offerText && <div className="mt-1 text-ink">Offer: {hover.mark.offerText}</div>}
              <div className="mt-1 text-muted">Click to open the email</div>
            </>
          ) : (
            <>
              <div className="font-medium text-ink">Recorded: {hover.rec.type}</div>
              <div className="mt-0.5 text-ink-2">{fmtOffset(hover.rec.hours)}</div>
              {hover.rec.note && <div className="mt-1 text-ink-2">{hover.rec.note}</div>}
            </>
          )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

/** Small single-series bars: emails per week since signup (no legend needed; the row names it). */
export function LifecycleWeeklyBars({ counts }: { counts: number[] }) {
  const dark = useIsDark();
  const c = chartChrome(dark);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...counts);
  const bw = 14;
  const gap = 2;
  const h = 32;
  const shown = counts.slice(0, 26);
  return (
    <div className="relative inline-flex items-end gap-2">
      <svg width={shown.length * (bw + gap)} height={h} role="img" aria-label="Emails per week since signup">
        <line x1={0} x2={shown.length * (bw + gap)} y1={h - 0.5} y2={h - 0.5} stroke={c.axis} />
        {shown.map((v, i) => {
          const bh = v === 0 ? 0 : Math.max(3, (v / max) * (h - 4));
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={i * (bw + gap)} y={0} width={bw} height={h} fill="transparent" />
              {bh > 0 && <rect x={i * (bw + gap)} y={h - bh} width={bw} height={bh} rx={2} fill={dark ? "#3987e5" : "#2a78d6"} opacity={hover === null || hover === i ? 1 : 0.5} />}
            </g>
          );
        })}
      </svg>
      <span className="text-xs text-muted tabular">
        {hover !== null ? `Week ${hover + 1}: ${shown[hover]} email${shown[hover] === 1 ? "" : "s"}` : `peak ${max}/wk`}
      </span>
    </div>
  );
}
