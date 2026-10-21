import type { Brand, LinkInfo } from "../types";
import { domainOf, hostOf } from "./parse";

export type BrandMatch = { brand: Brand; method: "sender_email" | "from_domain" | "reply_to" | "link_domain" };

const endsWithDomain = (host: string | null, domain: string) =>
  !!host && (host === domain || host.endsWith(`.${domain}`));

function brandDomains(b: Brand): string[] {
  return [b.domain, ...b.sender_domains].map((d) => d.toLowerCase().replace(/^www\./, "").trim()).filter(Boolean);
}

/**
 * Decides which tracked brand an email belongs to. Strongest signal first.
 * Returns null for anything not from a tracked brand (those are never stored).
 */
export function matchBrand(
  brands: Brand[],
  email: { fromEmail: string | null; fromDomain: string | null; replyTo: string | null; links: LinkInfo[]; listUnsubscribe: string | null },
): BrandMatch | null {
  const active = brands.filter((b) => b.active);
  const from = email.fromEmail?.toLowerCase() ?? null;

  for (const b of active) {
    if (from && b.sender_emails.map((s) => s.toLowerCase()).includes(from)) return { brand: b, method: "sender_email" };
  }
  for (const b of active) {
    if (brandDomains(b).some((d) => endsWithDomain(email.fromDomain, d))) return { brand: b, method: "from_domain" };
  }
  const replyDomain = domainOf(email.replyTo);
  for (const b of active) {
    if (brandDomains(b).some((d) => endsWithDomain(replyDomain, d))) return { brand: b, method: "reply_to" };
  }
  // Weak signal: sent through a third-party ESP, but the unsubscribe link or most
  // non-social links point at the brand. Requires a list-unsubscribe header so
  // personal mail that merely mentions a brand is not picked up.
  if (email.listUnsubscribe) {
    const hosts = email.links.filter((l) => l.kind !== "social").map((l) => hostOf(l.url));
    for (const b of active) {
      const domains = brandDomains(b);
      const hits = hosts.filter((h) => domains.some((d) => endsWithDomain(h, d))).length;
      if (hosts.length >= 3 && hits / hosts.length >= 0.5) return { brand: b, method: "link_domain" };
    }
  }
  return null;
}

/** Gmail search query that only returns mail from tracked brands. */
export function gmailQueryForBrands(brands: Brand[], afterDate?: Date): string {
  const domains = [...new Set(brands.filter((b) => b.active).flatMap(brandDomains))];
  const senders = [...new Set(brands.filter((b) => b.active).flatMap((b) => b.sender_emails))];
  const terms = [...domains, ...senders].map((d) => `from:${d}`);
  if (terms.length === 0) return "";
  let q = `{${terms.join(" ")}}`;
  if (afterDate) q += ` after:${Math.floor(afterDate.getTime() / 1000)}`;
  return q + " -in:chats";
}
