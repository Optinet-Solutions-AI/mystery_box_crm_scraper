import "server-only";
import { categoryGroup, label } from "./constants";
import { categoriesOf, EMAIL_LIGHT_COLUMNS, fetchAll, type EmailLight } from "./data";
import { supabaseAdmin, must } from "./supabase";
import type { Brand, EmailAnalysis, Offer, RecordedEvent, TestAccount } from "./types";

const HOUR = 3_600_000;

export type JourneyOffer = Pick<Offer, "id" | "offer_type" | "headline" | "incentive_text" | "promo_code" | "ends_at">;

export type JourneyEvent = {
  emailId: string;
  at: string;
  hours: number; // hours since signup (negative = before signup)
  day: number; // 0-based day since signup
  subject: string | null;
  summary: string | null;
  isPromotional: boolean;
  emailType: string | null;
  categories: string[];
  primaryCategory: string | null;
  group: { key: string; label: string; color: string };
  offers: JourneyOffer[];
  campaignId: string | null;
};

export type RecordedMarker = RecordedEvent & { hours: number | null; day: number | null };

export type Stage = "day0" | "d1_7" | "d8_30" | "d30plus";
export const STAGE_LABELS: Record<Stage, string> = {
  day0: "Day 0 (first 24h)",
  d1_7: "Days 1–7",
  d8_30: "Days 8–30",
  d30plus: "Day 30+",
};

export type AccountLifecycle = {
  account: TestAccount;
  brand: Brand;
  registeredAt: string | null;
  events: JourneyEvent[]; // after signup, chronological
  preSignupCount: number; // emails received before the recorded signup time
  recorded: RecordedMarker[];
  firstEmail: JourneyEvent | null;
  hoursToFirstEmail: number | null;
  hoursToWelcome: number | null;
  first24h: number;
  days1to7: number; // first 7 days, including the first 24h
  days8to30: number;
  after30: number;
  firstOffer: { event: JourneyEvent; offer: JourneyOffer } | null;
  avgGapHours: number | null;
  loyaltyCount: number;
  reactivationCount: number;
  transactionalCount: number;
  stageIncentives: Record<Stage, Record<string, number>>;
  weeklyFrequency: number[]; // promo + lifecycle emails per week since signup
  sequenceSummary: string;
};

function stageOf(hours: number): Stage {
  if (hours < 24) return "day0";
  if (hours < 7 * 24) return "d1_7";
  if (hours < 30 * 24) return "d8_30";
  return "d30plus";
}

export function fmtOffset(hours: number): string {
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `day ${Math.floor(hours / 24)}`;
}

/** Plain-language description of one journey step, e.g. "cashback on day 7". */
function describe(e: JourneyEvent): string {
  const offer = e.offers[0];
  const what = offer ? (offer.incentive_text ? `${label(offer.offer_type)} (${offer.incentive_text})` : label(offer.offer_type)) : label(e.primaryCategory);
  const when = fmtOffset(e.hours);
  return `${what.toLowerCase()} ${e.hours < 24 ? "at" : "on"} ${when}`;
}

/** "welcome at 0h, bonus on day 2, cashback on day 7" - consecutive repeats collapsed. */
export function buildSequenceSummary(events: JourneyEvent[], horizonDays = 30, maxSteps = 8): string {
  const steps: string[] = [];
  let lastKey = "";
  for (const e of events) {
    if (e.hours > horizonDays * 24) break;
    if (!e.isPromotional && e.primaryCategory !== "welcome_onboarding") continue;
    const key = `${e.offers[0]?.offer_type ?? e.primaryCategory}`;
    if (key === lastKey) continue;
    lastKey = key;
    steps.push(describe(e));
    if (steps.length >= maxSteps) break;
  }
  return steps.length ? steps.join(", ") : "No promotional or welcome emails observed in this window.";
}

type LoadOpts = { accountIds?: string[]; brandIds?: string[] };

