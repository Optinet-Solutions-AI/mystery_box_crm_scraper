import "server-only";
import type { gmail_v1 } from "@googleapis/gmail";
import { z } from "zod";
import { parseStructured } from "./ai/client";
import { env } from "./env";
import { matchBrand } from "./email/match";
import { withRetry } from "./gmail/client";
import { supabaseAdmin, must } from "./supabase";
import type { Brand, Mailbox } from "./types";

/**
 * Signup discovery: someone signs up to an operator directly (outside the tool).
 * Its welcome / marketing mail lands in the research inbox from a sender we don't
 * track yet. We record such senders as candidates, the AI flags which ones are
 * mystery box / rips / cards operators, and a person confirms or dismisses them.
 * Nothing reaches the dashboards until it's confirmed.
 */

export type Observation = {
  messageId: string;
  fromEmail: string | null;
  fromName: string | null;
  subject: string | null;
  snippet: string | null;
  date: string | null;
  isBulk: boolean; // has List-Unsubscribe / automated sender
};

// Personal mailbox providers and big platforms: never candidates.
const IGNORED_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "google.com", "youtube.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com",
  "live.com", "msn.com", "microsoft.com", "icloud.com", "me.com", "mac.com", "apple.com", "aol.com", "proton.me",
  "protonmail.com", "gmx.com", "gmx.net", "mail.com", "yandex.com", "zoho.com", "fastmail.com", "hey.com",
  "facebookmail.com", "linkedin.com", "vercel.com", "github.com", "supabase.io", "supabase.com", "openai.com",
]);

