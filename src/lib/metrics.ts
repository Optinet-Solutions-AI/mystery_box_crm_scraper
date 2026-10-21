import { LIFECYCLE_CATEGORIES } from "./constants";
import { categoriesOf, type Dataset, type EmailRow } from "./data";
import type { Brand, Campaign, Offer } from "./types";

const DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const count = <T,>(xs: T[], key: (x: T) => string | null | undefined) => {
  const m: Record<string, number> = {};
  for (const x of xs) {
    const k = key(x);
    if (k) m[k] = (m[k] ?? 0) + 1;
  }
  return m;
};
const countMany = <T,>(xs: T[], keys: (x: T) => string[]) => {
  const m: Record<string, number> = {};
  for (const x of xs) for (const k of new Set(keys(x))) m[k] = (m[k] ?? 0) + 1;
  return m;
};
export const topEntries = (m: Record<string, number>, n = 5) =>
  Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

export type BrandStats = {
  brand: Brand;
  periodDays: number;
  totalEmails: number; // incl. transactional
  promoEmails: number;
  transactionalEmails: number;
  emailsPerWeek: number;
  emailsPerMonth: number;
  activeSendingDays: number;
  uniqueCampaigns: number;
  repetitionRate: number; // promo emails per campaign
  categoryCounts: Record<string, number>;
  weekdayCounts: Record<string, number>;
  hourCounts: Record<string, number>; // UTC hour
  preferredDay: string | null;
  preferredHour: number | null;
  avgIntervalHours: number | null;
  offers: Offer[];
  offerTypeCounts: Record<string, number>;
  maxPercent: number | null;
  maxCurrencyAmount: { amount: number; currency: string | null } | null;
  minRequirements: string[];
  maxRewards: string[];
  conditions: string[];
  urgencyRate: number; // 0..1 of promo emails
  personalizationRate: number;
  emojiRate: number;
  offerRate: number; // share of promo emails carrying an offer
  creativeFormats: Record<string, number>;
  avgCtaCount: number | null;
  tones: Record<string, number>;
  subjectStyles: Record<string, number>;
  themes: string[];
  seasonalEvents: Record<string, number>;
  retentionCounts: Record<string, number>; // reactivation, loyalty, vip, cashback
  weeklyCounts: number[];
  lifecycleCoverage: string[];
  confidence: "low" | "medium" | "high";
};

function weeklyBuckets(emails: EmailRow[], from: Date, to: Date): number[] {
  const weeks = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (7 * DAY)));
  const out = new Array(weeks).fill(0);
  for (const e of emails) {
    if (!e.sent_at) continue;
    const idx = Math.floor((new Date(e.sent_at).getTime() - from.getTime()) / (7 * DAY));
    if (idx >= 0 && idx < weeks) out[idx]++;
  }
  return out;
}

