import "server-only";
import { auth, gmail, type gmail_v1 } from "@googleapis/gmail";
import { seal, unseal } from "../crypto";
import { env } from "../env";
import { supabaseAdmin } from "../supabase";
import type { GoogleOAuthClient, Mailbox } from "../types";

// Read-only: the app can never send, delete, or change mail (it doesn't even mark emails as read).
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "openid", "email"];

export type OAuthCredentials = { clientId: string; clientSecret: string };

export const callbackPath = "/api/gmail/callback";

export class MissingOAuthClientError extends Error {}
export class ReauthRequiredError extends Error {}

/** The OAuth client a mailbox uses: the one chosen in Settings, else the env-var fallback. */
export async function credentialsFor(mailbox: Pick<Mailbox, "oauth_client_id" | "email">): Promise<OAuthCredentials> {
  if (mailbox.oauth_client_id) {
    const row = (await supabaseAdmin().from("google_oauth_clients").select("*").eq("id", mailbox.oauth_client_id).maybeSingle())
      .data as GoogleOAuthClient | null;
    if (row) return { clientId: row.client_id, clientSecret: unseal(row.client_secret)! };
  }
  if (env.envGoogleClient) return env.envGoogleClient;
  throw new MissingOAuthClientError(
    `No Google OAuth client is set for ${mailbox.email}. Add one in Settings → Google OAuth clients and assign it to the mailbox.`,
  );
}

export function oauthClient(creds: OAuthCredentials, redirectUri?: string) {
  return new auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri);
}

export function authUrl(creds: OAuthCredentials, redirectUri: string, state: string, loginHint?: string) {
  return oauthClient(creds, redirectUri).generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // always return a refresh token
    scope: GMAIL_SCOPES,
    include_granted_scopes: true,
    state,
    login_hint: loginHint,
  });
}

function isInvalidGrant(err: unknown) {
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  return e?.response?.data?.error === "invalid_grant" || /invalid_grant|invalid_client|unauthorized_client/i.test(e?.message ?? "");
}

/** Returns an authorized Gmail client for a mailbox, refreshing tokens as needed. */
export async function gmailFor(mailbox: Mailbox): Promise<gmail_v1.Gmail> {
  const refreshToken = unseal(mailbox.refresh_token);
  if (!refreshToken) throw new ReauthRequiredError("Mailbox is not connected to Gmail.");
  const client = oauthClient(await credentialsFor(mailbox));
  client.setCredentials({
    refresh_token: refreshToken,
    access_token: unseal(mailbox.access_token) ?? undefined,
    expiry_date: mailbox.token_expires_at ? new Date(mailbox.token_expires_at).getTime() : undefined,
  });
  client.on("tokens", (tokens) => {
    void supabaseAdmin()
      .from("mailboxes")
      .update({
        access_token: seal(tokens.access_token),
        token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        ...(tokens.refresh_token ? { refresh_token: seal(tokens.refresh_token) } : {}),
      })
      .eq("id", mailbox.id);
  });
  try {
    await client.getAccessToken();
  } catch (err) {
    if (isInvalidGrant(err)) {
      const msg = "Google access was revoked, expired, or the OAuth client changed. Reconnect the mailbox.";
      await supabaseAdmin().from("mailboxes").update({ status: "reauth_required", last_error: msg }).eq("id", mailbox.id);
      throw new ReauthRequiredError(msg);
    }
    throw err;
  }
  return gmail({ version: "v1", auth: client });
}

/** Retries Gmail calls on rate limits / transient errors with exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { code?: number; status?: number })?.code ?? (err as { status?: number })?.status;
      const retryable = status === 429 || status === 403 || (typeof status === "number" && status >= 500);
      if (!retryable || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i + Math.random() * 250));
    }
  }
  throw lastErr;
}
