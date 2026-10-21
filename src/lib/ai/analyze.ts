import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { CATEGORIES, EMAIL_TYPES, INCENTIVE_UNITS, OFFER_TYPES } from "../constants";
import { env } from "../env";
import { htmlToAnnotatedText } from "../email/parse";
import type { Brand, Email, Industry } from "../types";
import { AIRefusedError, parseStructured } from "./client";

const nullableText = (d: string) => z.string().nullable().describe(d);

const OfferSchema = z.object({
  offer_type: z.enum(OFFER_TYPES),
  headline: z.string().describe("Main advertised proposition, close to the email's own wording"),
  incentive_text: nullableText("Exact incentive wording, e.g. '20% off', '3 free packs', '$10 credit'"),
  incentive_value: z.number().nullable().describe("Numeric incentive value if stated (20 for 20%), else null"),
  incentive_unit: z.enum(INCENTIVE_UNITS).nullable(),
  currency: nullableText("ISO currency code if a money amount is stated (USD, EUR, GBP...)"),
  min_requirement: nullableText("Minimum deposit/purchase/qualifying action, as stated"),
  min_requirement_amount: z.number().nullable(),
  max_reward: nullableText("Maximum bonus/discount cap, as stated"),
  max_reward_amount: z.number().nullable(),
  promo_code: nullableText("Code required to claim, exactly as written"),
  eligibility: nullableText("Who qualifies: new/existing/VIP users etc."),
  geo_restrictions: nullableText("Geographic restrictions, if stated"),
  starts_at: nullableText("ISO 8601 start date-time ONLY if the email states it or it is unambiguous from the send date; else null"),
  ends_at: nullableText("ISO 8601 expiry date-time ONLY if the email states it or it is unambiguous from the send date; else null"),
  starts_text: nullableText("Start wording exactly as stated, e.g. 'from Friday'"),
  ends_text: nullableText("Expiry wording exactly as stated, e.g. 'ends midnight Sunday', 'today only'"),
  product_category: nullableText("Products or categories promoted"),
  conditions: nullableText("Wagering, spend, qualifying actions, exclusions - as stated"),
  cta_text: nullableText("Call-to-action text for this offer"),
  cta_url: nullableText("Landing page URL for this offer"),
  confidence: z.number().describe("0-1 confidence that this offer and its fields are extracted correctly"),
  source_evidence: z.string().describe("Verbatim excerpt from the email that supports this offer"),
  industry_fields: z
    .array(z.object({ key: z.string(), value: z.string(), evidence: z.string().nullable() }))
    .describe("Only industry fields that are explicitly stated. Use the keys provided."),
});

export const AnalysisSchema = z.object({
  email_type: z.enum(EMAIL_TYPES).describe(
    "promotional = marketing/CRM; transactional = receipts, orders, shipping, account notices; security = login alerts, password changes; auth_code = verification/OTP codes; support = support conversations",
  ),
  is_promotional: z.boolean().describe("True only for marketing/CRM communication"),
  categories: z.array(z.enum(CATEGORIES)).describe("All categories that apply"),
  primary_category: z.enum(CATEGORIES),
  industry_categories: z.array(z.string()).describe("Industry-specific categories that apply, from the provided list only"),
  summary: z.string().describe("1-2 sentence intelligence summary of the email's purpose"),
  main_message: z.string(),
  promotional_angle: z.string().nullable(),
  tone: z.string().describe("Copywriting tone, e.g. hype, playful, premium, urgent, friendly, informational"),
  copy_style: z.string().describe("Short description of copy style, e.g. 'short punchy lines with emoji'"),
  urgency_tactics: z.array(z.string()).describe("Urgency or scarcity tactics used, verbatim-ish; empty if none"),
  has_urgency: z.boolean(),
  subject_line_style: z.string().describe("e.g. question, announcement, curiosity, personalized, offer-led, emoji-led"),
  emoji_count: z.number().describe("Emoji count in subject and preview text"),
  personalization: z.array(z.string()).describe("Personalization indicators seen (first name, username, past activity...)"),
  is_personalized: z.boolean(),
  emotional_appeals: z.array(z.string()).describe("e.g. FOMO, excitement, exclusivity, greed, nostalgia, belonging"),
  social_proof: z.array(z.string()).describe("Social proof used (big wins, testimonials, user counts...)"),
  content_focus: z.enum(["promotional", "educational", "mixed", "transactional"]),
  cta_count: z.number(),
  cta_placement: z.string().nullable().describe("e.g. 'single hero button above the fold', 'repeated top and bottom'"),
  creative_format: z.enum(["image_heavy", "text_heavy", "mixed"]),
  hero_description: z.string().nullable().describe("What the hero image/section shows"),
  featured_products: z.array(z.string()),
  partnerships: z.array(z.string()).describe("Celebrities, influencers, streamers, brands or partners mentioned"),
  seasonal_event: z.string().nullable().describe("Holiday, sporting or cultural event referenced, if any"),
  campaign_theme: z.string().describe("Short stable campaign name, e.g. 'Halloween 20% deposit bonus'. Repeats and reminders of the same promotion should get the same name."),
  confidence: z.number().describe("0-1 overall confidence in this analysis"),
  offers: z.array(OfferSchema).describe("Every distinct offer in the email; empty array if none"),
});