export function computeBrandStats(ds: Dataset, brand: Brand): BrandStats {
  const { from, to } = ds.filters;
  const periodDays = Math.max(1, (to.getTime() - from.getTime()) / DAY);
  const all = ds.emails.filter((e) => e.brand_id === brand.id);
  const promo = all.filter((e) => e.is_promotional);
  const offers = ds.offers.filter((o) => o.brand_id === brand.id && promo.some((e) => e.id === o.email_id));
  const campaigns = new Set(promo.map((e) => e.campaign_id).filter(Boolean));
  const sentTimes = promo.map((e) => new Date(e.sent_at!).getTime()).sort((a, b) => a - b);
  const intervals = sentTimes.slice(1).map((t, i) => (t - sentTimes[i]) / 3_600_000);
  const weekdayCounts = count(promo, (e) => (e.sent_at ? WEEKDAYS[new Date(e.sent_at).getUTCDay()] : null));
  const hourCounts = count(promo, (e) => (e.sent_at ? String(new Date(e.sent_at).getUTCHours()) : null));
  const analyses = promo.map((e) => e.analysis).filter((a): a is NonNullable<typeof a> => !!a);
  const percentOffers = offers.filter((o) => o.incentive_unit === "percent" && o.incentive_value != null);
  const moneyOffers = offers.filter((o) => o.incentive_unit === "currency" && o.incentive_value != null);
  const bestMoney = moneyOffers.sort((a, b) => (b.incentive_value ?? 0) - (a.incentive_value ?? 0))[0];
  const categoryCounts = countMany(promo, (e) => categoriesOf(e.analysis));
  const coverage = LIFECYCLE_CATEGORIES.filter((c) => (categoryCounts[c] ?? 0) > 0);

  return {
    brand,
    periodDays,
    totalEmails: all.length,
    promoEmails: promo.length,
    transactionalEmails: all.length - promo.length,
    emailsPerWeek: round((promo.length / periodDays) * 7),
    emailsPerMonth: round((promo.length / periodDays) * 30),
    activeSendingDays: new Set(promo.map((e) => e.sent_at?.slice(0, 10))).size,
    uniqueCampaigns: campaigns.size,
    repetitionRate: campaigns.size ? round(promo.length / campaigns.size, 2) : 0,
    categoryCounts,
    weekdayCounts,
    hourCounts,
    preferredDay: topEntries(weekdayCounts, 1)[0]?.[0] ?? null,
    preferredHour: topEntries(hourCounts, 1)[0] ? Number(topEntries(hourCounts, 1)[0][0]) : null,
    avgIntervalHours: intervals.length ? round(intervals.reduce((a, b) => a + b, 0) / intervals.length) : null,
    offers,
    offerTypeCounts: count(offers, (o) => o.offer_type),
    maxPercent: percentOffers.length ? Math.max(...percentOffers.map((o) => Number(o.incentive_value))) : null,
    maxCurrencyAmount: bestMoney ? { amount: Number(bestMoney.incentive_value), currency: bestMoney.currency } : null,
    minRequirements: [...new Set(offers.map((o) => o.min_requirement).filter((x): x is string => !!x))].slice(0, 5),
    maxRewards: [...new Set(offers.map((o) => o.max_reward).filter((x): x is string => !!x))].slice(0, 5),
    conditions: [...new Set(offers.map((o) => o.conditions).filter((x): x is string => !!x))].slice(0, 5),
    urgencyRate: analyses.length ? analyses.filter((a) => a.has_urgency).length / analyses.length : 0,
    personalizationRate: analyses.length ? analyses.filter((a) => a.is_personalized).length / analyses.length : 0,
    emojiRate: analyses.length ? analyses.filter((a) => (a.emoji_count ?? 0) > 0).length / analyses.length : 0,
    offerRate: promo.length ? new Set(offers.map((o) => o.email_id)).size / promo.length : 0,
    creativeFormats: count(analyses, (a) => a.creative_format),
    avgCtaCount: analyses.length ? round(analyses.reduce((s, a) => s + (a.cta_count ?? 0), 0) / analyses.length) : null,
    tones: count(analyses, (a) => a.tone?.toLowerCase()),
    subjectStyles: count(analyses, (a) => a.subject_line_style?.toLowerCase()),
    themes: [...new Set(analyses.map((a) => a.campaign_theme).filter((x): x is string => !!x))].slice(0, 8),
    seasonalEvents: count(analyses, (a) => a.seasonal_event),
    retentionCounts: Object.fromEntries(
      ["reactivation", "loyalty_vip", "cashback", "retention"].map((c) => [c, categoryCounts[c] ?? 0]),
    ),
    weeklyCounts: weeklyBuckets(promo, from, to),
    lifecycleCoverage: coverage,
    confidence: promo.length >= 30 ? "high" : promo.length >= 10 ? "medium" : "low",
  };
}

// ─── Scorecard ─────────────────────────────────────────────────────────

export type ScoreKey = "aggressiveness" | "intensity" | "variety" | "lifecycle" | "creative" | "consistency";
export type Weights = Record<ScoreKey, number>;
export const DEFAULT_WEIGHTS: Weights = { aggressiveness: 1, intensity: 1, variety: 1, lifecycle: 1, creative: 1, consistency: 1 };

/** Plain-language formulas shown in the UI next to the scores. */
export const SCORE_FORMULAS: Record<ScoreKey, { label: string; formula: string }> = {
  aggressiveness: {
    label: "Promotional aggressiveness",
    formula:
      "40 × (share of promo emails carrying an offer) + 30 × (share using urgency/scarcity) + 30 × min(1, best advertised % ÷ 50). Uses advertised values only.",
  },
  intensity: {
    label: "CRM communication intensity",
    formula: "min(100, promo emails per week ÷ 14 × 100). 14+ promotional emails a week scores 100.",
  },
  variety: {
    label: "Promotional variety",
    formula: "min(100, distinct offer types ÷ 6 × 100).",
  },
  lifecycle: {
    label: "Lifecycle coverage",
    formula:
      "Share of the 7 lifecycle stages observed (welcome, first purchase, loyalty/VIP, cashback, retention, reactivation, referral) × 100.",
  },
  creative: {
    label: "Content / creative variety",
    formula: "Average of: distinct categories ÷ 8, distinct creative formats ÷ 3, distinct tones ÷ 4 (each capped at 1) × 100.",
  },
  consistency: {
    label: "Consistency of engagement",
    formula:
      "(weeks with at least one promo email ÷ weeks in period) × (1 − min(1, coefficient of variation of weekly volume ÷ 2)) × 100.",
  },
};

export type Scorecard = {
  brandId: string;
  scores: Record<ScoreKey, number>;
  overall: number;
  coverage: { promoEmails: number; days: number; campaigns: number };
  confidence: BrandStats["confidence"];
};

