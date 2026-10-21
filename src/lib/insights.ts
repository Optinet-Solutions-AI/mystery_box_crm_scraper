import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { anthropic, FALLBACK_PARAMS } from "./ai/client";
import { recordInsight } from "./alerts";
import { label } from "./constants";
import { categoriesOf, fetchAll, loadDataset, previousPeriod, type Filters } from "./data";
import { env } from "./env";
import { computeBrandStats } from "./metrics";
import { supabaseAdmin, must } from "./supabase";
import type { Brand, Offer } from "./types";

const DAY = 86_400_000;

type PromoRow = { id: string; brand_id: string; sent_at: string; campaign_id: string | null };

/**
 * Deterministic feed items: volume changes (last 7d vs previous 7d),
 * offers expiring within 72h, and brands that went quiet (no promo email in 14d).
 */
export async function generatePeriodicInsights(): Promise<{ created: number }> {
  const sb = supabaseAdmin();
  const now = Date.now();
  const brands = must(await sb.from("brands").select("*").eq("active", true), "load brands") as Brand[];
  const since = new Date(now - 60 * DAY).toISOString();
  const promo = await fetchAll<PromoRow>((a, b) =>
    sb
      .from("emails")
      .select("id, brand_id, sent_at, campaign_id")
      .eq("is_promotional", true)
      .gte("sent_at", since)
      .order("sent_at", { ascending: true })
      .range(a, b) as unknown as PromiseLike<{ data: PromoRow[] | null; error: { message: string } | null }>,
  );
  const weekKey = new Date(now).toISOString().slice(0, 10);
  let created = 0;

  for (const b of brands) {
    const mine = promo.filter((e) => e.brand_id === b.id);
    const cur = mine.filter((e) => new Date(e.sent_at).getTime() >= now - 7 * DAY);
    const prev = mine.filter((e) => {
      const t = new Date(e.sent_at).getTime();
      return t >= now - 14 * DAY && t < now - 7 * DAY;
    });

    // Volume change: same rule as the dashboard KPI (±50% and at least 3 emails difference).
    const changePct = prev.length === 0 ? (cur.length > 0 ? 100 : 0) : ((cur.length - prev.length) / prev.length) * 100;
    if (Math.abs(changePct) >= 50 && Math.abs(cur.length - prev.length) >= 3) {
      const up = changePct > 0;
      const id = await recordInsight({
        kind: "volume_change",
        severity: Math.abs(changePct) >= 100 ? "important" : "notable",
        title: `${b.name} ${up ? "increased" : "reduced"} promotional email volume ${up ? "+" : ""}${Math.round(changePct)}%`,
        body: `${cur.length} promotional emails in the last 7 days vs ${prev.length} in the 7 days before (inbox-observed).`,
        brand_ids: [b.id],
        email_ids: cur.slice(-10).map((e) => e.id),
        campaign_ids: [...new Set(cur.map((e) => e.campaign_id).filter((x): x is string => !!x))].slice(0, 10),
        dedupe_key: `volume_change:${b.id}:${weekKey}`,
        data: { change_pct: Math.round(changePct), current: cur.length, previous: prev.length },
        period_start: new Date(now - 7 * DAY).toISOString(),
        period_end: new Date(now).toISOString(),
      });
      if (id) created++;
    }

    // Went quiet: had promo email in the previous 46 days but nothing for 14 days.
    const last = mine.at(-1);
    if (last && now - new Date(last.sent_at).getTime() >= 14 * DAY) {
      const id = await recordInsight({
        kind: "volume_change",
        severity: "notable",
        title: `${b.name} has gone quiet`,
        body: `No promotional email observed for ${Math.floor((now - new Date(last.sent_at).getTime()) / DAY)} days (last one on ${last.sent_at.slice(0, 10)}).`,
        brand_ids: [b.id],
        email_ids: [last.id],
        campaign_ids: last.campaign_id ? [last.campaign_id] : [],
        dedupe_key: `quiet:${b.id}:${last.id}`,
        data: { change_pct: -100, last_sent_at: last.sent_at },
      });
      if (id) created++;
    }
  }

  // Offers expiring within 72 hours.
  const soon = must(
    await sb
      .from("offers")
      .select("*")
      .gte("ends_at", new Date(now).toISOString())
      .lte("ends_at", new Date(now + 3 * DAY).toISOString()),
    "load expiring offers",
  ) as Offer[];
  const brandName = new Map(brands.map((b) => [b.id, b.name]));
  for (const o of soon) {
    if (!o.brand_id || !brandName.has(o.brand_id)) continue;
    const id = await recordInsight({
      kind: "offer_expiring",
      severity: "info",
      title: `${brandName.get(o.brand_id)}: "${o.incentive_text ?? o.headline ?? label(o.offer_type)}" expires ${o.ends_at!.slice(0, 10)}`,
      body: o.ends_text ? `Stated expiry: ${o.ends_text}` : null,
      brand_ids: [o.brand_id],
      email_ids: [o.email_id],
      campaign_ids: o.campaign_id ? [o.campaign_id] : [],
      offer_ids: [o.id],
      dedupe_key: `offer_expiring:${o.id}`,
    });
    if (id) created++;
  }

  return { created };
}

