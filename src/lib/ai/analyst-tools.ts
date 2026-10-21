import "server-only";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { categoriesOf, EMAIL_LIGHT_COLUMNS, loadDataset, parseFilters, previousPeriod, type EmailLight } from "../data";
import { lifecycleForAI, loadLifecycles } from "../lifecycle";
import { computeBrandStats, computeScorecard, isOfferActive, SCORE_FORMULAS, topEntries, type BrandStats } from "../metrics";
import { supabaseAdmin, must } from "../supabase";
import type { Brand, Campaign, EmailAnalysis, Offer, TestAccount } from "../types";

const DAY = 86_400_000;

const json = (x: unknown) => JSON.stringify(x, (_k, v) => (v === undefined ? null : v));

async function allBrands(): Promise<Brand[]> {
  return must(await supabaseAdmin().from("brands").select("*").order("name"), "load brands") as Brand[];
}

/** Accepts brand ids, names or domains; returns matching brand ids (all brands when empty). */
async function resolveBrands(refs: string[] | null | undefined): Promise<{ brands: Brand[]; unknown: string[] }> {
  const brands = await allBrands();
  if (!refs || refs.length === 0) return { brands, unknown: [] };
  const found: Brand[] = [];
  const unknown: string[] = [];
  for (const ref of refs) {
    const r = ref.trim().toLowerCase();
    const b = brands.find((x) => x.id === ref || x.name.toLowerCase() === r || x.domain.toLowerCase() === r || x.domain.toLowerCase().startsWith(r));
    if (b) found.push(b);
    else unknown.push(ref);
  }
  return { brands: [...new Map(found.map((b) => [b.id, b])).values()], unknown };
}

function range(from?: string | null, to?: string | null, days?: number | null) {
  const sp: Record<string, string> = {};
  if (from) sp.from = from;
  if (to) sp.to = to;
  if (!from && days) sp.days = String(days);
  return sp;
}

const brandsParam = z
  .array(z.string())
  .nullish()
  .describe("Brand ids, names or domains. null or [] = all tracked brands.");
const fromParam = z.string().nullish().describe("Start date YYYY-MM-DD (inclusive). null = derived from days.");
const toParam = z.string().nullish().describe("End date YYYY-MM-DD (inclusive). null = today.");
const daysParam = z.number().nullish().describe("Lookback window in days when from is null (default 30).");

function statsSummary(s: BrandStats) {
  return {
    brand_id: s.brand.id,
    brand: s.brand.name,
    promo_emails: s.promoEmails,
    transactional_emails: s.transactionalEmails,
    emails_per_week: s.emailsPerWeek,
    emails_per_month: s.emailsPerMonth,
    active_sending_days: s.activeSendingDays,
    unique_campaigns: s.uniqueCampaigns,
    emails_per_campaign: s.repetitionRate,
    top_categories: topEntries(s.categoryCounts, 8),
    preferred_weekday_utc: s.preferredDay,
    preferred_hour_utc: s.preferredHour,
    weekday_counts: s.weekdayCounts,
    avg_hours_between_promos: s.avgIntervalHours,
    offer_type_counts: s.offerTypeCounts,
    max_advertised_percent: s.maxPercent,
    max_advertised_amount: s.maxCurrencyAmount,
    min_requirements: s.minRequirements,
    max_rewards: s.maxRewards,
    conditions: s.conditions,
    share_with_offer: Math.round(s.offerRate * 100) / 100,
    share_with_urgency: Math.round(s.urgencyRate * 100) / 100,
    share_personalized: Math.round(s.personalizationRate * 100) / 100,
    share_with_emoji_subject: Math.round(s.emojiRate * 100) / 100,
    creative_formats: s.creativeFormats,
    avg_cta_count: s.avgCtaCount,
    tones: topEntries(s.tones, 5),
    subject_styles: topEntries(s.subjectStyles, 5),
    campaign_themes: s.themes,
    seasonal_events: s.seasonalEvents,
    retention_counts: s.retentionCounts,
    lifecycle_stages_observed: s.lifecycleCoverage,
    weekly_promo_counts: s.weeklyCounts,
    data_confidence: s.confidence,
    sample_offer_ids: s.offers.slice(0, 10).map((o) => ({ id: o.id, email_id: o.email_id, campaign_id: o.campaign_id, type: o.offer_type, text: o.incentive_text ?? o.headline })),
  };
}

