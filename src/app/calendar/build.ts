import "server-only";
import { differenceInCalendarDays, format, startOfDay } from "date-fns";
import { categoryGroup, label } from "@/lib/constants";
import { brandColor, type Dataset } from "@/lib/data";
import type { Brand, Campaign, Offer } from "@/lib/types";

export type CalEvent = {
  key: string;
  campaignId: string;
  brand: Pick<Brand, "id" | "name" | "logo_url">;
  color: string;
  title: string;
  offerType: string | null;
  value: string | null;
  emailDate: string | null; // first email date of the campaign (or that day's send)
  emailsThatDay: number;
  start: Date; // event range shown on the calendar
  end: Date;
  startStated: boolean;
  endStated: boolean;
  expiry: string | null;
  status: "active" | "ended" | "unknown";
  confidence: number | null;
  inferred: boolean;
  categoryGroup: string;
};

export type CalendarOptions = { mode: "email" | "promo"; group: string | null; offerType: string | null; windowStart: Date; windowEnd: Date; now: Date };

function statusOf(c: Campaign, now: Date): CalEvent["status"] {
  if (!c.offer_ends_at) return "unknown";
  return new Date(c.offer_ends_at) >= now ? "active" : "ended";
}

function campaignOffers(ds: Dataset, c: Campaign): Offer[] {
  const emailIds = new Set(ds.promoEmails.filter((e) => e.campaign_id === c.id).map((e) => e.id));
  return ds.offers
    .filter((o) => o.campaign_id === c.id || emailIds.has(o.email_id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function passes(ds: Dataset, c: Campaign, opts: CalendarOptions) {
  if (opts.group && categoryGroup(c.primary_category).key !== opts.group) return false;
  if (opts.offerType && c.offer_type !== opts.offerType && !campaignOffers(ds, c).some((o) => o.offer_type === opts.offerType)) return false;
  return true;
}

export function buildEvents(ds: Dataset, opts: CalendarOptions): CalEvent[] {
  const brandIdx = new Map(ds.brands.map((b, i) => [b.id, i]));
  const brandOf = new Map(ds.brands.map((b) => [b.id, b]));
  const events: CalEvent[] = [];

  for (const c of ds.campaigns) {
    const brand = brandOf.get(c.brand_id);
    if (!brand || !passes(ds, c, opts)) continue;
    const offers = campaignOffers(ds, c);
    const lead = offers[0];
    const base = {
      campaignId: c.id,
      brand: { id: brand.id, name: brand.name, logo_url: brand.logo_url },
      color: brandColor(brand, brandIdx.get(brand.id) ?? 0),
      title: c.title,
      offerType: c.offer_type ?? lead?.offer_type ?? null,
      value: lead?.incentive_text ?? lead?.headline ?? null,
      expiry: c.offer_ends_at,
      status: statusOf(c, opts.now),
      confidence: c.confidence,
      inferred: !c.confirmed_by_user,
      categoryGroup: categoryGroup(c.primary_category).key,
    };

    if (opts.mode === "email") {
      const perDay = new Map<string, number>();
      for (const e of ds.promoEmails) {
        if (e.campaign_id !== c.id || !e.sent_at) continue;
        const d = format(new Date(e.sent_at), "yyyy-MM-dd");
        perDay.set(d, (perDay.get(d) ?? 0) + 1);
      }
      for (const [day, n] of perDay) {
        const d = startOfDay(new Date(`${day}T00:00:00`));
        if (d < startOfDay(opts.windowStart) || d > opts.windowEnd) continue;
        events.push({ ...base, key: `${c.id}:${day}`, emailDate: day, emailsThatDay: n, start: d, end: d, startStated: true, endStated: true });
      }
    } else {
      // Only promotions with at least one advertised (stated) date.
      const starts = offers.map((o) => o.starts_at).filter((x): x is string => !!x).sort();
      const ends = offers.map((o) => o.ends_at).filter((x): x is string => !!x).sort();
      if (!starts.length && !ends.length) continue;
      const startStated = starts.length > 0;
      const endStated = ends.length > 0;
      const start = startOfDay(new Date(starts[0] ?? c.first_seen_at ?? ends[0]));
      const end = startOfDay(new Date(ends.at(-1) ?? starts.at(-1) ?? start));
      if (end < startOfDay(opts.windowStart) || start > opts.windowEnd) continue;
      events.push({
        ...base,
        key: `${c.id}:promo`,
        emailDate: c.first_seen_at,
        emailsThatDay: 0,
        start,
        end: end < start ? start : end,
        startStated,
        endStated,
      });
    }
  }
  return events.sort((a, b) => a.start.getTime() - b.start.getTime() || a.brand.name.localeCompare(b.brand.name));
}

export function eventsOnDay(events: CalEvent[], day: Date) {
  const d = startOfDay(day).getTime();
  return events.filter((e) => e.start.getTime() <= d && e.end.getTime() >= d);
}

// ─── Additional intelligence ───────────────────────────────────────────

export type IntelItem = { text: string; links: { label: string; href: string }[] };

export function buildIntel(ds: Dataset, windowStart: Date, windowEnd: Date, now: Date) {
  const brandName = (id: string) => ds.brands.find((b) => b.id === id)?.name ?? "?";
  const inWindow = ds.campaigns.filter(
    (c) => c.last_seen_at && c.first_seen_at && new Date(c.last_seen_at) >= windowStart && new Date(c.first_seen_at) <= windowEnd,
  );

  // Competitors promoting the same event.
  const byEvent = new Map<string, Campaign[]>();
  for (const c of inWindow) {
    if (!c.seasonal_event) continue;
    const k = c.seasonal_event.trim().toLowerCase();
    byEvent.set(k, [...(byEvent.get(k) ?? []), c]);
  }
  const sameEvent: IntelItem[] = [...byEvent.values()]
    .filter((cs) => new Set(cs.map((c) => c.brand_id)).size >= 2)
    .map((cs) => ({
      text: `${cs[0].seasonal_event}: ${[...new Set(cs.map((c) => brandName(c.brand_id)))].join(", ")}`,
      links: cs.slice(0, 4).map((c) => ({ label: `${brandName(c.brand_id)}: ${c.title}`, href: `/campaigns/${c.id}` })),
    }));

  // Repeated promotions.
  const repeats = new Map<string, number>();
  for (const e of ds.promoEmails) if (e.campaign_role === "repeat" && e.campaign_id) repeats.set(e.campaign_id, (repeats.get(e.campaign_id) ?? 0) + 1);
  const repeated: IntelItem[] = inWindow
    .filter((c) => repeats.has(c.id))
    .sort((a, b) => (repeats.get(b.id) ?? 0) - (repeats.get(a.id) ?? 0))
    .slice(0, 6)
    .map((c) => ({
      text: `${brandName(c.brand_id)} re-sent "${c.title}" ${repeats.get(c.id)} time${repeats.get(c.id)! > 1 ? "s" : ""} (${c.email_count} emails total)`,
      links: [{ label: "Campaign", href: `/campaigns/${c.id}` }],
    }));

  // Overlapping campaigns across brands, same campaign type.
  const rangeOf = (c: Campaign) => {
    const s = new Date(c.offer_starts_at ?? c.first_seen_at!).getTime();
    const ends = [c.last_seen_at, c.offer_ends_at].filter((x): x is string => !!x).map((x) => new Date(x).getTime());
    return [s, Math.max(s, ...ends)] as const;
  };
  const overlapping: IntelItem[] = [];
  const promoCampaigns = inWindow.filter((c) => categoryGroup(c.primary_category).key !== "transactional");
  for (let i = 0; i < promoCampaigns.length && overlapping.length < 8; i++) {
    for (let j = i + 1; j < promoCampaigns.length && overlapping.length < 8; j++) {
      const a = promoCampaigns[i];
      const b = promoCampaigns[j];
      if (a.brand_id === b.brand_id) continue;
      const sameType = (a.offer_type && a.offer_type === b.offer_type) || categoryGroup(a.primary_category).key === categoryGroup(b.primary_category).key;
      if (!sameType) continue;
      const [as, ae] = rangeOf(a);
      const [bs, be] = rangeOf(b);
      if (as <= be && bs <= ae) {
        overlapping.push({
          text: `${brandName(a.brand_id)} and ${brandName(b.brand_id)} ran ${a.offer_type && a.offer_type === b.offer_type ? label(a.offer_type) : categoryGroup(a.primary_category).label.toLowerCase()} campaigns at the same time (${format(new Date(Math.max(as, bs)), "MMM d")} – ${format(new Date(Math.min(ae, be)), "MMM d")})`,
          links: [
            { label: a.title, href: `/campaigns/${a.id}` },
            { label: b.title, href: `/campaigns/${b.id}` },
          ],
        });
      }
    }
  }

  // Gaps in observed promotional activity (7+ days).
  const gapEnd = new Date(Math.min(now.getTime(), windowEnd.getTime()));
  const gaps: IntelItem[] = [];
  if (gapEnd > windowStart) {
    for (const b of ds.brands) {
      const times = ds.promoEmails
        .filter((e) => e.brand_id === b.id && e.sent_at && new Date(e.sent_at) >= windowStart && new Date(e.sent_at) <= gapEnd)
        .map((e) => new Date(e.sent_at!).getTime())
        .sort((x, y) => x - y);
      const points = [windowStart.getTime(), ...times, gapEnd.getTime()];
      for (let i = 1; i < points.length; i++) {
        const days = differenceInCalendarDays(points[i], points[i - 1]);
        if (days >= 7) {
          gaps.push({
            text: `${b.name}: no promotional emails ${format(points[i - 1], "MMM d")} – ${format(points[i], "MMM d")} (${days} days)${times.length === 0 ? " — none in this window" : ""}`,
            links: [{ label: "Brand", href: `/brands/${b.id}` }],
          });
        }
      }
    }
  }

  return { sameEvent, repeated, overlapping, gaps };
}
