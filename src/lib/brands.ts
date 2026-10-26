import "server-only";
import { BRAND_PALETTE } from "./constants";
import { supabaseAdmin, must } from "./supabase";

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
}

/** Creates a tracked brand with the next unused palette color. Returns its id. */
export async function insertBrand(input: {
  name?: string | null;
  domain: string;
  signupUrl?: string | null;
  industryId?: string | null;
  country?: string | null;
  senderDomains?: string[];
}): Promise<string> {
  const sb = supabaseAdmin();
  const domain = normalizeDomain(input.domain);
  if (!domain || !domain.includes(".")) throw new Error("Enter a valid domain, e.g. brandname.com");
  const name = input.name?.trim() || domain.split(".")[0].replace(/^\w/, (c) => c.toUpperCase());
  // Next unused palette slot, in fixed order (colors follow the brand, never its rank).
  const used = new Set(((await sb.from("brands").select("color")).data ?? []).map((b) => b.color));
  const color = BRAND_PALETTE.find((c) => !used.has(c)) ?? BRAND_PALETTE[used.size % BRAND_PALETTE.length];
  const signup = input.signupUrl?.trim() || `https://${domain}`;
  const created = must(
    await sb
      .from("brands")
      .insert({
        name,
        domain,
        website_url: `https://${domain}`,
        signup_url: signup.startsWith("http") ? signup : `https://${signup}`,
        industry_id: input.industryId || "mystery_box",
        country: input.country || null,
        sender_domains: [...new Set((input.senderDomains ?? []).map(normalizeDomain).filter((d) => d && d !== domain))],
        color,
        logo_url: `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
      })
      .select("id")
      .single(),
    "create brand",
  ) as { id: string };
  return created.id;
}