export function computeScorecard(s: BrandStats, weights: Weights = DEFAULT_WEIGHTS): Scorecard {
  const weeks = s.weeklyCounts;
  const mean = weeks.reduce((a, b) => a + b, 0) / Math.max(1, weeks.length);
  const sd = Math.sqrt(weeks.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, weeks.length));
  const cv = mean > 0 ? sd / mean : 1;
  const activeWeeks = weeks.filter((w) => w > 0).length / Math.max(1, weeks.length);

  const scores: Record<ScoreKey, number> = {
    aggressiveness: clamp(40 * s.offerRate + 30 * s.urgencyRate + 30 * Math.min(1, (s.maxPercent ?? 0) / 50)),
    intensity: clamp((s.emailsPerWeek / 14) * 100),
    variety: clamp((Object.keys(s.offerTypeCounts).length / 6) * 100),
    lifecycle: clamp((s.lifecycleCoverage.length / LIFECYCLE_CATEGORIES.length) * 100),
    creative: clamp(
      ((Math.min(1, Object.keys(s.categoryCounts).length / 8) +
        Math.min(1, Object.keys(s.creativeFormats).length / 3) +
        Math.min(1, Object.keys(s.tones).length / 4)) /
        3) *
        100,
    ),
    consistency: s.promoEmails === 0 ? 0 : clamp(activeWeeks * (1 - Math.min(1, cv / 2)) * 100),
  };
  for (const k of Object.keys(scores) as ScoreKey[]) scores[k] = Math.round(scores[k]);
  const totalW = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const overall = Math.round((Object.keys(scores) as ScoreKey[]).reduce((sum, k) => sum + scores[k] * (weights[k] ?? 0), 0) / totalW);
  return {
    brandId: s.brand.id,
    scores,
    overall,
    coverage: { promoEmails: s.promoEmails, days: Math.round(s.periodDays), campaigns: s.uniqueCampaigns },
    confidence: s.confidence,
  };
}

// ─── Dashboard KPIs ────────────────────────────────────────────────────

export type Kpis = {
  competitorsMonitored: number;
  activeCompetitors: number;
  totalMarketingEmails: number;
  uniqueCampaigns: number;
  activeOffers: number;
  newOffers: number;
  offersExpiringSoon: number;
  significantChanges: { brandId: string; changePct: number; current: number; previous: number }[];
};

/** "Active" = no stated expiry, or expiry in the future (seen within the period). */
export const isOfferActive = (o: Offer, now = new Date()) =>
  o.ends_at ? new Date(o.ends_at) >= now : Date.now() - new Date(o.created_at).getTime() < 14 * DAY;

export function computeKpis(ds: Dataset, prev: Dataset, now = new Date()): Kpis {
  const promoOffers = ds.offers.filter((o) => ds.promoEmails.some((e) => e.id === o.email_id));
  const changes = ds.brands
    .map((b) => {
      const current = ds.promoEmails.filter((e) => e.brand_id === b.id).length;
      const previous = prev.promoEmails.filter((e) => e.brand_id === b.id).length;
      const changePct = previous === 0 ? (current > 0 ? 100 : 0) : ((current - previous) / previous) * 100;
      return { brandId: b.id, changePct: Math.round(changePct), current, previous };
    })
    // Significant = ±50% and at least 3 emails difference, to avoid noise on tiny counts.
    .filter((c) => Math.abs(c.changePct) >= 50 && Math.abs(c.current - c.previous) >= 3);

  return {
    competitorsMonitored: ds.brands.filter((b) => b.active).length,
    activeCompetitors: new Set(ds.promoEmails.map((e) => e.brand_id)).size,
    totalMarketingEmails: ds.promoEmails.length,
    uniqueCampaigns: new Set(ds.promoEmails.map((e) => e.campaign_id).filter(Boolean)).size,
    activeOffers: promoOffers.filter((o) => isOfferActive(o, now)).length,
    newOffers: promoOffers.length,
    offersExpiringSoon: promoOffers.filter((o) => o.ends_at && new Date(o.ends_at) >= now && new Date(o.ends_at).getTime() - now.getTime() < 7 * DAY).length,
    significantChanges: changes,
  };
}

/** Daily or weekly email + campaign counts per brand, for charts. */
export function volumeSeries(ds: Dataset, bucket: "day" | "week") {
  const { from, to } = ds.filters;
  const size = bucket === "day" ? DAY : 7 * DAY;
  const n = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / size));
  const rows = Array.from({ length: n }, (_, i) => {
    const start = new Date(from.getTime() + i * size);
    const row: Record<string, number | string> = { date: start.toISOString().slice(0, 10) };
    for (const b of ds.brands) {
      row[b.id] = 0;
      row[`${b.id}__campaigns`] = 0;
    }
    return row;
  });
  const launches = new Map<string, number>();
  for (const e of ds.promoEmails) {
    if (!e.sent_at || !e.brand_id) continue;
    const idx = Math.floor((new Date(e.sent_at).getTime() - from.getTime()) / size);
    if (idx < 0 || idx >= n) continue;
    rows[idx][e.brand_id] = Number(rows[idx][e.brand_id] ?? 0) + 1;
    if (e.campaign_role === "launch" && e.campaign_id && !launches.has(e.campaign_id)) {
      launches.set(e.campaign_id, idx);
      rows[idx][`${e.brand_id}__campaigns`] = Number(rows[idx][`${e.brand_id}__campaigns`] ?? 0) + 1;
    }
  }
  return rows;
}

export function campaignById(ds: Dataset): Map<string, Campaign> {
  return new Map(ds.campaigns.map((c) => [c.id, c]));
}