function offerBrief(o: Offer, brandName: Map<string, string>, email?: { subject: string | null; sent_at: string | null }) {
  return {
    offer_id: o.id,
    email_id: o.email_id,
    campaign_id: o.campaign_id,
    brand: o.brand_id ? brandName.get(o.brand_id) : null,
    offer_type: o.offer_type,
    headline: o.headline,
    incentive_text: o.incentive_text,
    incentive_value: o.incentive_value,
    incentive_unit: o.incentive_unit,
    currency: o.currency,
    min_requirement: o.min_requirement,
    max_reward: o.max_reward,
    promo_code: o.promo_code,
    eligibility: o.eligibility,
    geo_restrictions: o.geo_restrictions,
    starts_at: o.starts_at,
    ends_at: o.ends_at,
    ends_text: o.ends_text,
    conditions: o.conditions,
    cta_url: o.cta_url,
    confidence: o.confidence,
    evidence: o.source_evidence?.slice(0, 300) ?? null,
    industry_fields: o.industry_fields,
    email_subject: email?.subject ?? null,
    email_sent_at: email?.sent_at ?? null,
    active: isOfferActive(o),
  };
}

export const analystTools = [
  betaZodTool({
    name: "list_brands",
    description: "List tracked competitor brands with ids, industry, country, test accounts and email counts. Call this first to resolve brand names.",
    inputSchema: z.object({}),
    run: async () => {
      const sb = supabaseAdmin();
      const [brands, accounts, counts] = await Promise.all([
        allBrands(),
        sb.from("test_accounts").select("id, brand_id, persona, email, registered_at, status").then((r) => (must(r) ?? []) as Pick<TestAccount, "id" | "brand_id" | "persona" | "email" | "registered_at" | "status">[]),
        sb.from("emails").select("brand_id, is_promotional").limit(20000).then((r) => (r.data ?? []) as { brand_id: string; is_promotional: boolean | null }[]),
      ]);
      return json(
        brands.map((b) => ({
          brand_id: b.id,
          name: b.name,
          domain: b.domain,
          industry: b.industry_id,
          country: b.country,
          active: b.active,
          test_accounts: accounts.filter((a) => a.brand_id === b.id).map((a) => ({ account_id: a.id, persona: a.persona, registered_at: a.registered_at, status: a.status })),
          total_emails: counts.filter((c) => c.brand_id === b.id).length,
          promotional_emails: counts.filter((c) => c.brand_id === b.id && c.is_promotional).length,
        })),
      );
    },
  }),

  betaZodTool({
    name: "brand_metrics",
    description:
      "CRM activity metrics and 0-100 scorecard per brand for a date range, with the same metrics for the previous period of equal length. Use for volume, cadence, timing, offer types, advertised values, content style, lifecycle coverage and scores.",
    inputSchema: z.object({ brands: brandsParam, from: fromParam, to: toParam, days: daysParam }),
    run: async ({ brands, from, to, days }) => {
      const { brands: scope, unknown } = await resolveBrands(brands);
      const f = parseFilters({ ...range(from, to, days ?? 30), brands: scope.map((b) => b.id).join(",") });
      const [cur, prev] = await Promise.all([loadDataset(f), loadDataset(previousPeriod(f))]);
      return json({
        period: { from: f.from.toISOString(), to: f.to.toISOString() },
        previous_period: { from: prev.filters.from.toISOString(), to: prev.filters.to.toISOString() },
        unknown_brands: unknown,
        score_formulas: Object.fromEntries(Object.entries(SCORE_FORMULAS).map(([k, v]) => [k, `${v.label}: ${v.formula}`])),
        brands: cur.brands.map((b) => {
          const s = computeBrandStats(cur, b);
          const p = computeBrandStats(prev, b);
          return {
            current: statsSummary(s),
            scorecard: computeScorecard(s),
            previous: {
              promo_emails: p.promoEmails,
              emails_per_week: p.emailsPerWeek,
              unique_campaigns: p.uniqueCampaigns,
              offer_type_counts: p.offerTypeCounts,
              max_advertised_percent: p.maxPercent,
              top_categories: topEntries(p.categoryCounts, 6),
              scorecard: computeScorecard(p).scores,
            },
          };
        }),
      });
    },
  }),

  betaZodTool({
    name: "search_offers",
    description:
      "Search structured offers extracted from promotional emails (type, advertised value, requirements, caps, codes, eligibility, expiry, evidence). Returns offer, email and campaign ids.",
    inputSchema: z.object({
      brands: brandsParam,
      offer_type: z.string().nullish().describe("e.g. discount, cashback, deposit_bonus, free_box, free_spins, free_gift, free_shipping, credits, giveaway, referral_reward, loyalty_reward, bundle, other"),
      min_incentive_value: z.number().nullish().describe("Minimum numeric incentive value (e.g. 15 for 15%)"),
      incentive_unit: z.string().nullish().describe("percent | currency | quantity | free_spins | boxes | credits | points | other"),
      expiring_before: z.string().nullish().describe("Only offers with a stated expiry before this date (YYYY-MM-DD), and not yet expired"),
      active_only: z.boolean().nullish().describe("Only offers that have not expired"),
      text: z.string().nullish().describe("Free text matched against headline, incentive text, conditions and evidence"),
      from: fromParam,
      to: toParam,
      limit: z.number().nullish().describe("Max results (default 40)"),
    }),
    run: async (i) => {
      const sb = supabaseAdmin();
      const { brands, unknown } = await resolveBrands(i.brands);
      const brandName = new Map(brands.map((b) => [b.id, b.name]));
      let q = sb.from("offers").select("*").in("brand_id", brands.map((b) => b.id)).order("created_at", { ascending: false }).limit(1000);
      if (i.offer_type) q = q.eq("offer_type", i.offer_type);
      if (i.incentive_unit) q = q.eq("incentive_unit", i.incentive_unit);
      if (i.min_incentive_value != null) q = q.gte("incentive_value", i.min_incentive_value);
      if (i.expiring_before) q = q.lte("ends_at", new Date(i.expiring_before + "T23:59:59Z").toISOString()).gte("ends_at", new Date().toISOString());
      let offers = (must(await q, "search offers") ?? []) as Offer[];
      if (i.active_only) offers = offers.filter((o) => isOfferActive(o));
      if (i.text) {
        const t = i.text.toLowerCase();
        offers = offers.filter((o) => [o.headline, o.incentive_text, o.conditions, o.source_evidence, o.product_category, o.promo_code].some((x) => x?.toLowerCase().includes(t)));
      }
      const emailIds = [...new Set(offers.map((o) => o.email_id))];
      const emails = new Map<string, { subject: string | null; sent_at: string | null; is_promotional: boolean | null }>();
      for (let k = 0; k < emailIds.length; k += 300) {
        const r = (must(await sb.from("emails").select("id, subject, sent_at, is_promotional").in("id", emailIds.slice(k, k + 300))) ?? []) as { id: string; subject: string | null; sent_at: string | null; is_promotional: boolean | null }[];
        for (const e of r) emails.set(e.id, e);
      }
      const fromT = i.from ? new Date(i.from).getTime() : null;
      const toT = i.to ? new Date(i.to + "T23:59:59Z").getTime() : null;
      offers = offers.filter((o) => {
        const e = emails.get(o.email_id);
        if (!e?.is_promotional) return false;
        const t = e.sent_at ? new Date(e.sent_at).getTime() : 0;
        return (fromT == null || t >= fromT) && (toT == null || t <= toT);
      });
      const limit = Math.min(100, i.limit ?? 40);
      return json({ unknown_brands: unknown, total_matches: offers.length, offers: offers.slice(0, limit).map((o) => offerBrief(o, brandName, emails.get(o.email_id))) });
    },
  }),

  betaZodTool({
    name: "search_campaigns",
    description: "Search inferred campaigns (groups of related promotional emails). Campaigns are inferred by the system, not confirmed by the brand. Returns campaign ids.",
    inputSchema: z.object({
      brands: brandsParam,
      category: z.string().nullish().describe("Category key, e.g. welcome_onboarding, cashback, loyalty_vip, retention, reactivation, seasonal, referral, discount_bonus"),
      from: fromParam,
      to: toParam,
      text: z.string().nullish().describe("Matched against title, offer headline and seasonal event"),
      limit: z.number().nullish(),
    }),
    run: async (i) => {
      const { brands, unknown } = await resolveBrands(i.brands);
      const brandName = new Map(brands.map((b) => [b.id, b.name]));
      let q = supabaseAdmin().from("campaigns").select("*").in("brand_id", brands.map((b) => b.id)).order("first_seen_at", { ascending: false }).limit(1000);
      if (i.from) q = q.gte("last_seen_at", new Date(i.from).toISOString());
      if (i.to) q = q.lte("first_seen_at", new Date(i.to + "T23:59:59Z").toISOString());
      if (i.category) q = q.contains("categories", [i.category]);
      let rows = (must(await q, "search campaigns") ?? []) as Campaign[];
      if (i.text) {
        const t = i.text.toLowerCase();
        rows = rows.filter((c) => [c.title, c.offer_headline, c.seasonal_event, ...c.promo_codes].some((x) => x?.toLowerCase().includes(t)));
      }
      return json({
        unknown_brands: unknown,
        total_matches: rows.length,
        campaigns: rows.slice(0, Math.min(100, i.limit ?? 40)).map((c) => ({
          campaign_id: c.id,
          brand: brandName.get(c.brand_id),
          title: c.title,
          inferred: c.is_inferred && !c.confirmed_by_user,
          grouping_confidence: c.confidence,
          primary_category: c.primary_category,
          categories: c.categories,
          offer_type: c.offer_type,
          offer_headline: c.offer_headline,
          promo_codes: c.promo_codes,
          seasonal_event: c.seasonal_event,
          first_seen_at: c.first_seen_at,
          last_seen_at: c.last_seen_at,
          email_count: c.email_count,
          offer_ends_at: c.offer_ends_at,
        })),
      });
    },
  }),

  betaZodTool({
    name: "search_emails",
    description:
      "Search collected emails by brand, category, type, date and text (subject, preview, AI summary, campaign theme). Returns ids, subject, date, categories and AI summary - never full bodies.",
    inputSchema: z.object({
      brands: brandsParam,
      category: z.string().nullish().describe("Category key to require"),
      email_type: z.string().nullish().describe("promotional | transactional | security | auth_code | support | personal | other"),
      promotional_only: z.boolean().nullish(),
      from: fromParam,
      to: toParam,
      text: z.string().nullish(),
      limit: z.number().nullish(),
    }),
    run: async (i) => {
      const sb = supabaseAdmin();
      const { brands, unknown } = await resolveBrands(i.brands);
      const brandName = new Map(brands.map((b) => [b.id, b.name]));
      let q = sb.from("emails").select(EMAIL_LIGHT_COLUMNS).in("brand_id", brands.map((b) => b.id)).order("sent_at", { ascending: false }).limit(2000);
      if (i.from) q = q.gte("sent_at", new Date(i.from).toISOString());
      if (i.to) q = q.lte("sent_at", new Date(i.to + "T23:59:59Z").toISOString());
      if (i.email_type) q = q.eq("email_type", i.email_type);
      if (i.promotional_only) q = q.eq("is_promotional", true);
      const emails = (must(await q, "search emails") ?? []) as unknown as EmailLight[];
      const analyses = new Map<string, EmailAnalysis>();
      const ids = emails.map((e) => e.id);
      for (let k = 0; k < ids.length; k += 300) {
        for (const a of (must(await sb.from("email_analyses").select("*").in("email_id", ids.slice(k, k + 300))) ?? []) as EmailAnalysis[]) analyses.set(a.email_id, a);
      }
      let rows = emails.map((e) => ({ e, a: analyses.get(e.id) ?? null }));
      if (i.category) rows = rows.filter((r) => categoriesOf(r.a).includes(i.category!));
      if (i.text) {
        const t = i.text.toLowerCase();
        rows = rows.filter((r) => [r.e.subject, r.e.preview_text, r.a?.summary, r.a?.campaign_theme, r.a?.main_message].some((x) => x?.toLowerCase().includes(t)));
      }
      return json({
        unknown_brands: unknown,
        total_matches: rows.length,
        emails: rows.slice(0, Math.min(100, i.limit ?? 40)).map(({ e, a }) => ({
          email_id: e.id,
          campaign_id: e.campaign_id,
          campaign_role: e.campaign_role,
          brand: e.brand_id ? brandName.get(e.brand_id) : null,
          sent_at: e.sent_at,
          subject: e.subject,
          preview_text: e.preview_text,
          email_type: e.email_type,
          promotional: e.is_promotional,
          categories: categoriesOf(a),
          summary: a?.summary ?? null,
          tone: a?.tone ?? null,
          urgency: a?.urgency_tactics ?? [],
          creative_format: a?.creative_format ?? null,
          seasonal_event: a?.seasonal_event ?? null,
          promo_codes: e.promo_codes,
        })),
      });
    },
  }),

  betaZodTool({
    name: "lifecycle",
    description:
      "Observed CRM journey for test accounts from their signup time: time to first/welcome email, email counts by stage, first offer, cadence, incentives by stage, weekly frequency, recorded manual actions, and the email timeline (with ids). Observed behavior for one test account, not a guaranteed sequence.",
    inputSchema: z.object({
      brands: brandsParam,
      account_ids: z.array(z.string()).nullish(),
      horizon_days: z.number().nullish().describe("How many days after signup to include in the event list (default 30)"),
    }),
    run: async (i) => {
      const { brands } = await resolveBrands(i.brands);
      const lcs = await loadLifecycles({ accountIds: i.account_ids ?? undefined, brandIds: i.brands?.length ? brands.map((b) => b.id) : undefined });
      return json({
        accounts: lcs.map((l) =>
          l.registeredAt
            ? lifecycleForAI(l, i.horizon_days ?? 30)
            : { account_id: l.account.id, brand: l.brand.name, persona: l.account.persona, registered_at: null, note: "Signup time not recorded; journey cannot be aligned." },
        ),
      });
    },
  }),

  betaZodTool({
    name: "compare_periods",
    description:
      "Change detection: compares the latest N days with the N days before for each brand - promo volume, campaigns launched, new/dropped offer types and categories, advertised value changes, with ids of new campaigns.",
    inputSchema: z.object({ brands: brandsParam, period_days: z.number().nullish().describe("Length of each period in days (default 7)") }),
    run: async (i) => {
      const { brands, unknown } = await resolveBrands(i.brands);
      const days = i.period_days ?? 7;
      const f = parseFilters({ days: String(days), brands: brands.map((b) => b.id).join(",") });
      const [cur, prev] = await Promise.all([loadDataset(f), loadDataset(previousPeriod(f))]);
      const out = cur.brands.map((b) => {
        const s = computeBrandStats(cur, b);
        const p = computeBrandStats(prev, b);
        const types = (x: BrandStats) => new Set(Object.keys(x.offerTypeCounts));
        const cats = (x: BrandStats) => new Set(Object.keys(x.categoryCounts));
        const newCampaigns = cur.campaigns.filter((c) => c.brand_id === b.id && c.first_seen_at && new Date(c.first_seen_at) >= f.from);
        const changePct = p.promoEmails === 0 ? (s.promoEmails > 0 ? null : 0) : Math.round(((s.promoEmails - p.promoEmails) / p.promoEmails) * 100);
        return {
          brand_id: b.id,
          brand: b.name,
          promo_emails: { current: s.promoEmails, previous: p.promoEmails, change_pct: changePct },
          unique_campaigns: { current: s.uniqueCampaigns, previous: p.uniqueCampaigns },
          new_offer_types: [...types(s)].filter((t) => !types(p).has(t)),
          dropped_offer_types: [...types(p)].filter((t) => !types(s).has(t)),
          new_categories: [...cats(s)].filter((t) => !cats(p).has(t)),
          dropped_categories: [...cats(p)].filter((t) => !cats(s).has(t)),
          max_advertised_percent: { current: s.maxPercent, previous: p.maxPercent },
          urgency_share: { current: Math.round(s.urgencyRate * 100) / 100, previous: Math.round(p.urgencyRate * 100) / 100 },
          campaigns_launched: newCampaigns.map((c) => ({ campaign_id: c.id, title: c.title, first_seen_at: c.first_seen_at, category: c.primary_category, offer: c.offer_headline })),
        };
      });
      return json({
        unknown_brands: unknown,
        current_period: { from: f.from.toISOString(), to: f.to.toISOString() },
        previous_period: { from: new Date(f.from.getTime() - days * DAY).toISOString(), to: f.from.toISOString() },
        brands: out,
      });
    },
  }),
];
