"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { seal } from "@/lib/crypto";
import { supabaseAdmin, must } from "@/lib/supabase";

const str = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s || null;
};

function done(message?: string) {
  revalidatePath("/settings");
  if (message) redirect(`/settings?notice=${encodeURIComponent(message)}`);
}

function fail(message: string): never {
  redirect(`/settings?error=${encodeURIComponent(message)}`);
}

// ─── Sync & processing ────────────────────────────────────────────────

export async function saveSyncSettings(formData: FormData) {
  const days = Math.max(1, Math.min(3650, Number(formData.get("initial_sync_days") ?? 90) || 90));
  must(
    await supabaseAdmin().from("app_settings").upsert({ key: "sync", value: { initial_sync_days: days }, updated_at: new Date().toISOString() }),
    "save settings",
  );
  done();
}

export async function retryFailedEmails() {
  must(
    await supabaseAdmin().from("emails").update({ processing_status: "pending", processing_attempts: 0, processing_error: null }).eq("processing_status", "error"),
    "retry failed",
  );
  done();
}

// ─── Google OAuth clients (CRUD) ──────────────────────────────────────

export async function createOAuthClient(formData: FormData) {
  const name = str(formData.get("name")) ?? "Google OAuth client";
  const clientId = str(formData.get("client_id"));
  const clientSecret = str(formData.get("client_secret"));
  if (!clientId || !clientSecret) fail("Client ID and client secret are both required.");
  if (!clientId.endsWith(".apps.googleusercontent.com")) fail("That doesn't look like a Google client ID (it should end in .apps.googleusercontent.com).");
  const res = await supabaseAdmin()
    .from("google_oauth_clients")
    .insert({ name, client_id: clientId, client_secret: seal(clientSecret), notes: str(formData.get("notes")) });
  if (res.error) fail(res.error.code === "23505" ? "That client ID is already saved." : res.error.message);
  done(`Saved OAuth client “${name}”.`);
}

export async function updateOAuthClient(id: string, formData: FormData) {
  const clientId = str(formData.get("client_id"));
  const clientSecret = str(formData.get("client_secret")); // blank = keep the current secret
  if (!clientId) fail("Client ID is required.");
  const res = await supabaseAdmin()
    .from("google_oauth_clients")
    .update({
      name: str(formData.get("name")) ?? "Google OAuth client",
      client_id: clientId,
      notes: str(formData.get("notes")),
      ...(clientSecret ? { client_secret: seal(clientSecret) } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (res.error) fail(res.error.message);
  done("OAuth client updated. Reconnect its mailboxes if you changed the client ID or secret.");
}

export async function deleteOAuthClient(id: string) {
  const sb = supabaseAdmin();
  const used = (await sb.from("mailboxes").select("id", { count: "exact", head: true }).eq("oauth_client_id", id)).count ?? 0;
  if (used > 0) fail(`This OAuth client is used by ${used} mailbox${used > 1 ? "es" : ""}. Assign them another client or delete them first.`);
  must(await sb.from("google_oauth_clients").delete().eq("id", id), "delete OAuth client");
  done("OAuth client deleted.");
}

// ─── Mailboxes (CRUD) ─────────────────────────────────────────────────

export async function createMailbox(formData: FormData) {
  const email = str(formData.get("email"))?.toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("Enter a valid email address.");
  const provider = formData.get("provider") === "forwarding" ? "forwarding" : "gmail";
  const sb = supabaseAdmin();
  const res = await sb
    .from("mailboxes")
    .insert({
      email,
      provider,
      label: str(formData.get("label")),
      oauth_client_id: provider === "gmail" ? str(formData.get("oauth_client_id")) : null,
      status: provider === "forwarding" ? "connected" : "disconnected",
    })
    .select("id")
    .single();
  if (res.error) fail(res.error.code === "23505" ? "That mailbox already exists." : res.error.message);
  await sb.from("test_accounts").update({ mailbox_id: res.data.id }).eq("email", email).is("mailbox_id", null);
  done(provider === "gmail" ? `Added ${email}. Click Connect to sign in with Google.` : `Added forwarding mailbox ${email}.`);
}

export async function updateMailbox(id: string, formData: FormData) {
  const sb = supabaseAdmin();
  const before = (await sb.from("mailboxes").select("oauth_client_id, provider").eq("id", id).single()).data;
  const oauthClientId = str(formData.get("oauth_client_id"));
  const clientChanged = before?.provider === "gmail" && (before?.oauth_client_id ?? null) !== oauthClientId;
  must(
    await sb
      .from("mailboxes")
      .update({
        label: str(formData.get("label")),
        active: formData.get("active") === "on",
        oauth_client_id: oauthClientId,
        // Tokens belong to the old OAuth client; a new client needs a fresh sign-in.
        ...(clientChanged ? { refresh_token: null, access_token: null, status: "reauth_required", last_error: "OAuth client changed. Reconnect." } : {}),
      })
      .eq("id", id),
    "update mailbox",
  );
  done(clientChanged ? "Mailbox updated. Reconnect it to sign in with the new OAuth client." : "Mailbox updated.");
}

export async function disconnectMailbox(id: string) {
  must(
    await supabaseAdmin()
      .from("mailboxes")
      .update({ refresh_token: null, access_token: null, status: "disconnected", watch_expires_at: null })
      .eq("id", id),
    "disconnect mailbox",
  );
  done("Mailbox disconnected. Its emails are kept.");
}

/** Forces a full re-sync (historical backfill) on the next run. Existing emails are kept and deduplicated. */
export async function resetMailboxSync(id: string) {
  must(await supabaseAdmin().from("mailboxes").update({ initial_sync_done: false, history_id: null }).eq("id", id), "reset sync");
  done("The next sync will re-run the historical backfill (duplicates are skipped).");
}

/** Deletes the mailbox connection. Collected emails stay in the database. */
export async function deleteMailbox(id: string) {
  must(await supabaseAdmin().from("mailboxes").delete().eq("id", id), "delete mailbox");
  done("Mailbox deleted. Emails already collected from it are kept.");
}