/** Builds the observed lifecycle for test accounts (all accounts if no filter). */
export async function loadLifecycles(opts: LoadOpts = {}): Promise<AccountLifecycle[]> {
  const sb = supabaseAdmin();
  let aq = sb.from("test_accounts").select("*").order("created_at");
  if (opts.accountIds?.length) aq = aq.in("id", opts.accountIds);
  if (opts.brandIds?.length) aq = aq.in("brand_id", opts.brandIds);
  const accounts = must(await aq, "load test accounts") as TestAccount[];
  if (accounts.length === 0) return [];

  const brandIds = [...new Set(accounts.map((a) => a.brand_id))];
  const brands = must(await sb.from("brands").select("*").in("id", brandIds), "load brands") as Brand[];
  const brandById = new Map(brands.map((b) => [b.id, b]));

  const out: AccountLifecycle[] = [];
  for (const account of accounts) {
    const brand = brandById.get(account.brand_id);
    if (!brand) continue;

    // Emails assigned to the account, plus unassigned brand emails sent to its address.
    const assigned = await fetchAll<EmailLight>((a, b) =>
      sb
        .from("emails")
        .select(EMAIL_LIGHT_COLUMNS)
        .eq("test_account_id", account.id)
        .order("sent_at", { ascending: true })
        .range(a, b) as unknown as PromiseLike<{ data: EmailLight[] | null; error: { message: string } | null }>,
    );
    const unassigned = (must(
      await sb
        .from("emails")
        .select(EMAIL_LIGHT_COLUMNS)
        .eq("brand_id", account.brand_id)
        .is("test_account_id", null)
        .eq("to_email", account.email.toLowerCase())
        .limit(1000),
      "load unassigned emails",
    ) ?? []) as unknown as EmailLight[];
    const emails = [...assigned, ...unassigned].sort(
      (x, y) => new Date(x.sent_at ?? x.received_at ?? 0).getTime() - new Date(y.sent_at ?? y.received_at ?? 0).getTime(),
    );

    const ids = emails.map((e) => e.id);
    const analyses: EmailAnalysis[] = [];
    const offers: Offer[] = [];
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300);
      const [a, o] = await Promise.all([
        sb.from("email_analyses").select("*").in("email_id", chunk),
        sb.from("offers").select("id, email_id, offer_type, headline, incentive_text, promo_code, ends_at").in("email_id", chunk),
      ]);
      analyses.push(...((must(a) ?? []) as EmailAnalysis[]));
      offers.push(...((must(o) ?? []) as Offer[]));
    }
    const analysisBy = new Map(analyses.map((a) => [a.email_id, a]));
    const offersBy = new Map<string, JourneyOffer[]>();
    for (const o of offers) offersBy.set(o.email_id, [...(offersBy.get(o.email_id) ?? []), o]);

    const reg = account.registered_at ? new Date(account.registered_at).getTime() : null;
    const all: JourneyEvent[] = emails.map((e) => {
      const at = e.sent_at ?? e.received_at ?? e.created_at;
      const hours = reg ? (new Date(at).getTime() - reg) / HOUR : 0;
      const a = analysisBy.get(e.id) ?? null;
      const cats = categoriesOf(a);
      const primary = a?.manual_categories?.[0] ?? a?.primary_category ?? (e.is_promotional === false ? "transactional" : null);
      const g = categoryGroup(primary);
      return {
        emailId: e.id,
        at,
        hours,
        day: Math.floor(hours / 24),
        subject: e.subject,
        summary: a?.summary ?? null,
        isPromotional: !!e.is_promotional,
        emailType: e.email_type,
        categories: cats,
        primaryCategory: primary,
        group: { key: g.key, label: g.label, color: g.color },
        offers: offersBy.get(e.id) ?? [],
        campaignId: e.campaign_id,
      };
    });

    const events = reg ? all.filter((e) => e.hours >= -0.25) : all; // small clock-skew tolerance
    const preSignupCount = all.length - events.length;
    const firstEmail = events[0] ?? null;
    const welcome = events.find((e) => e.categories.includes("welcome_onboarding"));
    const promoEvents = events.filter((e) => e.isPromotional);
    const gaps = promoEvents.slice(1).map((e, i) => e.hours - promoEvents[i].hours);
    const firstOfferEvent = events.find((e) => e.offers.length > 0);

    const stageIncentives: Record<Stage, Record<string, number>> = { day0: {}, d1_7: {}, d8_30: {}, d30plus: {} };
    for (const e of events) {
      const s = stageOf(e.hours);
      for (const o of e.offers) {
        const k = o.offer_type ?? "other";
        stageIncentives[s][k] = (stageIncentives[s][k] ?? 0) + 1;
      }
    }

    const lastHours = events.length ? Math.max(...events.map((e) => e.hours), 0) : 0;
    const weeks = reg ? Math.max(1, Math.ceil(Math.max(lastHours, (Date.now() - reg) / HOUR) / (7 * 24))) : 1;
    const weeklyFrequency = new Array(Math.min(weeks, 52)).fill(0);
    for (const e of events) {
      const w = Math.floor(e.hours / (7 * 24));
      if (w >= 0 && w < weeklyFrequency.length && e.emailType !== "auth_code") weeklyFrequency[w]++;
    }

    const recorded: RecordedMarker[] = (account.recorded_events ?? [])
      .map((r) => {
        const hours = reg ? (new Date(r.at).getTime() - reg) / HOUR : null;
        return { ...r, hours, day: hours == null ? null : Math.floor(hours / 24) };
      })
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    out.push({
      account,
      brand,
      registeredAt: account.registered_at,
      events,
      preSignupCount,
      recorded,
      firstEmail,
      hoursToFirstEmail: reg && firstEmail ? firstEmail.hours : null,
      hoursToWelcome: reg && welcome ? welcome.hours : null,
      first24h: events.filter((e) => e.hours < 24).length,
      days1to7: events.filter((e) => e.hours < 7 * 24).length,
      days8to30: events.filter((e) => e.hours >= 7 * 24 && e.hours < 30 * 24).length,
      after30: events.filter((e) => e.hours >= 30 * 24).length,
      firstOffer: firstOfferEvent ? { event: firstOfferEvent, offer: firstOfferEvent.offers[0] } : null,
      avgGapHours: gaps.length ? Math.round((gaps.reduce((s, g) => s + g, 0) / gaps.length) * 10) / 10 : null,
      loyaltyCount: events.filter((e) => e.categories.includes("loyalty_vip")).length,
      reactivationCount: events.filter((e) => e.categories.includes("reactivation")).length,
      transactionalCount: events.filter((e) => !e.isPromotional).length,
      stageIncentives,
      weeklyFrequency,
      sequenceSummary: reg ? buildSequenceSummary(events) : "Registration time not set.",
    });
  }
  return out;
}

