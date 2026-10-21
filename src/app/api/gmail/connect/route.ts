import { NextResponse, type NextRequest } from "next/server";
import { authUrl, callbackPath, credentialsFor } from "@/lib/gmail/client";
import { supabaseAdmin } from "@/lib/supabase";
import type { Mailbox } from "@/lib/types";

/** Starts Google OAuth (read-only Gmail) for one mailbox, using that mailbox's OAuth client. */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const settings = new URL("/settings", origin);
  const mailboxId = request.nextUrl.searchParams.get("mailbox");
  const mailbox = mailboxId
    ? ((await supabaseAdmin().from("mailboxes").select("*").eq("id", mailboxId).maybeSingle()).data as Mailbox | null)
    : null;
  if (!mailbox) {
    settings.searchParams.set("error", "Add the mailbox in Settings first, then click Connect.");
    return NextResponse.redirect(settings);
  }
  try {
    const creds = await credentialsFor(mailbox);
    const state = crypto.randomUUID();
    const res = NextResponse.redirect(authUrl(creds, `${origin}${callbackPath}`, state, mailbox.email));
    res.cookies.set("gmail_oauth_state", `${state}.${mailbox.id}`, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  } catch (err) {
    settings.searchParams.set("error", err instanceof Error ? err.message : String(err));
    return NextResponse.redirect(settings);
  }
}
