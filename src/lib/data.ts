import "server-only";
import { BRAND_PALETTE } from "./constants";
import { db, must } from "./supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Brand, Campaign, Email, EmailAnalysis, Industry, Mailbox, Offer, TestAccount } from "./types";

export type SearchParams = Record<string, string | string[] | undefined>;

export type Filters = {
  from: Date;
  to: Date;
  brandIds: string[]; // empty = all
  industry: string | null;
  country: string | null;
  accountId: string | null;
  mailboxId: string | null;
  days: number;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export function parseFilters(sp: SearchParams): Filters {
  const now = new Date();
  const days = Number(one(sp.days) ?? 30) || 30;
  const toParam = one(sp.to);
  const fromParam = one(sp.from);
  const to = toParam ? endOfDay(new Date(toParam)) : now;
  const from = fromParam ? new Date(fromParam) : new Date(to.getTime() - days * 86_400_000);
  const brands = one(sp.brands);
  return {
    from,
    to,
    days: Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000)),
    brandIds: brands ? brands.split(",").filter(Boolean) : [],
    industry: one(sp.industry),
    country: one(sp.country),
    accountId: one(sp.account),
    mailboxId: one(sp.mailbox),
  };
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Same filters shifted back one period (for "vs previous period" comparisons). */
export function previousPeriod(f: Filters): Filters {
  const span = f.to.getTime() - f.from.getTime();
  return { ...f, from: new Date(f.from.getTime() - span), to: new Date(f.from.getTime()) };
}

/** Supabase caps responses at 1000 rows; this pages through everything. */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let page = 0; ; page++) {
    const res = await build(page * size, page * size + size - 1);
    if (res.error) throw new Error(res.error.message);
    out.push(...(res.data ?? []));
    if (!res.data || res.data.length < size) break;
  }
  return out;
}

export type FilterOptions = {
  brands: Brand[];
  industries: Industry[];
  countries: string[];
  accounts: TestAccount[];
  mailboxes: Pick<Mailbox, "id" | "email" | "provider" | "status">[];
};

export async function loadFilterOptions(): Promise<FilterOptions> {
  const sb = await db();
  const [brands, industries, accounts, mailboxes] = await Promise.all([
    sb.from("brands").select("*").order("name").then((r) => must(r) as Brand[]),
    sb.from("industries").select("*").order("name").then((r) => must(r) as Industry[]),
    sb.from("test_accounts").select("*").order("created_at").then((r) => must(r) as TestAccount[]),
    sb.from("mailboxes").select("id, email, provider, status").order("created_at").then((r) => must(r) as FilterOptions["mailboxes"]),
  ]);
  const countries = [...new Set(brands.map((b) => b.country).filter((c): c is string => !!c))].sort();
  return { brands, industries, countries, accounts, mailboxes };
}

/** Email columns without the heavy bodies. */
export const EMAIL_LIGHT_COLUMNS =
  "id, source, mailbox_id, brand_id, test_account_id, campaign_id, campaign_role, gmail_message_id, gmail_thread_id, from_name, from_email, from_domain, reply_to, to_email, subject, preview_text, sent_at, received_at, links, images, cta_links, promo_codes, unsubscribe_url, match_method, email_type, is_promotional, processing_status, processing_error, created_at";

export type EmailLight = Omit<Email, "html_body" | "text_body" | "headers" | "attachments" | "list_unsubscribe" | "message_id_header" | "gmail_labels" | "dedupe_key" | "processing_attempts">;

export type EmailRow = EmailLight & { analysis: EmailAnalysis | null };

export type Dataset = {
  filters: Filters;
  brands: Brand[]; // brands in scope
  emails: EmailRow[]; // all brand emails in range (incl. transactional)
  promoEmails: EmailRow[]; // promotional only - use for campaign metrics
  offers: Offer[];
  campaigns: Campaign[]; // campaigns with activity in range
};

/** Effective categories: a manual correction wins over the AI. */
export const categoriesOf = (a: EmailAnalysis | null | undefined): string[] =>
  a ? (a.manual_categories && a.manual_categories.length ? a.manual_categories : [...a.categories, ...a.industry_categories]) : [];

export async function scopedBrands(sb: SupabaseClient, f: Filters): Promise<Brand[]> {
  let q = sb.from("brands").select("*").order("name");
  if (f.brandIds.length) q = q.in("id", f.brandIds);
  if (f.industry) q = q.eq("industry_id", f.industry);
  if (f.country) q = q.eq("country", f.country);
  return must(await q) as Brand[];
}

export async function loadDataset(f: Filters): Promise<Dataset> {
  const sb = await db();
  const brands = await scopedBrands(sb, f);
  const brandIds = brands.map((b) => b.id);
  if (brandIds.length === 0) return { filters: f, brands, emails: [], promoEmails: [], offers: [], campaigns: [] };

  const fromIso = f.from.toISOString();
  const toIso = f.to.toISOString();

  const emails = await fetchAll<EmailLight>((a, b) => {
    let q = sb.from("emails").select(EMAIL_LIGHT_COLUMNS).in("brand_id", brandIds).gte("sent_at", fromIso).lte("sent_at", toIso);
    if (f.accountId) q = q.eq("test_account_id", f.accountId);
    if (f.mailboxId) q = q.eq("mailbox_id", f.mailboxId);
    return q.order("sent_at", { ascending: true }).range(a, b) as unknown as PromiseLike<{ data: EmailLight[] | null; error: { message: string } | null }>;
  });

  const ids = emails.map((e) => e.id);
  const analyses: EmailAnalysis[] = [];
  const offers: Offer[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const [a, o] = await Promise.all([
      sb.from("email_analyses").select("*").in("email_id", chunk),
      sb.from("offers").select("*").in("email_id", chunk),
    ]);
    analyses.push(...((must(a) as EmailAnalysis[]) ?? []));
    offers.push(...((must(o) as Offer[]) ?? []));
  }
  const byEmail = new Map(analyses.map((a) => [a.email_id, a]));
  const rows: EmailRow[] = emails.map((e) => ({ ...e, analysis: byEmail.get(e.id) ?? null }));

  const campaignIds = [...new Set(rows.map((e) => e.campaign_id).filter((x): x is string => !!x))];
  const campaigns: Campaign[] = [];
  for (let i = 0; i < campaignIds.length; i += 300) {
    campaigns.push(...(must(await sb.from("campaigns").select("*").in("id", campaignIds.slice(i, i + 300))) as Campaign[]));
  }

  return {
    filters: f,
    brands,
    emails: rows,
    promoEmails: rows.filter((e) => e.is_promotional),
    offers,
    campaigns,
  };
}

export function brandColor(brand: Pick<Brand, "color" | "id">, index: number): string {
  return brand.color || BRAND_PALETTE[index % BRAND_PALETTE.length];
}