const TWO_PART_TLDS = /\.(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/;

/** mail.news.brand.co.uk → brand.co.uk */
export function registrableDomain(host: string | null | undefined): string | null {
  if (!host) return null;
  const parts = host.toLowerCase().replace(/\.$/, "").split(".");
  if (parts.length < 2) return null;
  const keep = TWO_PART_TLDS.test(host.toLowerCase()) ? 3 : 2;
  return parts.slice(-keep).join(".");
}

const SIGNUP_SUBJECT =
  /(welcome|verify|verification|confirm (your )?(e-?mail|account|registration)|activate|thanks? (you )?for (signing|joining|registering)|account (created|is ready)|get(ting)? started|sign[- ]?up|registration|your new account|one more step)/i;
const AUTOMATED_LOCAL = /^(no-?reply|hello|hi|hey|team|news|newsletter|info|support|marketing|updates?|mail|notifications?|accounts?|welcome|promo|offers?|rewards?|vip|contact)\b/i;

function headersOf(msg: gmail_v1.Schema$Message) {
  const get = (n: string) => msg.payload?.headers?.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value ?? null;
  const from = get("From") ?? "";
  const fromEmail = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase() || null;
  const fromName = from.includes("<") ? from.slice(0, from.indexOf("<")).replace(/["']/g, "").trim() || null : null;
  return { fromEmail, fromName, subject: get("Subject"), listUnsubscribe: get("List-Unsubscribe") };
}

export function observationFrom(msg: gmail_v1.Schema$Message): Observation {
  const h = headersOf(msg);
  const local = h.fromEmail?.split("@")[0] ?? "";
  return {
    messageId: msg.id!,
    fromEmail: h.fromEmail,
    fromName: h.fromName,
    subject: h.subject,
    snippet: msg.snippet?.slice(0, 200) ?? null,
    date: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
    isBulk: Boolean(h.listUnsubscribe) || AUTOMATED_LOCAL.test(local),
  };
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/** Merges observations of untracked senders into brand_candidates. Returns new candidates created. */
export async function recordObservations(mailbox: Pick<Mailbox, "id">, brands: Brand[], observations: Observation[]): Promise<number> {
  const sb = supabaseAdmin();
  const byDomain = new Map<string, Observation[]>();
  for (const o of observations) {
    const host = o.fromEmail?.split("@")[1] ?? null;
    const domain = registrableDomain(host);
    if (!domain || IGNORED_DOMAINS.has(domain)) continue;
    // Only automated mail or signup-looking mail: a person writing from a company address is skipped.
    if (!o.isBulk && !SIGNUP_SUBJECT.test(o.subject ?? "")) continue;
    if (matchBrand(brands, { fromEmail: o.fromEmail, fromDomain: host, replyTo: null, links: [], listUnsubscribe: null })) continue;
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), o]);
  }
  if (byDomain.size === 0) return 0;

  const existing = must(await sb.from("brand_candidates").select("*").in("domain", [...byDomain.keys()]), "load candidates") as {
    id: string;
    domain: string;
    status: string;
    email_count: number;
    first_seen_at: string | null;
    last_seen_at: string | null;
    sender_emails: string[];
    sample_subjects: string[];
    sample_snippets: string[];
    seen_message_ids: string[];
    signup_detected_at: string | null;
    signup_subject: string | null;
    display_name: string | null;
  }[];
  let created = 0;

  for (const [domain, obs] of byDomain) {
    const prev = existing.find((c) => c.domain === domain);
    if (prev && prev.status === "dismissed") continue;
    const seen = new Set(prev?.seen_message_ids ?? []);
    const fresh = obs.filter((o) => !seen.has(o.messageId));
    if (fresh.length === 0) continue;
    const dates = fresh.map((o) => o.date).filter((d): d is string => !!d).sort();
    const signups = fresh.filter((o) => SIGNUP_SUBJECT.test(o.subject ?? "") && o.date).sort((a, b) => a.date!.localeCompare(b.date!));
    const firstSignup = signups[0];
    const earlierSignup = prev?.signup_detected_at && firstSignup?.date ? prev.signup_detected_at <= firstSignup.date : Boolean(prev?.signup_detected_at);

    const row = {
      domain,
      display_name: prev?.display_name ?? fresh.find((o) => o.fromName)?.fromName ?? null,
      sender_emails: uniq([...(prev?.sender_emails ?? []), ...fresh.map((o) => o.fromEmail!).filter(Boolean)]).slice(0, 10),
      mailbox_id: mailbox.id,
      email_count: (prev?.email_count ?? 0) + fresh.length,
      first_seen_at: [prev?.first_seen_at, dates[0]].filter(Boolean).sort()[0] ?? null,
      last_seen_at: [prev?.last_seen_at, dates.at(-1)].filter(Boolean).sort().at(-1) ?? null,
      sample_subjects: uniq([...(prev?.sample_subjects ?? []), ...fresh.map((o) => o.subject ?? "").filter(Boolean)]).slice(0, 8),
      sample_snippets: uniq([...(prev?.sample_snippets ?? []), ...fresh.map((o) => o.snippet ?? "").filter(Boolean)]).slice(0, 4),
      seen_message_ids: [...seen, ...fresh.map((o) => o.messageId)].slice(-300),
      signup_detected_at: earlierSignup ? prev!.signup_detected_at : (firstSignup?.date ?? prev?.signup_detected_at ?? null),
      signup_subject: earlierSignup ? prev!.signup_subject : (firstSignup?.subject ?? prev?.signup_subject ?? null),
      updated_at: new Date().toISOString(),
    };
    if (prev) await sb.from("brand_candidates").update(row).eq("id", prev.id);
    else {
      const ins = await sb.from("brand_candidates").insert(row);
      if (!ins.error) created++;
    }
  }
  return created;
}

/** Looks through recent inbox headers (never bodies) for senders that look like new signups. */
export async function scanInboxForSignups(
  g: gmail_v1.Gmail,
  mailbox: Mailbox,
  brands: Brand[],
  { days = 30, maxMessages = 400, deadline = Date.now() + 90_000 } = {},
): Promise<{ scanned: number; created: number }> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const list = await withRetry(() =>
      g.users.messages.list({ userId: "me", q: `newer_than:${days}d -in:sent -in:chats -in:drafts`, maxResults: 100, pageToken }),
    );
    ids.push(...(list.data.messages ?? []).map((m) => m.id!).filter(Boolean));
    pageToken = list.data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < maxMessages && Date.now() < deadline);

  const observations: Observation[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (i < Math.min(ids.length, maxMessages) && Date.now() < deadline) {
        const id = ids[i++];
        const msg = await withRetry(() =>
          g.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "Subject", "List-Unsubscribe"] }),
        ).catch(() => null);
        if (msg?.data) observations.push(observationFrom(msg.data));
      }
    }),
  );
  const created = await recordObservations(mailbox, brands, observations);
  return { scanned: observations.length, created };
}