export type AnalysisResult = z.infer<typeof AnalysisSchema>;

const SYSTEM_PROMPT = `You analyze competitor marketing emails for a CRM intelligence team. The emails were received by research test accounts that signed up to competitor brands.

Rules:
- Report only what the email states or clearly shows. Never invent values. If a field is not stated, return null (the UI shows "Not stated").
- Keep promotional/CRM email separate from receipts, order/shipping notices, security alerts, verification codes and support replies. Those are not promotional, even if they contain a small banner.
- Dates: give ISO dates only when the email states them or they are unambiguous from the send date (e.g. "ends tomorrow" sent on a known date). Always keep the original wording in the *_text fields.
- source_evidence must be copied verbatim from the email.
- Numbers: incentive_value is the number only (20 for "20% off"); amounts in the stated currency.
- The analysis must be useful to a CRM marketer: be specific and concise.`;

function isAnalyzableImage(src: string) {
  return /^https:\/\//i.test(src) && !/\.svg(\?|$)/i.test(src);
}

function buildUserContent(email: Email, brand: Brand, industry: Industry | null, withImages: boolean): OpenAI.Responses.ResponseInputMessageContentList {
  const body = email.html_body ? htmlToAnnotatedText(email.html_body) : (email.text_body ?? "");
  const ctas = email.links.filter((l) => l.kind === "cta").map((l) => `- ${l.text} -> ${l.url}`).join("\n");
  const contentImages = email.images.filter((i) => !i.is_tracking);
  const imageList = contentImages
    .slice(0, 30)
    .map((i) => `- ${i.alt || "(no alt)"}${i.width ? ` ${i.width}x${i.height ?? "?"}` : ""}`)
    .join("\n");
  const fields = industry?.extra_offer_fields?.map((f) => `- ${f.key}: ${f.description}`).join("\n") ?? "";

  const text = `Brand: ${brand.name} (${brand.domain})
Industry: ${industry?.name ?? brand.industry_id}

Industry-specific offer fields (use these keys in industry_fields, only when stated):
${fields || "(none)"}

Industry-specific categories you may use in industry_categories:
${industry?.extra_categories?.join(", ") || "(none)"}

--- EMAIL ---
From: ${email.from_name ?? ""} <${email.from_email ?? ""}>
Reply-To: ${email.reply_to ?? "-"}
To: ${email.to_email ?? "-"}
Sent: ${email.sent_at ?? "unknown"}
Subject: ${email.subject ?? ""}
Preview text: ${email.preview_text ?? ""}
Promo codes found by pattern matching (verify, may be incomplete): ${email.promo_codes.join(", ") || "none"}
Has List-Unsubscribe header: ${email.list_unsubscribe ? "yes" : "no"}

Call-to-action links:
${ctas || "(none detected)"}

Content images (${contentImages.length} total):
${imageList || "(none)"}

Body (links shown in [brackets], images as [image: alt]):
${body}`;

  const blocks: OpenAI.Responses.ResponseInputMessageContentList = [];
  if (withImages) {
    // The largest content images often carry the offer itself (image-heavy emails).
    const hero = [...contentImages]
      .filter((i) => isAnalyzableImage(i.src))
      .sort((a, b) => (b.width ?? 300) * (b.height ?? 200) - (a.width ?? 300) * (a.height ?? 200))
      .slice(0, 3);
    for (const img of hero) blocks.push({ type: "input_image", image_url: img.src, detail: "auto" });
  }
  blocks.push({ type: "input_text", text });
  return blocks;
}

export { AIRefusedError as AnalysisRefusedError };

export async function analyzeEmailWithAI(email: Email, brand: Brand, industry: Industry | null): Promise<AnalysisResult> {
  const withImages = process.env.ANALYZE_IMAGES !== "false";
  const run = (images: boolean) =>
    parseStructured({
      schema: AnalysisSchema,
      name: "email_analysis",
      instructions: SYSTEM_PROMPT,
      content: buildUserContent(email, brand, industry, images),
      effort: "low",
      model: env.aiModel,
    });
  try {
    return await run(withImages);
  } catch (err) {
    // A remote image that can't be downloaded fails the whole request: retry text-only.
    if (withImages && err instanceof OpenAI.BadRequestError) return run(false);
    throw err;
  }
}

