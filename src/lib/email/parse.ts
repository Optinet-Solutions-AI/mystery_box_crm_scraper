import "server-only";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import * as cheerio from "cheerio";
import type { AttachmentInfo, ImageInfo, LinkInfo } from "../types";

export type ParsedEmail = {
  messageIdHeader: string | null;
  fromName: string | null;
  fromEmail: string | null;
  fromDomain: string | null;
  replyTo: string | null;
  toEmail: string | null;
  subject: string | null;
  previewText: string | null;
  sentAt: string | null;
  htmlBody: string | null;
  textBody: string | null;
  links: LinkInfo[];
  ctaLinks: { text: string; url: string }[];
  images: ImageInfo[];
  attachments: AttachmentInfo[];
  promoCodes: string[];
  unsubscribeUrl: string | null;
  listUnsubscribe: string | null;
  headers: Record<string, string>;
};

const KEEP_HEADERS = [
  "from", "reply-to", "to", "delivered-to", "subject", "date", "message-id", "list-unsubscribe",
  "list-unsubscribe-post", "list-id", "precedence", "x-mailer", "x-campaign", "x-campaign-id",
  "x-mc-user", "x-sg-eid", "x-mailgun-tag", "feedback-id", "x-forwarded-for", "x-forwarded-to",
  "auto-submitted", "return-path",
];

function firstAddress(a: AddressObject | AddressObject[] | undefined) {
  const obj = Array.isArray(a) ? a[0] : a;
  const v = obj?.value?.[0];
  return v ? { name: v.name || null, address: v.address?.toLowerCase() || null } : null;
}

export function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase().trim() : null;
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

const CTA_WORDS =
  /\b(shop|buy|claim|get|grab|open|rip|play|join|start|deposit|redeem|unlock|spin|enter|discover|explore|view|see|try|order|book|sign ?up|register|activate|collect|reveal|bid|win|browse|check (it )?out|learn more|read more|let'?s go|go now|use code)\b/i;
const SOCIAL_HOSTS = /(facebook|instagram|twitter|x\.com|tiktok|youtube|discord|t\.me|telegram|linkedin|pinterest|reddit|twitch)/i;
const LEGAL_WORDS = /(privacy|terms|preferences|manage (your )?subscription|view (this|in) (email )?(in )?(your )?browser|web version|support|help center|contact us|responsible)/i;
const UNSUB_WORDS = /(unsubscribe|opt[- ]?out|email preferences|stop receiving)/i;

function classifyLink(url: string, text: string): LinkInfo["kind"] {
  if (UNSUB_WORDS.test(text) || /unsubscribe|optout|opt-out/i.test(url)) return "unsubscribe";
  if (SOCIAL_HOSTS.test(hostOf(url) ?? "")) return "social";
  if (LEGAL_WORDS.test(text)) return "legal";
  if (text && text.length <= 40 && CTA_WORDS.test(text)) return "cta";
  return "other";
}

function isTrackingImage(src: string, width: number | null, height: number | null, style: string) {
  if ((width !== null && width <= 3) || (height !== null && height <= 3)) return true;
  if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) return true;
  return /(\/open|\/track|pixel|beacon|\/o\.gif|\/wf\/open|\/e\/o\/|spacer\.gif)/i.test(src);
}