/** Compact, id-carrying view of a lifecycle for the AI analyst. */
export function lifecycleForAI(l: AccountLifecycle, horizonDays = 30) {
  return {
    account_id: l.account.id,
    brand_id: l.brand.id,
    brand: l.brand.name,
    persona: l.account.persona,
    registered_at: l.registeredAt,
    note: "Observed behavior for this one test account; not a guaranteed sequence for all customers.",
    hours_to_first_email: l.hoursToFirstEmail,
    hours_to_welcome_email: l.hoursToWelcome,
    emails_first_24h: l.first24h,
    emails_days_1_7: l.days1to7,
    emails_days_8_30: l.days8to30,
    first_offer: l.firstOffer
      ? { day: l.firstOffer.event.day, email_id: l.firstOffer.event.emailId, offer_type: l.firstOffer.offer.offer_type, text: l.firstOffer.offer.incentive_text ?? l.firstOffer.offer.headline }
      : null,
    avg_gap_hours_between_promos: l.avgGapHours,
    loyalty_vip_emails: l.loyaltyCount,
    reactivation_emails: l.reactivationCount,
    stage_incentives: l.stageIncentives,
    weekly_frequency: l.weeklyFrequency,
    sequence_summary: l.sequenceSummary,
    recorded_actions: l.recorded.map((r) => ({ type: r.type, at: r.at, day: r.day, note: r.note ?? null })),
    events: l.events
      .filter((e) => e.hours <= horizonDays * 24)
      .slice(0, 60)
      .map((e) => ({
        email_id: e.emailId,
        day: e.day,
        hours: Math.round(e.hours * 10) / 10,
        subject: e.subject,
        type: e.emailType,
        categories: e.categories,
        offers: e.offers.map((o) => o.incentive_text ?? o.headline),
        campaign_id: e.campaignId,
      })),
  };
}
