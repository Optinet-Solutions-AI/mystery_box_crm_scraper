import { cookies } from "next/headers";
import { db } from "@/lib/supabase";
import { fmtAgo } from "@/lib/format";
import { SESSION_COOKIE, sessionToken, timingSafeEqual } from "@/lib/session";
import type { Mailbox } from "@/lib/types";

/** Hours without a successful sync before a connected mailbox counts as stale. */
const STALE_HOURS = 30;

type MailboxRow = Pick<Mailbox, "id" | "email" | "status" | "last_synced_at" | "last_error" | "refresh_token">;

function findProblems(mailboxes: MailboxRow[]) {
  const now = Date.now();
  return mailboxes
    .map((m) => {
      if (m.status === "reauth_required" || (!m.refresh_token && m.status !== "disconnected")) {
        return { m, text: "Google access expired — no new emails are being collected.", reconnect: true };
      }
      if (m.status === "error") return { m, text: `Sync is failing: ${m.last_error ?? "unknown error"}`, reconnect: true };
      if (m.status === "connected" && m.last_synced_at && now - new Date(m.last_synced_at).getTime() > STALE_HOURS * 3_600_000) {
        return { m, text: "No successful sync for over a day — the scheduled sync may not be running.", reconnect: false };
      }
      return null;
    })
    .filter((p): p is NonNullable<typeof p> => !!p);
}

/**
 * Site-wide warning when a research mailbox has stopped collecting emails
 * (Google access expired, an error, or no successful sync for a long time).
 */
export async function MailboxAlert() {
  // Never show mailbox details on the login page to someone who isn't signed in.
  const password = process.env.APP_PASSWORD;
  if (password) {
    const cookie = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
    if (!cookie || !timingSafeEqual(cookie, await sessionToken(password))) return null;
  }

  const sb = await db();
  const { data } = await sb
    .from("mailboxes")
    .select("id, email, status, last_synced_at, last_error, refresh_token")
    .eq("provider", "gmail")
    .eq("active", true);
  const mailboxes = (data ?? []) as MailboxRow[];
  const problems = findProblems(mailboxes);

  if (problems.length === 0) return null;
  return (
    <div className="mb-6 space-y-2">
      {problems.map(({ m, text, reconnect }) => (
        <div key={m.id} role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-ink">
          <div>
            <span className="font-semibold">⚠ {m.email}:</span> {text} Last successful sync {fmtAgo(m.last_synced_at)}.
          </div>
          {reconnect ? (
            <a href={`/api/gmail/connect?mailbox=${m.id}`} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90">
              Reconnect Gmail
            </a>
          ) : (
            <a href="/settings" className="text-sm font-medium text-accent hover:underline">
              Open Settings
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