// ─── AI Intelligence Summary ───────────────────────────────────────────

const FindingsSchema = z.object({
  findings: z.array(
    z.object({
      title: z.string().describe("Short headline of the finding"),
      detail: z.string().describe("1-3 sentences with the specific numbers from the digest"),
      email_ids: z.array(z.string()).describe("Supporting email ids, copied exactly from the digest"),
      campaign_ids: z.array(z.string()).describe("Supporting campaign ids, copied exactly from the digest"),
      brand_names: z.array(z.string()),
      severity: z.enum(["info", "notable", "important"]),
    }),
  ),
});

export type AiFinding = { title: string; detail: string; email_ids: string[]; campaign_ids: string[] };

const SUMMARY_SYSTEM = `You are a CRM market-intelligence analyst. You receive a structured digest of competitor marketing emails observed in research inboxes, for a current period and the previous period of equal length.

Write the key findings a CRM team should know. Look for:
- competitors increasing or reducing promotional intensity
- new incentive types appearing
- significant changes in promotional values
- seasonal campaign trends
- competitors launching similar campaigns
- unusual changes in messaging

Rules:
- Use only the digest. Every finding must cite supporting email_ids and/or campaign_ids copied exactly from the digest. Skip anything you can't support.
- This is inbox-observed activity, not market share, deliverability, conversion or profitability. Never claim those.
- Campaigns are inferred groupings, not confirmed promotions.
- Return between 0 and 7 findings, most important first. If there is little data, return fewer.`;

