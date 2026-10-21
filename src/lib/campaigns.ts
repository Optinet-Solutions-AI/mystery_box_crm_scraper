import "server-only";
import { supabaseAdmin, must } from "./supabase";
import type { Campaign, Email, EmailAnalysis, Offer } from "./types";

const STOP = new Set(
  "the a an and or for to of in on at with your you our we is are be this that it its from by just now new get all off out up has have here inside more only".split(" "),
);

export function tokens(s: string | null | undefined): Set<string> {
  return new Set(
    (s ?? "")
      .toLowerCase()
      .replace(/^(re|fwd?|fw):\s*/g, "")
      .replace(/\p{Extended_Pictographic}/gu, " ")
      .replace(/[^\p{L}\p{N}%$€£]+/gu, " ")
      .split(" ")
      .filter((t) => t.length >= 3 && !STOP.has(t)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function normalizeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return null;
  }
}

const WINDOW_DAYS = 21;
const ATTACH_THRESHOLD = 0.5;

type Scored = { campaign: Campaign; score: number; reasons: string[] };

function scoreCampaign(
  c: Campaign,
  email: Email,
  analysis: Pick<EmailAnalysis, "campaign_theme" | "seasonal_event">,
  offers: Pick<Offer, "promo_code" | "cta_url" | "offer_type" | "headline">[],
): Scored {
  const reasons: string[] = [];
  let score = 0;
  const codes = new Set([...email.promo_codes, ...offers.map((o) => o.promo_code).filter(Boolean)].map((c) => c!.toUpperCase()));
  if (c.promo_codes.some((p) => codes.has(p.toUpperCase()))) {
    score += 0.5;
    reasons.push("same promo code");
  }
  const landings = new Set(
    [...email.cta_links.map((l) => l.url), ...offers.map((o) => o.cta_url).filter(Boolean) as string[]]
      .map(normalizeUrl)
      .filter((u): u is string => !!u && u.split("/").length > 1 && !u.endsWith("/")),
  );
  if (c.landing_urls.some((u) => landings.has(u))) {
    score += 0.3;
    reasons.push("same landing page");
  }
  const subj = jaccard(tokens(email.subject), tokens(c.signature));
  if (subj > 0) {
    score += subj * 0.5;
    if (subj >= 0.4) reasons.push("similar subject");
  }
  const theme = jaccard(tokens(analysis.campaign_theme), tokens(c.title));
  if (theme > 0) {
    score += theme * 0.5;
    if (theme >= 0.4) reasons.push("similar campaign theme");
  }
  const offerHeadline = offers[0]?.headline;
  if (offerHeadline && c.offer_headline && jaccard(tokens(offerHeadline), tokens(c.offer_headline)) >= 0.5) {
    score += 0.2;
    reasons.push("similar offer");
  }
  if (analysis.seasonal_event && c.seasonal_event && analysis.seasonal_event.toLowerCase() === c.seasonal_event.toLowerCase()) {
    score += 0.1;
    reasons.push("same seasonal event");
  }
  return { campaign: c, score, reasons };
}

/**
 * Puts a promotional email into an existing campaign (same brand, recent, similar)
 * or starts a new one. Campaigns are always marked as inferred.
 */
export async function assignCampaign(
  email: Email,
  analysis: Pick<EmailAnalysis, "campaign_theme" | "seasonal_event" | "primary_category" | "categories">,
  offers: Pick<Offer, "promo_code" | "cta_url" | "offer_type" | "headline" | "ends_at" | "starts_at">[],
): Promise<{ campaignId: string; isNew: boolean; role: string; reasons: string[] }> {
  const sb = supabaseAdmin();
  const sent = new Date(email.sent_at ?? email.received_at ?? Date.now());
  const since = new Date(sent.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
  const candidates = must(
    await sb.from("campaigns").select("*").eq("brand_id", email.brand_id!).gte("last_seen_at", since),
    "load campaigns",
  ) as Campaign[];

  const best = candidates
    .map((c) => scoreCampaign(c, email, analysis, offers))
    .sort((a, b) => b.score - a.score)[0];

  const codes = [...new Set([...email.promo_codes, ...offers.map((o) => o.promo_code).filter(Boolean) as string[]])];
  const landings = [
    ...new Set(
      [...email.cta_links.map((l) => l.url), ...offers.map((o) => o.cta_url).filter(Boolean) as string[]]
        .map(normalizeUrl)
        .filter((u): u is string => !!u),
    ),
  ].slice(0, 10);
  const ends = offers.map((o) => o.ends_at).filter(Boolean) as string[];
  const starts = offers.map((o) => o.starts_at).filter(Boolean) as string[];

  if (best && best.score >= ATTACH_THRESHOLD) {
    const c = best.campaign;
    const sameSubject = tokens(email.subject).size > 0 && jaccard(tokens(email.subject), tokens(c.signature)) >= 0.9;
    const hoursSinceFirst = c.first_seen_at ? (sent.getTime() - new Date(c.first_seen_at).getTime()) / 3_600_000 : 0;
    const role = sameSubject ? "repeat" : hoursSinceFirst > 24 ? "follow_up" : "variation";
    const allEnds = [...ends, ...(c.offer_ends_at ? [c.offer_ends_at] : [])].sort();
    await sb
      .from("campaigns")
      .update({
        email_count: c.email_count + 1,
        first_seen_at: c.first_seen_at && new Date(c.first_seen_at) < sent ? c.first_seen_at : sent.toISOString(),
        last_seen_at: c.last_seen_at && new Date(c.last_seen_at) > sent ? c.last_seen_at : sent.toISOString(),
        promo_codes: [...new Set([...c.promo_codes, ...codes])],
        landing_urls: [...new Set([...c.landing_urls, ...landings])].slice(0, 20),
        categories: [...new Set([...c.categories, ...analysis.categories])],
        offer_ends_at: allEnds.length ? allEnds[allEnds.length - 1] : null,
        offer_starts_at: c.offer_starts_at ?? starts.sort()[0] ?? null,
        confidence: Math.min(0.95, Math.max(Number(c.confidence ?? 0.5), Math.min(1, best.score))),
        updated_at: new Date().toISOString(),
      })
      .eq("id", c.id);
    return { campaignId: c.id, isNew: false, role, reasons: best.reasons };
  }

  const firstOffer = offers[0];
  const created = must(
    await sb
      .from("campaigns")
      .insert({
        brand_id: email.brand_id,
        title: analysis.campaign_theme?.slice(0, 140) || email.subject?.slice(0, 140) || "Untitled campaign",
        signature: email.subject,
        primary_category: analysis.primary_category,
        categories: analysis.categories,
        offer_type: firstOffer?.offer_type ?? null,
        offer_headline: firstOffer?.headline ?? null,
        promo_codes: codes,
        landing_urls: landings,
        seasonal_event: analysis.seasonal_event,
        first_seen_at: sent.toISOString(),
        last_seen_at: sent.toISOString(),
        email_count: 1,
        offer_starts_at: starts.sort()[0] ?? null,
        offer_ends_at: ends.sort().at(-1) ?? null,
        confidence: 0.5,
        is_inferred: true,
      })
      .select("id")
      .single(),
    "create campaign",
  ) as { id: string };
  return { campaignId: created.id, isNew: true, role: "launch", reasons: [] };
}

/** Recomputes campaign counters after emails are moved or deleted. */
export async function refreshCampaignCounts(campaignId: string) {
  const sb = supabaseAdmin();
  const emails = must(
    await sb.from("emails").select("sent_at").eq("campaign_id", campaignId).order("sent_at", { ascending: true }),
    "campaign emails",
  ) as { sent_at: string }[];
  if (emails.length === 0) {
    await sb.from("campaigns").delete().eq("id", campaignId);
    return;
  }
  await sb
    .from("campaigns")
    .update({ email_count: emails.length, first_seen_at: emails[0].sent_at, last_seen_at: emails.at(-1)!.sent_at, updated_at: new Date().toISOString() })
    .eq("id", campaignId);
}
