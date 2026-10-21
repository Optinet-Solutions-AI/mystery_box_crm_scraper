import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin, must } from "../supabase";
import type { Brand, TestAccount } from "../types";
import { matchBrand } from "./match";
import type { ParsedEmail } from "./parse";

export type IngestContext = {
  source: "gmail" | "forwarding";
  mailboxId: string | null;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  gmailLabels?: string[];
  receivedAt?: string | null;
};

export type IngestResult = { status: "inserted" | "duplicate" | "ignored"; emailId?: string };

export async function loadBrandsAndAccounts() {
  const sb = supabaseAdmin();
  const [brands, accounts] = await Promise.all([
    sb.from("brands").select("*").then((r) => must(r, "load brands") as Brand[]),
    sb.from("test_accounts").select("*").then((r) => must(r, "load test accounts") as TestAccount[]),
  ]);
  return { brands, accounts };
}

export function dedupeKey(parsed: ParsedEmail, ctx: IngestContext): string {
  if (ctx.gmailMessageId) return `gmail:${ctx.gmailMessageId}`;
  if (parsed.messageIdHeader) return `msgid:${parsed.messageIdHeader}`;
  const h = createHash("sha256")
    .update([parsed.fromEmail, parsed.toEmail, parsed.subject, parsed.sentAt].join("|"))
    .digest("hex");
  return `sha:${h}`;
}

/**
 * Stores one parsed email if it belongs to a tracked brand.
 * Untracked mail (personal, other senders) is dropped and never stored.
 */
export async function ingestParsedEmail(
  parsed: ParsedEmail,
  ctx: IngestContext,
  preloaded?: { brands: Brand[]; accounts: TestAccount[] },
): Promise<IngestResult> {
  const sb = supabaseAdmin();
  const { brands, accounts } = preloaded ?? (await loadBrandsAndAccounts());

  const match = matchBrand(brands, parsed);
  if (!match) return { status: "ignored" };

  const key = dedupeKey(parsed, ctx);
  // Same email delivered through Gmail and forwarding: also dedupe on Message-ID.
  if (parsed.messageIdHeader) {
    const existing = await sb.from("emails").select("id").eq("message_id_header", parsed.messageIdHeader).eq("brand_id", match.brand.id).limit(1);
    if (existing.data && existing.data.length > 0) return { status: "duplicate", emailId: existing.data[0].id };
  }

  const toEmail = parsed.toEmail?.toLowerCase() ?? null;
  const brandAccounts = accounts.filter((a) => a.brand_id === match.brand.id);
  const account =
    brandAccounts.find((a) => a.email.toLowerCase() === toEmail) ??
    brandAccounts.find((a) => a.mailbox_id && a.mailbox_id === ctx.mailboxId) ??
    null;

  const row = {
    dedupe_key: key,
    source: ctx.source,
    mailbox_id: ctx.mailboxId,
    brand_id: match.brand.id,
    test_account_id: account?.id ?? null,
    gmail_message_id: ctx.gmailMessageId ?? null,
    gmail_thread_id: ctx.gmailThreadId ?? null,
    message_id_header: parsed.messageIdHeader,
    gmail_labels: ctx.gmailLabels ?? [],
    from_name: parsed.fromName,
    from_email: parsed.fromEmail,
    from_domain: parsed.fromDomain,
    reply_to: parsed.replyTo,
    to_email: toEmail,
    subject: parsed.subject,
    preview_text: parsed.previewText,
    sent_at: parsed.sentAt ?? ctx.receivedAt ?? null,
    received_at: ctx.receivedAt ?? parsed.sentAt ?? null,
    html_body: parsed.htmlBody,
    text_body: parsed.textBody,
    links: parsed.links,
    images: parsed.images,
    attachments: parsed.attachments,
    cta_links: parsed.ctaLinks,
    promo_codes: parsed.promoCodes,
    unsubscribe_url: parsed.unsubscribeUrl,
    list_unsubscribe: parsed.listUnsubscribe,
    headers: parsed.headers,
    match_method: match.method,
    processing_status: "pending" as const,
  };

  const res = await sb.from("emails").upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
  if (res.error) throw new Error(`insert email failed: ${res.error.message}`);
  if (!res.data || res.data.length === 0) return { status: "duplicate" };
  return { status: "inserted", emailId: res.data[0].id };
}