/** Codes like "use code SPOOKY20" / "promo code: RIPS50". Conservative to avoid junk. */
export function extractPromoCodes(text: string): string[] {
  const codes = new Set<string>();
  const patterns = [
    /\b(?:promo|coupon|discount|bonus|voucher|referral)?\s*code\s*[:\-–]?\s*["“'‘]?([A-Z0-9][A-Z0-9_-]{3,19})\b/gi,
    /\buse\s+(?:the\s+)?(?:code\s+)?["“'‘]?([A-Z][A-Z0-9_-]{3,19})["”'’]?\s+(?:at|for|to|and|on|when)\b/g,
    /\benter\s+["“'‘]?([A-Z][A-Z0-9_-]{3,19})["”'’]?\s+at checkout\b/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const code = m[1];
      // Must have at least one letter, be mostly upper-case, and not be a common word.
      if (!/[A-Z]/.test(code) || code !== code.toUpperCase()) continue;
      if (/^(HERE|BELOW|ABOVE|THIS|THAT|YOUR|FREE|NOW|TODAY|CODE|EMAIL|LINK|BELOW)$/.test(code)) continue;
      codes.add(code);
    }
  }
  return [...codes].slice(0, 10);
}

function parseListUnsubscribe(value: string | null): string | null {
  if (!value) return null;
  const urls = [...value.matchAll(/<([^>]+)>/g)].map((m) => m[1]);
  return urls.find((u) => u.startsWith("http")) ?? urls[0] ?? null;
}

function headerValue(parsed: ParsedMail, name: string): string | null {
  const raw = parsed.headerLines.find((h) => h.key === name)?.line;
  if (!raw) return null;
  const idx = raw.indexOf(":");
  return (idx >= 0 ? raw.slice(idx + 1) : raw).replace(/\r?\n\s+/g, " ").trim();
}

/** Extracts hidden preheader text (most marketing emails include one). */
function extractPreheader($: cheerio.CheerioAPI): string | null {
  let found: string | null = null;
  $("body *").each((_, el) => {
    if (found) return false;
    const style = ($(el).attr("style") ?? "").toLowerCase();
    const cls = ($(el).attr("class") ?? "").toLowerCase();
    const hidden =
      /display\s*:\s*none|max-height\s*:\s*0|opacity\s*:\s*0|mso-hide\s*:\s*all|font-size\s*:\s*[01]px/.test(style) ||
      /preheader|preview/.test(cls);
    if (hidden) {
      const t = $(el).text().replace(/[\s‌​͏  ­]+/g, " ").trim();
      if (t.length >= 8) found = t.slice(0, 300);
    }
  });
  return found;
}

/** Converts HTML into readable text that keeps link targets, for the AI. */
export function htmlToAnnotatedText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, head, noscript").remove();
  $("a").each((_, el) => {
    const href = $(el).attr("href");
    const t = $(el).text().trim();
    if (href && t && href.startsWith("http")) $(el).replaceWith(`${t} [${href.length > 120 ? href.slice(0, 120) + "…" : href}]`);
  });
  $("img").each((_, el) => {
    const alt = $(el).attr("alt")?.trim();
    $(el).replaceWith(alt ? ` [image: ${alt}] ` : " ");
  });
  $("br").replaceWith("\n");
  $("p, div, tr, h1, h2, h3, h4, li, table").each((_, el) => {
    $(el).append("\n");
  });
  return $.root()
    .text()
    .replace(/[‌​͏­]/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export async function parseRawEmail(raw: Buffer | string): Promise<ParsedEmail> {
  const parsed = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true });

  const from = firstAddress(parsed.from);
  const replyTo = firstAddress(parsed.replyTo);
  const to = firstAddress(parsed.to);
  const html = typeof parsed.html === "string" ? parsed.html : null;
  const text = parsed.text ?? null;

  const headers: Record<string, string> = {};
  for (const key of KEEP_HEADERS) {
    const v = headerValue(parsed, key);
    if (v) headers[key] = v.slice(0, 2000);
  }
  const listUnsubscribe = headers["list-unsubscribe"] ?? null;

  const links: LinkInfo[] = [];
  const images: ImageInfo[] = [];
  let preview: string | null = null;

  if (html) {
    const $ = cheerio.load(html);
    preview = extractPreheader($);
    const seen = new Set<string>();
    $("a[href]").each((_, el) => {
      const url = ($(el).attr("href") ?? "").trim();
      if (!/^https?:\/\//i.test(url)) return;
      const linkText = ($(el).text() || $(el).find("img").attr("alt") || "").replace(/\s+/g, " ").trim().slice(0, 200);
      const key = `${url}|${linkText}`;
      if (seen.has(key)) return;
      seen.add(key);
      const kind = classifyLink(url, linkText);
      links.push({ url, text: linkText, is_cta: kind === "cta", kind });
    });
    $("img[src]").each((_, el) => {
      const src = ($(el).attr("src") ?? "").trim();
      if (!/^https?:\/\//i.test(src)) return;
      const w = parseInt($(el).attr("width") ?? "", 10);
      const h = parseInt($(el).attr("height") ?? "", 10);
      const width = Number.isFinite(w) ? w : null;
      const height = Number.isFinite(h) ? h : null;
      images.push({
        src,
        alt: ($(el).attr("alt") ?? "").trim().slice(0, 200),
        width,
        height,
        is_tracking: isTrackingImage(src, width, height, $(el).attr("style") ?? ""),
      });
    });
  }

  const plain = text ?? (html ? htmlToAnnotatedText(html) : "");
  if (!preview) preview = plain.replace(/\s+/g, " ").trim().slice(0, 160) || null;

  const unsubscribeUrl =
    parseListUnsubscribe(listUnsubscribe) ?? links.find((l) => l.kind === "unsubscribe")?.url ?? null;

  const attachments: AttachmentInfo[] = (parsed.attachments ?? [])
    .filter((a) => a.contentDisposition === "attachment")
    .map((a) => ({ filename: a.filename ?? "attachment", mime_type: a.contentType, size: a.size }));

  return {
    messageIdHeader: parsed.messageId ?? null,
    fromName: from?.name ?? null,
    fromEmail: from?.address ?? null,
    fromDomain: domainOf(from?.address),
    replyTo: replyTo?.address ?? null,
    toEmail: to?.address ?? null,
    subject: parsed.subject ?? null,
    previewText: preview,
    sentAt: parsed.date ? parsed.date.toISOString() : null,
    htmlBody: html,
    textBody: text,
    links: links.slice(0, 300),
    ctaLinks: links.filter((l) => l.is_cta).slice(0, 20).map((l) => ({ text: l.text, url: l.url })),
    images: images.slice(0, 200),
    attachments,
    promoCodes: extractPromoCodes(`${parsed.subject ?? ""}\n${plain}`),
    unsubscribeUrl,
    listUnsubscribe,
    headers,
  };
}
