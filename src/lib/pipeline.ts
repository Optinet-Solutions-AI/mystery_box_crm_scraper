import "server-only";
import { analyzeEmailHeuristically, analyzeEmailWithAI, AnalysisRefusedError, type AnalysisResult } from "./ai/analyze";
import { recordInsight } from "./alerts";
import { assignCampaign, refreshCampaignCounts } from "./campaigns";
import { label } from "./constants";
import { env } from "./env";
import { supabaseAdmin, must } from "./supabase";
import type { Brand, Email, Industry } from "./types";

const MAX_ATTEMPTS = 3;

function toIso(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Runs the full analysis pipeline for one email. */
export async function processEmail(emailId: string, opts: { force?: boolean } = {}) {
  const sb = supabaseAdmin();
  const email = must(await sb.from("emails").select("*").eq("id", emailId).single(), "load email") as Email;
  if (!email.brand_id) return;
  if (email.processing_status === "analyzed" && !opts.force) return;

  await sb
    .from("emails")
    .update({ processing_status: "processing", processing_attempts: email.processing_attempts + 1 })
    .eq("id", emailId);

  try {
    const brand = must(await sb.from("brands").select("*").eq("id", email.brand_id).single(), "load brand") as Brand;
    const industry = (await sb.from("industries").select("*").eq("id", brand.industry_id).maybeSingle()).data as Industry | null;

    const usedAI = env.hasAI;
    const a: AnalysisResult = usedAI ? await analyzeEmailWithAI(email, brand, industry) : analyzeEmailHeuristically(email);

    // Keep any manual category correction across re-analysis.
    const prev = (await sb.from("email_analyses").select("manual_categories").eq("email_id", emailId).maybeSingle()).data;

    const { offers, ...fields } = a;
    must(
      await sb.from("email_analyses").upsert({
        email_id: emailId,
        model: usedAI ? env.aiModel : "heuristic",
        ...fields,
        emoji_count: Math.round(fields.emoji_count),
        cta_count: Math.round(fields.cta_count),
        manual_categories: prev?.manual_categories ?? null,
        raw: a,
        updated_at: new Date().toISOString(),
      }),
      "save analysis",
    );

    // Replace offers for this email.
    await sb.from("offers").delete().eq("email_id", emailId);
    const offerRows = offers.map((o) => ({
      email_id: emailId,
      brand_id: email.brand_id,
      offer_type: o.offer_type,
      headline: o.headline,
      incentive_value: o.incentive_value,
      incentive_unit: o.incentive_unit,
      incentive_text: o.incentive_text,
      currency: o.currency?.toUpperCase().slice(0, 3) ?? null,
      min_requirement: o.min_requirement,
      min_requirement_amount: o.min_requirement_amount,
      max_reward: o.max_reward,
      max_reward_amount: o.max_reward_amount,
      promo_code: o.promo_code,
      eligibility: o.eligibility,
      geo_restrictions: o.geo_restrictions,
      starts_at: toIso(o.starts_at),
      ends_at: toIso(o.ends_at),
      starts_text: o.starts_text,
      ends_text: o.ends_text,
      product_category: o.product_category,
      conditions: o.conditions,
      cta_text: o.cta_text,
      cta_url: o.cta_url,
      confidence: o.confidence,
      source_evidence: o.source_evidence,
      industry_fields: Object.fromEntries(o.industry_fields.map((f) => [f.key, { value: f.value, evidence: f.evidence }])),
    }));
    const insertedOffers = offerRows.length
      ? (must(await sb.from("offers").insert(offerRows).select("id, offer_type, headline, incentive_text"), "save offers") as {
          id: string;
          offer_type: string;
          headline: string;
          incentive_text: string | null;
        }[])
      : [];

    const isPromo = a.is_promotional && a.email_type === "promotional";
    const previousCampaign = email.campaign_id;
    let campaignId: string | null = null;
    let role: string | null = null;

    if (isPromo) {
      const assigned = await assignCampaign(
        { ...email, campaign_id: null },
        { campaign_theme: a.campaign_theme, seasonal_event: a.seasonal_event, primary_category: a.primary_category, categories: a.categories },
        offerRows,
      );
      campaignId = assigned.campaignId;
      role = assigned.role;
      if (insertedOffers.length) await sb.from("offers").update({ campaign_id: campaignId }).eq("email_id", emailId);

      if (assigned.isNew) {
        const lead = insertedOffers[0];
        await recordInsight({
          kind: "new_campaign",
          severity: insertedOffers.length ? "notable" : "info",
          title: `${brand.name}: new campaign "${a.campaign_theme}"`,
          body: `${a.summary}${lead ? ` Offer: ${lead.incentive_text ?? lead.headline}.` : ""}`,
          brand_ids: [brand.id],
          email_ids: [emailId],
          campaign_ids: [campaignId],
          offer_ids: insertedOffers.map((o) => o.id),
          dedupe_key: `new_campaign:${campaignId}`,
          data: { category: a.primary_category },
        });
      }

      // First time this brand uses an offer type → strategic signal.
      for (const o of insertedOffers) {
        const seen = await sb
          .from("offers")
          .select("id", { count: "exact", head: true })
          .eq("brand_id", brand.id)
          .eq("offer_type", o.offer_type)
          .neq("email_id", emailId);
        if ((seen.count ?? 0) === 0) {
          await recordInsight({
            kind: "new_category",
            severity: "important",
            title: `${brand.name} used a new incentive type: ${label(o.offer_type)}`,
            body: o.incentive_text ?? o.headline,
            brand_ids: [brand.id],
            email_ids: [emailId],
            campaign_ids: campaignId ? [campaignId] : [],
            offer_ids: [o.id],
            dedupe_key: `new_offer_type:${brand.id}:${o.offer_type}`,
          });
        }
      }
    }

    await sb
      .from("emails")
      .update({
        email_type: a.email_type,
        is_promotional: isPromo,
        campaign_id: campaignId,
        campaign_role: role,
        processing_status: "analyzed",
        processing_error: null,
      })
      .eq("id", emailId);

    if (previousCampaign && previousCampaign !== campaignId) await refreshCampaignCounts(previousCampaign);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const giveUp = err instanceof AnalysisRefusedError || email.processing_attempts + 1 >= MAX_ATTEMPTS;
    await sb
      .from("emails")
      .update({ processing_status: giveUp ? "error" : "pending", processing_error: message })
      .eq("id", emailId);
    throw err;
  }
}

/** Processes queued emails, oldest first, within a time budget. */
export async function processPending({ limit = 25, budgetMs = 200_000, concurrency = 3 } = {}) {
  const sb = supabaseAdmin();
  const deadline = Date.now() + budgetMs;
  const rows = must(
    await sb
      .from("emails")
      .select("id, brand_id")
      .eq("processing_status", "pending")
      .lt("processing_attempts", MAX_ATTEMPTS)
      .order("sent_at", { ascending: true })
      .limit(limit),
    "load pending",
  ) as { id: string; brand_id: string }[];

  // Brands run in parallel; each brand's emails run in send order so campaign
  // grouping sees earlier emails first and never races itself.
  const queues = [...rows.reduce((m, r) => m.set(r.brand_id, [...(m.get(r.brand_id) ?? []), r.id]), new Map<string, string[]>()).values()];
  let analyzed = 0;
  let failed = 0;
  let q = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queues.length) }, async () => {
      while (q < queues.length) {
        const queue = queues[q++];
        for (const id of queue) {
          if (Date.now() > deadline) return;
          try {
            await processEmail(id);
            analyzed++;
          } catch {
            failed++;
          }
        }
      }
    }),
  );
  const remaining = (await sb.from("emails").select("id", { count: "exact", head: true }).eq("processing_status", "pending")).count ?? 0;
  return { analyzed, failed, remaining };
}
