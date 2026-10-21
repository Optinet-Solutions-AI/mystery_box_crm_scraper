import { after, NextResponse, type NextRequest } from "next/server";
import { gmail } from "@googleapis/gmail";
import { seal } from "@/lib/crypto";
import { callbackPath, credentialsFor, oauthClient } from "@/lib/gmail/client";
import { ensureWatch, syncMailbox } from "@/lib/gmail/sync";
import { processPending } from "@/lib/pipeline";
import { supabaseAdmin } from "@/lib/supabase";
import type { Mailbox } from "@/lib/types";

export const maxDuration = 300;

/** OAuth redirect target: stores the (encrypted) refresh token and kicks off the historical sync. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const settings = new URL("/settings", url.origin);
  const fail = (message: string) => {
    settings.searchParams.set("error", message);
    const res = NextResponse.redirect(settings);
    res.cookies.delete("gmail_oauth_state");
    return res;
  };

  if (url.searchParams.get("error")) return fail(`Google returned: ${url.searchParams.get("error")}`);
  const [expectedState, mailboxId] = (request.cookies.get("gmail_oauth_state")?.value ?? "").split(".");
  const code = url.searchParams.get("code");
  if (!code || !expectedState || url.searchParams.get("state") !== expectedState) return fail("The sign-in link expired. Click Connect again.");

  const sb = supabaseAdmin();
  const mailbox = (await sb.from("mailboxes").select("*").eq("id", mailboxId).maybeSingle()).data as Mailbox | null;
  if (!mailbox) return fail("That mailbox no longer exists.");

  try {
    const client = oauthClient(await credentialsFor(mailbox), `${url.origin}${callbackPath}`);
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const profile = await gmail({ version: "v1", auth: client }).users.getProfile({ userId: "me" });
    const signedInAs = profile.data.emailAddress?.toLowerCase();
    if (signedInAs !== mailbox.email.toLowerCase()) {
      return fail(`You signed in as ${signedInAs ?? "an unknown account"}, but this mailbox is ${mailbox.email}. Click Connect and pick the right Google account.`);
    }
    const refreshToken = tokens.refresh_token ? seal(tokens.refresh_token) : mailbox.refresh_token;
    if (!refreshToken) {
      return fail("Google didn't return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.");
    }
    await sb
      .from("mailboxes")
      .update({
        provider: "gmail",
        refresh_token: refreshToken,
        access_token: seal(tokens.access_token),
        token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        status: "connected",
        last_error: null,
      })
      .eq("id", mailbox.id);
    await sb.from("test_accounts").update({ mailbox_id: mailbox.id }).eq("email", mailbox.email).is("mailbox_id", null);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  after(async () => {
    const fresh = (await sb.from("mailboxes").select("*").eq("id", mailbox.id).single()).data as Mailbox;
    await ensureWatch(fresh).catch(() => null);
    await syncMailbox(mailbox.id, "initial", 200_000).catch(() => null);
    await processPending({ limit: 15, budgetMs: 60_000 }).catch(() => null);
  });

  settings.searchParams.set("connected", mailbox.email);
  const res = NextResponse.redirect(settings);
  res.cookies.delete("gmail_oauth_state");
  return res;
}
