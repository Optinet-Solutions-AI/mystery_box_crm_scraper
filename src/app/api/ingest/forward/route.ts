import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { ingestParsedEmail } from "@/lib/email/ingest";
import { parseRawEmail } from "@/lib/email/parse";
import { processEmail } from "@/lib/pipeline";
import { timingSafeEqual } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";

export const maxDuration = 120;

/**
 * Alternative to Gmail API access: forward/route emails into this endpoint.
 * Works with Cloudflare Email Workers, Mailgun/SendGrid/Postmark inbound webhooks, etc.
 *
 * Auth: `Authorization: Bearer <INGEST_SECRET>` or `?secret=`.
 * Body (any of):
 *   - raw MIME with Content-Type: message/rfc822 (or text/plain)
 *   - JSON { "raw": "<base64 MIME>" } or { "raw_text": "<MIME as text>" }
 *   - Postmark-style JSON { "RawEmail": "<MIME>" }
 *   - multipart/form-data with an "email" field (SendGrid inbound parse, "send raw" mode)
 * Optional `?mailbox=<address>` names the research mailbox it was received by.
 */
export async function POST(request: NextRequest) {
  const secret = env.ingestSecret;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? request.nextUrl.searchParams.get("secret") ?? "";
  if (!secret || !timingSafeEqual(given, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const type = request.headers.get("content-type") ?? "";
  let raw: Buffer | null = null;
  if (type.includes("application/json")) {
    const body = (await request.json()) as { raw?: string; raw_text?: string; RawEmail?: string };
    if (body.raw) raw = Buffer.from(body.raw, "base64");
    else if (body.raw_text ?? body.RawEmail) raw = Buffer.from((body.raw_text ?? body.RawEmail)!, "utf8");
  } else if (type.includes("multipart/form-data")) {
    const form = await request.formData();
    const email = form.get("email");
    if (typeof email === "string") raw = Buffer.from(email, "utf8");
  } else {
    raw = Buffer.from(await request.arrayBuffer());
  }
  if (!raw || raw.length === 0) return NextResponse.json({ error: "No email content found" }, { status: 400 });

  const parsed = await parseRawEmail(raw);
  const mailboxEmail = (request.nextUrl.searchParams.get("mailbox") ?? parsed.headers["x-forwarded-to"] ?? parsed.toEmail ?? "forwarding@inbound")
    .toLowerCase()
    .trim();
  const sb = supabaseAdmin();
  // Reuse an existing mailbox row (e.g. a connected Gmail one) rather than overwriting it.
  let mailbox = (await sb.from("mailboxes").select("id").eq("email", mailboxEmail).maybeSingle()).data;
  if (!mailbox) {
    mailbox = (await sb.from("mailboxes").insert({ email: mailboxEmail, provider: "forwarding", status: "connected" }).select("id").single()).data;
  }

  const result = await ingestParsedEmail(parsed, { source: "forwarding", mailboxId: mailbox?.id ?? null, receivedAt: new Date().toISOString() });
  await sb.from("sync_runs").insert({
    mailbox_id: mailbox?.id ?? null,
    kind: "forwarding",
    status: "success",
    finished_at: new Date().toISOString(),
    fetched: 1,
    inserted: result.status === "inserted" ? 1 : 0,
    duplicates: result.status === "duplicate" ? 1 : 0,
    ignored: result.status === "ignored" ? 1 : 0,
  });
  if (result.status === "inserted" && result.emailId) {
    const id = result.emailId;
    after(() => processEmail(id).catch(() => null));
  }
  return NextResponse.json({ ok: true, ...result });
}
