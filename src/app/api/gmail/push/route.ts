import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { syncMailbox } from "@/lib/gmail/sync";
import { processPending } from "@/lib/pipeline";
import { timingSafeEqual } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";

export const maxDuration = 300;

/**
 * Gmail push notifications via Google Cloud Pub/Sub (optional, for near-real-time).
 * Configure the Pub/Sub push subscription endpoint as:
 *   https://<app>/api/gmail/push?token=<GMAIL_PUSH_TOKEN>
 */
export async function POST(request: NextRequest) {
  const expected = env.pushVerificationToken;
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!expected || !timingSafeEqual(token, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { message?: { data?: string } } | null;
  const data = body?.message?.data;
  if (!data) return new NextResponse(null, { status: 204 });
  const payload = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as { emailAddress?: string };
  const email = payload.emailAddress?.toLowerCase();
  if (!email) return new NextResponse(null, { status: 204 });

  const mailbox = (await supabaseAdmin().from("mailboxes").select("id, status").eq("email", email).maybeSingle()).data;
  if (mailbox && mailbox.status !== "reauth_required") {
    // Ack immediately (Pub/Sub retries slow acks); do the work after responding.
    after(async () => {
      await syncMailbox(mailbox.id, "push", 120_000).catch(() => null);
      await processPending({ limit: 10, budgetMs: 120_000 }).catch(() => null);
    });
  }
  return new NextResponse(null, { status: 204 });
}