// ─── AI triage ────────────────────────────────────────────────────────

const TriageSchema = z.object({
  is_target: z.boolean().describe("True only for mystery box, pack-opening, card rips/breaks or trading-card / collectibles operators the user has an account with"),
  vertical: z.enum(["mystery_box", "card_rips_breaks", "trading_cards_collectibles", "igaming", "ecommerce", "fintech", "saas_or_tool", "newsletter_media", "personal_or_other"]),
  is_signup_or_account_mail: z.boolean().describe("True if these look like emails from a service the user signed up to (welcome, verify, marketing to members)"),
  brand_name: z.string().describe("Brand name as the company presents itself"),
  website_domain: z.string().nullable().describe("Main website domain if evident (e.g. brand.com), else null"),
  confidence: z.number().describe("0-1"),
  reason: z.string().describe("One short sentence explaining the decision"),
});

const TRIAGE_PROMPT = `You triage senders found in a research inbox. The team tracks the CRM emails of mystery box, pack-opening and card rips / breaks operators (and trading-card / collectibles platforms that sell packs, boxes or breaks). Decide whether a sender is such an operator the inbox owner has signed up to. Unrelated services (tools, banks, newsletters, shops, social networks, games that aren't mystery box / cards) are not targets. Judge only from the evidence given; when unsure, set is_target false with low confidence.`;

const TARGET_KEYWORDS = /(mystery ?box|lootbox|loot ?box|case ?open|unbox|rips?\b|\bpacks?\b|break(s|ing)?\b|tcg|pok[eé]mon|trading card|graded|slab|psa\b|collectible|vault)/i;

type CandidateRow = { id: string; domain: string; display_name: string | null; sender_emails: string[]; sample_subjects: string[]; sample_snippets: string[]; signup_subject: string | null };

/** Classifies new candidates (AI when configured, keyword rules otherwise). */
export async function triageCandidates(limit = 10): Promise<number> {
  const sb = supabaseAdmin();
  const rows = must(
    await sb.from("brand_candidates").select("id, domain, display_name, sender_emails, sample_subjects, sample_snippets, signup_subject").eq("status", "pending").is("ai_checked_at", null).limit(limit),
    "load candidates",
  ) as CandidateRow[];
  for (const c of rows) {
    try {
      if (env.hasAI) {
        const r = await parseStructured({
          schema: TriageSchema,
          name: "sender_triage",
          instructions: TRIAGE_PROMPT,
          content: JSON.stringify({
            sender_domain: c.domain,
            sender_name: c.display_name,
            sender_addresses: c.sender_emails,
            subjects: c.sample_subjects,
            previews: c.sample_snippets,
            signup_like_subject: c.signup_subject,
          }),
          effort: "low",
          model: env.aiModel,
        });
        await sb
          .from("brand_candidates")
          .update({
            ai_checked_at: new Date().toISOString(),
            ai_is_target: r.is_target,
            ai_vertical: r.vertical,
            ai_brand_name: r.brand_name,
            ai_website: r.website_domain,
            ai_confidence: r.confidence,
            ai_reason: r.reason,
          })
          .eq("id", c.id);
      } else {
        const text = [c.domain, c.display_name, ...c.sample_subjects, ...c.sample_snippets].join(" ");
        const hit = TARGET_KEYWORDS.test(text);
        await sb
          .from("brand_candidates")
          .update({
            ai_checked_at: new Date().toISOString(),
            ai_is_target: hit,
            ai_brand_name: c.display_name,
            ai_confidence: 0.3,
            ai_reason: hit ? "Keyword match (no AI key configured)." : "No mystery box / cards keywords found (no AI key configured).",
          })
          .eq("id", c.id);
      }
    } catch {
      // Leave unchecked; it will be retried on the next run.
    }
  }
  return rows.length;
}