// ─── Heuristic fallback (no API key configured) ────────────────────────
const RX = {
  auth: /(verification code|verify your|one[- ]time (pass)?code|login code|sign[- ]in code|\bOTP\b|confirm your email|magic link)/i,
  security: /(password (reset|changed)|new (sign[- ]in|login|device)|security alert|suspicious)/i,
  receipt: /(receipt|order (#|number|confirmed|confirmation)|your order|has shipped|shipping confirmation|invoice|payment (received|confirmation)|withdrawal|deposit (received|confirmed))/i,
  welcome: /(welcome|thanks for (joining|signing up)|get started)/i,
  urgency: /(today only|last chance|ends (tonight|soon|today|in)|hurry|limited time|final hours|don'?t miss|only \d+ left|expires)/i,
  cashback: /(cashback|cash back|rakeback)/i,
  vip: /(vip|loyalty|level up|tier|rewards? (club|program))/i,
  referral: /(refer|invite (a )?friends?)/i,
  reactivation: /(we miss you|come back|it'?s been a while|haven'?t seen you)/i,
  discount: /(\d+\s?% off|\bsave\b|discount|bonus|free (box|pack|spin|rip|shipping))/i,
  seasonal: /(halloween|christmas|black friday|cyber monday|new year|valentine|easter|thanksgiving|summer|holiday)/i,
};

export function analyzeEmailHeuristically(email: Email): AnalysisResult {
  const text = `${email.subject ?? ""}\n${email.preview_text ?? ""}\n${email.text_body ?? (email.html_body ? htmlToAnnotatedText(email.html_body) : "")}`;
  const type: AnalysisResult["email_type"] = RX.auth.test(text)
    ? "auth_code"
    : RX.security.test(text)
      ? "security"
      : RX.receipt.test(email.subject ?? "")
        ? "transactional"
        : email.list_unsubscribe
          ? "promotional"
          : "other";
  const promo = type === "promotional";
  const cats = new Set<AnalysisResult["primary_category"]>();
  if (!promo) cats.add("transactional");
  else {
    if (RX.welcome.test(email.subject ?? "")) cats.add("welcome_onboarding");
    if (RX.discount.test(text)) cats.add("discount_bonus");
    if (RX.cashback.test(text)) cats.add("cashback");
    if (RX.vip.test(text)) cats.add("loyalty_vip");
    if (RX.referral.test(text)) cats.add("referral");
    if (RX.reactivation.test(text)) cats.add("reactivation");
    if (RX.urgency.test(text)) cats.add("urgency_limited_time");
    if (RX.seasonal.test(text)) cats.add("seasonal");
    if (cats.size === 0) cats.add("promotional_campaign");
  }
  const categories = [...cats];
  const emojis = (`${email.subject ?? ""}${email.preview_text ?? ""}`.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  const contentImages = email.images.filter((i) => !i.is_tracking).length;
  const words = text.split(/\s+/).length;
  return {
    email_type: type,
    is_promotional: promo,
    categories,
    primary_category: categories[0],
    industry_categories: [],
    summary: `Heuristic classification (no AI key configured): ${email.subject ?? "(no subject)"}`,
    main_message: email.subject ?? "",
    promotional_angle: null,
    tone: "unknown",
    copy_style: "unknown",
    urgency_tactics: (text.match(RX.urgency) ?? []).slice(0, 1),
    has_urgency: RX.urgency.test(text),
    subject_line_style: emojis > 0 ? "emoji-led" : "plain",
    emoji_count: emojis,
    personalization: [],
    is_personalized: false,
    emotional_appeals: [],
    social_proof: [],
    content_focus: promo ? "promotional" : "transactional",
    cta_count: email.cta_links.length,
    cta_placement: null,
    creative_format: contentImages >= 4 && words < 250 ? "image_heavy" : contentImages <= 1 ? "text_heavy" : "mixed",
    hero_description: null,
    featured_products: [],
    partnerships: [],
    seasonal_event: text.match(RX.seasonal)?.[0] ?? null,
    campaign_theme: (email.subject ?? "untitled").slice(0, 80),
    confidence: 0.3,
    offers: email.promo_codes.length
      ? [
          {
            offer_type: "other",
            headline: email.subject ?? "Promo code",
            incentive_text: null,
            incentive_value: null,
            incentive_unit: null,
            currency: null,
            min_requirement: null,
            min_requirement_amount: null,
            max_reward: null,
            max_reward_amount: null,
            promo_code: email.promo_codes[0],
            eligibility: null,
            geo_restrictions: null,
            starts_at: null,
            ends_at: null,
            starts_text: null,
            ends_text: null,
            product_category: null,
            conditions: null,
            cta_text: email.cta_links[0]?.text ?? null,
            cta_url: email.cta_links[0]?.url ?? null,
            confidence: 0.3,
            source_evidence: email.promo_codes[0],
            industry_fields: [],
          },
        ]
      : [],
  };
}
