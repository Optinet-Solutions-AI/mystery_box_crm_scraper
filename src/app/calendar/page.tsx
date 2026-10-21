import Link from "next/link";
import { Suspense } from "react";
import clsx from "clsx";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { Filters } from "@/components/filters";
import { CalendarBrandMark } from "@/components/charts/calendar-dot";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { CATEGORY_GROUPS, label, OFFER_TYPES } from "@/lib/constants";
import { loadDataset, parseFilters, type SearchParams } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { db, must } from "@/lib/supabase";
import type { Offer } from "@/lib/types";
import { buildEvents, buildIntel, eventsOnDay, type CalEvent, type IntelItem } from "./build";
import { CalendarControls } from "./controls";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const WEEK = { weekStartsOn: 1 as const };

function StatusBadge({ e }: { e: CalEvent }) {
  if (e.status === "active") return <Badge tone="good">● Active</Badge>;
  if (e.status === "ended") return <Badge>○ Ended</Badge>;
  return <Badge>? Expiry not stated</Badge>;
}

function eventTitle(e: CalEvent) {
  return [
    `${e.brand.name}: ${e.title}`,
    e.offerType && `Offer type: ${label(e.offerType)}`,
    e.value && `Value: ${e.value}`,
    e.emailDate && `First email: ${fmtDate(e.emailDate)}`,
    `Expiry: ${e.expiry ? fmtDate(e.expiry) : "not stated"}`,
    `Status: ${e.status}`,
    e.confidence != null && `Grouping confidence: ${Math.round(Number(e.confidence) * 100)}%`,
    e.inferred && "Inferred campaign (not confirmed)",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Compact chip for month view. */
function Chip({ e, mode }: { e: CalEvent; mode: "email" | "promo" }) {
  return (
    <Link
      href={`/campaigns/${e.campaignId}`}
      title={eventTitle(e)}
      className="flex min-w-0 items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] leading-4 text-ink hover:bg-surface-2"
    >
      <CalendarBrandMark color={e.color} logo={e.brand.logo_url} size={8} />
      <span className="truncate">{e.title}</span>
      {mode === "email" && e.emailsThatDay > 1 && <span className="shrink-0 text-muted">×{e.emailsThatDay}</span>}
    </Link>
  );
}

/** Full event card for week / day views. */
function EventCard({ e, mode }: { e: CalEvent; mode: "email" | "promo" }) {
  return (
    <Link href={`/campaigns/${e.campaignId}`} className="block rounded-lg border border-line bg-surface p-2.5 hover:bg-surface-2">
      <div className="flex items-center gap-1.5 text-xs text-ink-2">
        <CalendarBrandMark color={e.color} logo={e.brand.logo_url} />
        <span className="font-medium text-ink">{e.brand.name}</span>
      </div>
      <div className="mt-1 text-sm font-medium text-ink">{e.title}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {e.offerType && <Badge>{label(e.offerType)}</Badge>}
        {e.value && <Badge tone="accent">{e.value}</Badge>}
        <StatusBadge e={e} />
        {e.inferred && <Badge title="Grouped automatically from similar emails; not an officially confirmed promotion">Inferred</Badge>}
      </div>
      <div className="mt-1.5 space-y-0.5 text-xs text-ink-2">
        {mode === "email" ? (
          <div>
            Email sent {fmtDate(e.emailDate)}
            {e.emailsThatDay > 1 ? ` (${e.emailsThatDay} emails)` : ""}
          </div>
        ) : (
          <div>
            Advertised {e.startStated ? fmtDate(e.start) : `from first email ${fmtDate(e.start)} (start not stated)`} →{" "}
            {e.endStated ? fmtDate(e.end) : "end not stated"}
          </div>
        )}
        <div>Expiry: {e.expiry ? fmtDate(e.expiry) : <span className="text-muted">Not stated</span>}</div>
        {e.confidence != null && <div>Grouping confidence {Math.round(Number(e.confidence) * 100)}%</div>}
      </div>
    </Link>
  );
}

function IntelList({ title, items, empty }: { title: string; items: IntelItem[]; empty: string }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-ink-2 uppercase">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={i} className="text-sm text-ink">
              {it.text}
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                {it.links.map((l) => (
                  <Link key={l.href + l.label} href={l.href} className="text-accent hover:underline">
                    {l.label.length > 50 ? `${l.label.slice(0, 50)}…` : l.label} →
                  </Link>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const sb = await db();
  const now = new Date();

  const view = (one(sp.view) ?? "month") as "month" | "week" | "day";
  const mode = one(sp.dates) === "promo" ? "promo" : "email";
  const group = one(sp.group);
  const offerType = one(sp.offer);
  const dateParam = one(sp.date);
  const anchor = dateParam && !Number.isNaN(new Date(`${dateParam}T00:00:00`).getTime()) ? new Date(`${dateParam}T00:00:00`) : startOfDay(now);

  let windowStart: Date, windowEnd: Date, prevDate: Date, nextDate: Date, title: string;
  if (view === "week") {
    windowStart = startOfWeek(anchor, WEEK);
    windowEnd = endOfWeek(anchor, WEEK);
    prevDate = subWeeks(anchor, 1);
    nextDate = addWeeks(anchor, 1);
    title = `${format(windowStart, "MMM d")} – ${format(windowEnd, "MMM d, yyyy")}`;
  } else if (view === "day") {
    windowStart = startOfDay(anchor);
    windowEnd = endOfDay(anchor);
    prevDate = subDays(anchor, 1);
    nextDate = addDays(anchor, 1);
    title = format(anchor, "EEEE, MMM d, yyyy");
  } else {
    windowStart = startOfWeek(startOfMonth(anchor), WEEK);
    windowEnd = endOfWeek(endOfMonth(anchor), WEEK);
    prevDate = subMonths(anchor, 1);
    nextDate = addMonths(anchor, 1);
    title = format(anchor, "MMMM yyyy");
  }

  // Promotions advertised in this window may come from emails sent earlier.
  const dataFrom = mode === "promo" ? subDays(windowStart, 60) : windowStart;
  const base = parseFilters(sp);
  const ds = await loadDataset({ ...base, from: dataFrom, to: windowEnd });

  const events = buildEvents(ds, { mode, group, offerType, windowStart, windowEnd, now });
  const intel = buildIntel(ds, windowStart, windowEnd, now);

  // Upcoming expiries are always "from now", regardless of the window shown.
  const brandIds = ds.brands.map((b) => b.id);
  const expiring = brandIds.length
    ? (must(
        await sb
          .from("offers")
          .select("id, email_id, brand_id, campaign_id, headline, incentive_text, ends_at, ends_text")
          .in("brand_id", brandIds)
          .gte("ends_at", now.toISOString())
          .lte("ends_at", addDays(now, 7).toISOString())
          .order("ends_at", { ascending: true })
          .limit(20),
      ) as Pick<Offer, "id" | "email_id" | "brand_id" | "campaign_id" | "headline" | "incentive_text" | "ends_at" | "ends_text">[])
    : [];
  const brandName = (id: string | null) => ds.brands.find((b) => b.id === id)?.name ?? "?";
  const expiryItems: IntelItem[] = expiring.map((o) => ({
    text: `${brandName(o.brand_id)}: ${o.incentive_text ?? o.headline ?? "Offer"} — ends ${fmtDate(o.ends_at, "EEE MMM d, HH:mm")}${o.ends_text ? ` ("${o.ends_text}")` : ""}`,
    links: [
      { label: "Email", href: `/emails/${o.email_id}` },
      ...(o.campaign_id ? [{ label: "Campaign", href: `/campaigns/${o.campaign_id}` }] : []),
    ],
  }));

  const days = eachDayOfInterval({ start: windowStart, end: startOfDay(windowEnd) });
  const fmtParam = (d: Date) => format(d, "yyyy-MM-dd");
  const dayHref = (d: Date) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string") p.set(k, v);
    p.set("view", "day");
    p.set("date", fmtParam(d));
    return `/calendar?${p.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <PageHeader
          title="Marketing calendar"
          description="Competitor campaigns by the day emails were sent, or by the promotion dates the emails advertise. Filter by brand for a competitor-specific view, or by industry for an industry-wide one."
        />
        <Filters show={["brands", "industry", "country", "account"]} />
        <Suspense fallback={<div className="mb-4 h-9" />}>
          <CalendarControls
            title={title}
            prevDate={fmtParam(prevDate)}
            nextDate={fmtParam(nextDate)}
            groups={CATEGORY_GROUPS.map((g) => ({ value: g.key, label: g.label }))}
            offerTypes={OFFER_TYPES.map((t) => ({ value: t, label: label(t) }))}
          />
        </Suspense>
        {mode === "promo" && (
          <p className="-mt-2 mb-4 text-xs text-ink-2">
            Showing only promotions whose emails state a start or end date. Where only one side is stated, the other is marked &quot;not stated&quot;.
          </p>
        )}
      </div>

      {ds.brands.length === 0 ? (
        <EmptyState title="No brands to show">
          <Link href="/brands" className="text-accent hover:underline">
            Add a brand
          </Link>{" "}
          to start tracking campaigns.
        </EmptyState>
      ) : view === "month" ? (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <div className="grid min-w-[760px] grid-cols-7">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="border-b border-line px-2 py-1.5 text-xs font-medium text-ink-2">
                {d}
              </div>
            ))}
            {days.map((d) => {
              const evs = eventsOnDay(events, d);
              const outside = !isSameMonth(d, anchor);
              return (
                <div key={d.toISOString()} className={clsx("min-h-28 border-r border-b border-line p-1.5 [&:nth-child(7n)]:border-r-0", outside && "bg-surface-2/60")}>
                  <Link
                    href={dayHref(d)}
                    className={clsx(
                      "mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs hover:bg-surface-2",
                      isSameDay(d, now) ? "bg-accent font-semibold text-accent-ink hover:bg-accent" : outside ? "text-muted" : "text-ink-2",
                    )}
                  >
                    {format(d, "d")}
                  </Link>
                  <div className="space-y-1">
                    {evs.slice(0, 3).map((e) => (
                      <Chip key={e.key} e={e} mode={mode} />
                    ))}
                    {evs.length > 3 && (
                      <Link href={dayHref(d)} className="block px-1 text-[11px] text-accent hover:underline">
                        +{evs.length - 3} more
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : view === "week" ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
          {days.map((d) => {
            const evs = eventsOnDay(events, d);
            return (
              <div key={d.toISOString()} className="min-w-0">
                <Link href={dayHref(d)} className={clsx("mb-2 block text-sm font-medium hover:underline", isSameDay(d, now) ? "text-accent" : "text-ink")}>
                  {format(d, "EEE d")}
                </Link>
                <div className="space-y-2">
                  {evs.length === 0 ? <p className="text-xs text-muted">No campaigns</p> : evs.map((e) => <EventCard key={e.key} e={e} mode={mode} />)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div>
          {(() => {
            const evs = eventsOnDay(events, anchor);
            return evs.length === 0 ? (
              <EmptyState title="No campaigns on this day" />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {evs.map((e) => (
                  <EventCard key={e.key} e={e} mode={mode} />
                ))}
              </div>
            );
          })()}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
        <span className="font-medium text-ink">Brands:</span>
        {ds.brands.map((b) => {
          const e = events.find((x) => x.brand.id === b.id);
          return (
            <span key={b.id} className="inline-flex items-center gap-1.5">
              <CalendarBrandMark color={e?.color ?? b.color ?? "#898781"} logo={b.logo_url} size={8} />
              {b.name}
            </span>
          );
        })}
        <span className="ml-auto">
          {events.length} event{events.length === 1 ? "" : "s"} · campaigns are inferred from similar emails unless confirmed
        </span>
      </div>

      <Card title="Additional intelligence" subtitle={`For ${format(windowStart, "MMM d")} – ${format(windowEnd, "MMM d, yyyy")}. All observations come from research inboxes.`}>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          <IntelList title="Upcoming expiries (next 7 days)" items={expiryItems} empty="No stated expiries in the next 7 days." />
          <IntelList title="Same event, multiple competitors" items={intel.sameEvent} empty="No event promoted by more than one competitor." />
          <IntelList title="Overlapping campaigns" items={intel.overlapping} empty="No same-type campaigns overlapping across brands." />
          <IntelList title="Repeated promotions" items={intel.repeated} empty="No re-sent promotions in this window." />
          <IntelList title="Gaps in activity (7+ days)" items={intel.gaps.slice(0, 10)} empty="No gaps of 7+ days." />
        </div>
      </Card>
    </div>
  );
}
