import "server-only";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { openai } from "./ai/client";
import { SERVICE_PROVIDER_DOMAINS } from "./discovery";
import { env } from "./env";
import { supabaseAdmin, must } from "./supabase";
import type { Brand } from "./types";

/**
 * Brand profiles: background on each tracked brand.
 * - Website technology: detected from the brand's homepage (deterministic).
 * - Email / CRM platform: detected from headers and links of emails we received.
 * - Company background: OpenAI with web search, every claim tied to a source URL.
 */

export type Detected = { name: string; category: string; evidence: string };

// ─── Website technology ───────────────────────────────────────────────

const SITE_SIGNATURES: { name: string; category: string; test: RegExp; where?: "html" | "headers" }[] = [
  { name: "Shopify", category: "Commerce platform", test: /cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i },
  { name: "WooCommerce", category: "Commerce platform", test: /woocommerce/i },
  { name: "BigCommerce", category: "Commerce platform", test: /bigcommerce\.com/i },
  { name: "WordPress", category: "CMS", test: /wp-content|wp-includes/i },
  { name: "Webflow", category: "Website builder", test: /webflow\.(com|io)|data-wf-site/i },
  { name: "Wix", category: "Website builder", test: /wixstatic\.com|_wixCIDX/i },
  { name: "Squarespace", category: "Website builder", test: /squarespace\.com|static1\.squarespace/i },
  { name: "Framer", category: "Website builder", test: /framerusercontent\.com|framer\.com\/m\//i },
  { name: "Next.js", category: "Web framework", test: /__NEXT_DATA__|\/_next\/static/i },
  { name: "Nuxt", category: "Web framework", test: /__NUXT__|\/_nuxt\//i },
  { name: "SvelteKit", category: "Web framework", test: /__sveltekit|_app\/immutable/i },
  { name: "Remix", category: "Web framework", test: /__remixContext/i },
  { name: "Angular", category: "Web framework", test: /ng-version=/i },
  { name: "Vue", category: "Web framework", test: /data-v-[0-9a-f]{6,}|vue(\.runtime)?(\.min)?\.js/i },
  { name: "Cloudflare", category: "Hosting / CDN", test: /cloudflare|cf-ray/i, where: "headers" },
  { name: "Vercel", category: "Hosting / CDN", test: /x-vercel-id|vercel/i, where: "headers" },
  { name: "Netlify", category: "Hosting / CDN", test: /netlify/i, where: "headers" },
  { name: "AWS CloudFront", category: "Hosting / CDN", test: /cloudfront/i, where: "headers" },
  { name: "Privy (wallet login)", category: "Auth / wallet", test: /privy\.io|auth\.privy/i },
  { name: "Magic (wallet login)", category: "Auth / wallet", test: /magic\.link|magic-sdk/i },
  { name: "Auth0", category: "Auth / wallet", test: /auth0\.com/i },
  { name: "Stripe", category: "Payments", test: /js\.stripe\.com|stripe\.com\/v3/i },
  { name: "PayPal", category: "Payments", test: /paypal\.com\/sdk|paypalobjects/i },
  { name: "Coinbase Commerce", category: "Payments", test: /commerce\.coinbase\.com/i },
  { name: "NOWPayments", category: "Payments", test: /nowpayments/i },
  { name: "MoonPay", category: "Payments", test: /moonpay/i },
  { name: "Polygon", category: "Blockchain", test: /polygonscan\.com|polygon\.technology|polygon-rpc|\bMATIC\b|"polygon"|chainId["']?\s*:\s*137\b/ },
  { name: "Solana", category: "Blockchain", test: /solana/i },
  { name: "Klaviyo", category: "Email / CRM", test: /klaviyo/i },
  { name: "Customer.io", category: "Email / CRM", test: /customer\.io|customerioforms|cdp\.customer\.io/i },
  { name: "Braze", category: "Email / CRM", test: /braze|appboy/i },
  { name: "Iterable", category: "Email / CRM", test: /iterable\.com/i },
  { name: "HubSpot", category: "Email / CRM", test: /hs-scripts\.com|hubspot/i },
  { name: "Intercom", category: "Support / chat", test: /intercom(cdn)?\.(io|com)|widget\.intercom/i },
  { name: "Zendesk", category: "Support / chat", test: /zdassets\.com|zendesk/i },
  { name: "Crisp", category: "Support / chat", test: /crisp\.chat/i },
  { name: "Tawk.to", category: "Support / chat", test: /tawk\.to/i },
  { name: "Segment", category: "Analytics", test: /cdn\.segment\.com|analytics\.js/i },
  { name: "Google Tag Manager", category: "Analytics", test: /googletagmanager\.com\/gtm/i },
  { name: "Google Analytics", category: "Analytics", test: /google-analytics\.com|gtag\(/i },
  { name: "Meta Pixel", category: "Analytics", test: /connect\.facebook\.net|fbq\(/i },
  { name: "TikTok Pixel", category: "Analytics", test: /analytics\.tiktok\.com/i },
  { name: "Hotjar", category: "Analytics", test: /hotjar/i },
  { name: "Mixpanel", category: "Analytics", test: /mixpanel/i },
  { name: "Amplitude", category: "Analytics", test: /amplitude\.com/i },
  { name: "PostHog", category: "Analytics", test: /posthog/i },
  { name: "Sentry", category: "Monitoring", test: /sentry(-cdn)?\.(io|com)|browser\.sentry/i },
];

const SOCIAL = [
  { network: "X / Twitter", test: /https?:\/\/(www\.)?(twitter|x)\.com\/(?!intent|share|home)[A-Za-z0-9_]{2,}/gi },
  { network: "Instagram", test: /https?:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_.]{2,}/gi },
  { network: "TikTok", test: /https?:\/\/(www\.)?tiktok\.com\/@[A-Za-z0-9_.]{2,}/gi },
  { network: "YouTube", test: /https?:\/\/(www\.)?youtube\.com\/(@|c\/|channel\/)[A-Za-z0-9_\-.]{2,}/gi },
  { network: "Discord", test: /https?:\/\/(www\.)?(discord\.gg|discord\.com\/invite)\/[A-Za-z0-9]{2,}/gi },
  { network: "LinkedIn", test: /https?:\/\/(www\.)?linkedin\.com\/company\/[A-Za-z0-9_\-]{2,}/gi },
  { network: "Facebook", test: /https?:\/\/(www\.)?facebook\.com\/(?!sharer|tr\?|plugins)[A-Za-z0-9.\-]{2,}/gi },
  { network: "Twitch", test: /https?:\/\/(www\.)?twitch\.tv\/[A-Za-z0-9_]{2,}/gi },
];

export type SiteScan = { ok: boolean; status: number | null; title: string | null; description: string | null; tech: Detected[]; social: { network: string; url: string }[] };

/** Fetches the brand's homepage and detects its technology from the HTML and response headers. */
export async function scanWebsite(domain: string): Promise<SiteScan> {
  try {
    const res = await fetch(`https://${domain}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; CRM-Intel brand research)", accept: "text/html" },
    });
    const html = (await res.text()).slice(0, 800_000);
    const headers = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
    const tech: Detected[] = [];
    for (const s of SITE_SIGNATURES) {
      const hay = s.where === "headers" ? headers : html;
      const m = hay.match(s.test);
      if (m) tech.push({ name: s.name, category: s.category, evidence: `${s.where === "headers" ? "response header" : "page source"}: “${m[0].slice(0, 60)}”` });
    }
    const social: SiteScan["social"] = [];
    for (const s of SOCIAL) {
      const url = html.match(s.test)?.[0];
      if (url) social.push({ network: s.network, url: url.replace(/["'<>\s].*$/, "") });
    }
    const meta = (name: string) =>
      html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']{1,300})`, "i"))?.[1] ?? null;
    return {
      ok: res.ok,
      status: res.status,
      title: html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() ?? null,
      description: meta("description") ?? meta("og:description"),
      tech,
      social,
    };
  } catch {
    return { ok: false, status: null, title: null, description: null, tech: [], social: [] };
  }
}

// ─── Email / CRM platform (from emails we received) ───────────────────

const EMAIL_PLATFORMS: { name: string; test: RegExp }[] = [
  { name: "Klaviyo", test: /klaviyo|klclick|kmail-lists|klaviyomail/i },
  { name: "Customer.io", test: /customeriomail|customer\.io|cio[0-9a-z]*\.com|\.cio\.|track\.customer/i },
  { name: "Braze", test: /braze|appboy/i },
  { name: "Iterable", test: /iterable/i },
  { name: "SendGrid", test: /sendgrid|x-sg-eid|ct\.sendgrid/i },
  { name: "Mailchimp / Mandrill", test: /mcsv\.net|list-manage\.com|mandrillapp|mailchimp/i },
  { name: "Mailgun", test: /mailgun/i },
  { name: "HubSpot", test: /hubspot|hs-sites|hubspotemail|hubspotlinks/i },
  { name: "Postmark", test: /postmarkapp|pm-bounces/i },
  { name: "Amazon SES", test: /amazonses\.com/i },
  { name: "Loops", test: /loops\.so/i },
  { name: "Resend", test: /resend\.(dev|com)/i },
  { name: "Brevo (Sendinblue)", test: /sendinblue|brevo|sib\.email/i },
  { name: "Omnisend", test: /omnisend/i },
  { name: "Attentive", test: /attentive(mobile)?\.com|attn\.tv/i },
  { name: "ActiveCampaign", test: /activehosted|activecampaign/i },
  { name: "Intercom", test: /intercom-mail|intercom\.io/i },
  { name: "OneSignal", test: /onesignal/i },
  { name: "MailerLite", test: /mailerlite|mlsend/i },
  { name: "Kit (ConvertKit)", test: /convertkit|ck\.page|kit\.com/i },
  { name: "Beehiiv", test: /beehiiv/i },
  { name: "Privy (login emails)", test: /privy\.io/i },
];

export async function detectEmailPlatforms(brandId: string): Promise<{ name: string; emails: number }[]> {
  const rows = (
    await supabaseAdmin().from("emails").select("headers, links, from_email").eq("brand_id", brandId).order("sent_at", { ascending: false }).limit(100)
  ).data as { headers: Record<string, string>; links: { url: string }[]; from_email: string | null }[] | null;
  const counts = new Map<string, number>();
  for (const e of rows ?? []) {
    const hay = [JSON.stringify(e.headers ?? {}), ...(e.links ?? []).slice(0, 40).map((l) => l.url), e.from_email ?? ""].join(" ");
    for (const p of EMAIL_PLATFORMS) if (p.test.test(hay)) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, emails]) => ({ name, emails })).sort((a, b) => b.emails - a.emails);
}

// ─── AI web research ──────────────────────────────────────────────────

const src = z.string().nullable().describe("URL of the page that states this, or null");
const ProfileSchema = z.object({
  overview: z.string().describe("2-4 sentences: what the brand is, what it sells, how it works"),
  category: z.string().describe("e.g. 'Mystery box site', 'Card rips / pack opening', 'Live-break marketplace'"),
  launch_date: z.string().nullable().describe("When it went live (year, or month and year), only if a source states it"),
  launch_date_source: src,
  founders: z.array(z.object({ name: z.string(), role: z.string().nullable(), source_url: src })),
  headquarters: z.string().nullable().describe("City / country of the company, only if a source states it"),
  headquarters_source: src,
  legal_entity: z.string().nullable().describe("Operating company name from the site's terms/imprint, if stated"),
  parent_company: z.string().nullable(),
  platform_summary: z.string().nullable().describe("What it's built on / runs on: e.g. Shopify store, custom web app, blockchain (Polygon), wallet login, payment providers"),
  business_model: z.string().nullable(),
  products: z.array(z.string()).describe("Main products/box types/features"),
  markets: z.array(z.string()).describe("Countries/regions served or restricted, if stated"),
  payment_methods: z.array(z.string()),
  licensing: z.string().nullable().describe("Licenses, regulation, age/geo restrictions, if stated"),
  funding: z.string().nullable().describe("Investors / funding rounds, if any source states them"),
  social: z.array(z.object({ network: z.string(), url: z.string() })),
  facts: z.array(z.object({ fact: z.string(), source_url: src })).describe("Other notable facts: partnerships, celebrity ties, controversies, milestones"),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
  confidence: z.number().describe("0-1 overall confidence that this profile describes the right company accurately"),
  caveats: z.string().nullable().describe("What couldn't be verified, name clashes, conflicting sources"),
});

const RESEARCH_PROMPT = `You research competitor brands for a CRM intelligence team that tracks mystery box, pack-opening and card-rip operators. Use web search to build a factual company profile.

Rules:
- Only state facts you found in a source. If something can't be found, return null (or an empty list) — never guess founders, dates or locations.
- Give the source URL for launch date, headquarters, founders and facts.
- Good sources: the brand's own site (about, terms, imprint, privacy), LinkedIn, Crunchbase, press, interviews, company registries, Trustpilot, Reddit.
- Make sure it's the right company: match the domain given. Note any name clashes in caveats.
- Keep it concise.`;

/** Researches one brand and stores the profile. Safe to call repeatedly (refreshes the profile). */
export async function researchBrand(brandId: string): Promise<void> {
  const sb = supabaseAdmin();
  const brand = must(await sb.from("brands").select("*").eq("id", brandId).single(), "load brand") as Brand;
  if (SERVICE_PROVIDER_DOMAINS.includes(brand.domain)) {
    const error = `${brand.domain} is a login / email service used by many brands, not ${brand.name}'s own website. Set the real website domain in Brand settings, then research again.`;
    await sb.from("brand_profiles").upsert({ brand_id: brandId, status: "error", error, updated_at: new Date().toISOString() });
    throw new Error(error);
  }
  await sb.from("brand_profiles").upsert({ brand_id: brandId, status: "researching", error: null, updated_at: new Date().toISOString() });

  try {
    const [site, emailPlatforms] = await Promise.all([scanWebsite(brand.domain), detectEmailPlatforms(brandId)]);
    const base = {
      brand_id: brandId,
      site_tech: site.tech,
      email_platforms: emailPlatforms,
      site_title: site.title,
      site_description: site.description,
    };

    if (!env.hasAI) {
      await sb.from("brand_profiles").upsert({ ...base, social: site.social, status: "ready", researched_at: new Date().toISOString(), caveats: "No OPENAI_API_KEY: only website and email detection ran." });
      return;
    }

    const context = {
      brand_name: brand.name,
      website_domain: brand.domain,
      sending_domains: brand.sender_domains,
      homepage_title: site.title,
      homepage_description: site.description,
      detected_website_technology: site.tech.map((t) => `${t.name} (${t.category})`),
      detected_email_platforms: emailPlatforms.map((p) => p.name),
      social_links_on_site: site.social,
    };
    const response = await openai().responses.parse({
      model: env.aiModel,
      instructions: RESEARCH_PROMPT,
      input: [{ role: "user", content: `Research this brand and fill in its profile.\n${JSON.stringify(context, null, 2)}` }],
      tools: [{ type: "web_search" }],
      text: { format: zodTextFormat(ProfileSchema, "brand_profile") },
      reasoning: { effort: "medium" },
      max_output_tokens: 20000,
    });
    if (response.status === "incomplete") throw new Error(`Research was cut off (${response.incomplete_details?.reason ?? "incomplete"}).`);
    const p = response.output_parsed;
    if (!p) throw new Error("Research returned no structured result.");

    // Citations the search attached, added to the model's own source list.
    const cited = response.output
      .flatMap((o) => (o.type === "message" ? o.content : []))
      .flatMap((c) => (c.type === "output_text" ? c.annotations : []))
      .filter((a): a is Extract<typeof a, { type: "url_citation" }> => a.type === "url_citation")
      .map((a) => ({ title: a.title, url: a.url }));
    const sources = [...p.sources, ...cited].filter((s, i, all) => s.url && all.findIndex((x) => x.url === s.url) === i).slice(0, 25);
    const social = [...site.social, ...p.social].filter((s, i, all) => all.findIndex((x) => x.url.replace(/\/$/, "") === s.url.replace(/\/$/, "")) === i);

    await sb.from("brand_profiles").upsert({
      ...base,
      status: "ready",
      overview: p.overview,
      category: p.category,
      launch_date: p.launch_date,
      launch_date_source: p.launch_date_source,
      founders: p.founders,
      headquarters: p.headquarters,
      headquarters_source: p.headquarters_source,
      legal_entity: p.legal_entity,
      parent_company: p.parent_company,
      platform_summary: p.platform_summary,
      business_model: p.business_model,
      products: p.products,
      markets: p.markets,
      payment_methods: p.payment_methods,
      licensing: p.licensing,
      funding: p.funding,
      social,
      facts: p.facts,
      sources,
      confidence: p.confidence,
      caveats: p.caveats,
      model: env.aiModel,
      error: null,
      researched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    await sb
      .from("brand_profiles")
      .upsert({ brand_id: brandId, status: "error", error: err instanceof Error ? err.message : String(err), updated_at: new Date().toISOString() });
    throw err;
  }
}

/** Researches brands that have no profile yet, or whose profile is over 30 days old. */
export async function researchMissingProfiles(limit = 2): Promise<number> {
  const sb = supabaseAdmin();
  const brands = must(await sb.from("brands").select("id").eq("active", true), "load brands") as { id: string }[];
  const profiles = must(await sb.from("brand_profiles").select("brand_id, status, researched_at, updated_at"), "load profiles") as {
    brand_id: string;
    status: string;
    researched_at: string | null;
    updated_at: string;
  }[];
  const month = Date.now() - 30 * 86_400_000;
  const hour = Date.now() - 3_600_000;
  const due = brands.filter((b) => {
    const p = profiles.find((x) => x.brand_id === b.id);
    if (!p) return true;
    if (p.status === "researching" && new Date(p.updated_at).getTime() > hour) return false; // in progress
    if (p.status === "error") return new Date(p.updated_at).getTime() < hour; // retry hourly
    return !p.researched_at || new Date(p.researched_at).getTime() < month;
  });
  let done = 0;
  for (const b of due.slice(0, limit)) {
    await researchBrand(b.id).then(() => done++).catch(() => null);
  }
  return done;
}