export async function generateAiSummary(filters: Filters): Promise<{ findings: AiFinding[] }> {
  if (!env.hasAnthropic) return { findings: [] };
  const [cur, prev] = await Promise.all([loadDataset(filters), loadDataset(previousPeriod(filters))]);
  if (cur.promoEmails.length === 0) return { findings: [] };

  const brandName = new Map(cur.brands.map((b) => [b.id, b.name]));
  const prevOfferTypes = new Map<string, Set<string>>();
  for (const o of prev.offers) {
    if (!o.brand_id || !o.offer_type) continue;
    if (!prevOfferTypes.has(o.brand_id)) prevOfferTypes.set(o.brand_id, new Set());
    prevOfferTypes.get(o.brand_id)!.add(o.offer_type);
  }

  const digest = {
    period: { from: filters.from.toISOString().slice(0, 10), to: filters.to.toISOString().slice(0, 10) },
    previous_period: { from: prev.filters.from.toISOString().slice(0, 10), to: prev.filters.to.toISOString().slice(0, 10) },
    brands: cur.brands.map((b) => {
      const s = computeBrandStats(cur, b);
      const p = computeBrandStats(prev, b);
      return {
        brand: b.name,
        promo_emails: s.promoEmails,
        promo_emails_previous: p.promoEmails,
        emails_per_week: s.emailsPerWeek,
        unique_campaigns: s.uniqueCampaigns,
        unique_campaigns_previous: p.uniqueCampaigns,
        top_categories: Object.entries(s.categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 5),
        offer_types: s.offerTypeCounts,
        new_offer_types_vs_previous: Object.keys(s.offerTypeCounts).filter((t) => !prevOfferTypes.get(b.id)?.has(t)),
        max_percent: s.maxPercent,
        max_percent_previous: p.maxPercent,
        max_amount: s.maxCurrencyAmount,
        max_amount_previous: p.maxCurrencyAmount,
        urgency_rate: Math.round(s.urgencyRate * 100) / 100,
        urgency_rate_previous: Math.round(p.urgencyRate * 100) / 100,
        seasonal_events: s.seasonalEvents,
        tones: s.tones,
      };
    }),
    campaigns: cur.campaigns.map((c) => ({
      id: c.id,
      brand: brandName.get(c.brand_id) ?? "?",
      title: c.title,
      category: c.primary_category,
      offer: c.offer_headline,
      emails: c.email_count,
      first_seen: c.first_seen_at?.slice(0, 10),
      seasonal_event: c.seasonal_event,
    })),
    emails: cur.promoEmails.slice(-150).map((e) => ({
      id: e.id,
      brand: brandName.get(e.brand_id ?? "") ?? "?",
      sent: e.sent_at?.slice(0, 10),
      subject: e.subject,
      categories: categoriesOf(e.analysis),
      summary: e.analysis?.summary ?? null,
      campaign_id: e.campaign_id,
    })),
    offers: cur.offers
      .filter((o) => cur.promoEmails.some((e) => e.id === o.email_id))
      .slice(-100)
      .map((o) => ({
        email_id: o.email_id,
        brand: brandName.get(o.brand_id ?? "") ?? "?",
        type: o.offer_type,
        value: o.incentive_text,
        min_requirement: o.min_requirement,
        max_reward: o.max_reward,
        ends: o.ends_at?.slice(0, 10) ?? o.ends_text,
      })),
  };

  const response = await anthropic().beta.messages.parse({
    model: env.anthropicModel,
    max_tokens: 16000,
    ...FALLBACK_PARAMS,
    output_config: { effort: "medium", format: betaZodOutputFormat(FindingsSchema) },
    system: SUMMARY_SYSTEM,
    messages: [{ role: "user", content: `Digest (JSON):\n${JSON.stringify(digest)}` }],
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined to generate the summary.");
  if (response.stop_reason === "max_tokens") throw new Error("Summary was cut off (max_tokens).");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Summary returned no structured output.");

  // Keep only evidence that exists in the digest; drop unsupported findings.
  const emailIds = new Set(digest.emails.map((e) => e.id).concat(digest.offers.map((o) => o.email_id)));
  const campaignIds = new Set(digest.campaigns.map((c) => c.id));
  const brandIdByName = new Map(cur.brands.map((b) => [b.name.toLowerCase(), b.id]));
  const periodKey = `${digest.period.from}:${digest.period.to}:${filters.brandIds.join(",")}`;
  const findings: AiFinding[] = [];

  for (const f of parsed.findings) {
    const email_ids = [...new Set(f.email_ids.filter((id) => emailIds.has(id)))];
    const campaign_ids = [...new Set(f.campaign_ids.filter((id) => campaignIds.has(id)))];
    if (email_ids.length === 0 && campaign_ids.length === 0) continue;
    findings.push({ title: f.title, detail: f.detail, email_ids, campaign_ids });
    await recordInsight({
      kind: "ai_finding",
      severity: f.severity,
      title: f.title,
      body: f.detail,
      brand_ids: f.brand_names.map((n) => brandIdByName.get(n.toLowerCase())).filter((x): x is string => !!x),
      email_ids,
      campaign_ids,
      dedupe_key: `ai_finding:${periodKey}:${f.title.toLowerCase().slice(0, 80)}`,
      period_start: filters.from.toISOString(),
      period_end: filters.to.toISOString(),
      data: { model: env.anthropicModel },
    });
  }
  return { findings };
}
