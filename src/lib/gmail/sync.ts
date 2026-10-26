import "server-only";
import type { gmail_v1 } from "@googleapis/gmail";
import { env } from "../env";
import { supabaseAdmin, must } from "../supabase";
import type { Brand, Mailbox, TestAccount } from "../types";
import { parseRawEmail } from "../email/parse";
import { ingestParsedEmail, loadBrandsAndAccounts } from "../email/ingest";
import { gmailQueryForBrands, matchBrand } from "../email/match";
import { gmailFor, ReauthRequiredError, withRetry } from "./client";
import { observationFrom, recordObservations, scanInboxForSignups, triageCandidates, type Observation } from "../discovery";

export type SyncKind = "initial" | "incremental" | "manual" | "push" | "brand_backfill";
export type SyncStats = { fetched: number; inserted: number; duplicates: number; ignored: number; done: boolean };

const CONCURRENCY = 5;

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const r = await supabaseAdmin().from("app_settings").select("value").eq("key", key).maybeSingle();
  return (r.data?.value as T) ?? fallback;
}

/** Fetches one message in raw form, parses it and stores it if it's from a tracked brand. */
async function fetchAndIngest(
  g: gmail_v1.Gmail,
  mailbox: Mailbox,
  id: string,
  ctx: { brands: Brand[]; accounts: TestAccount[] },
  stats: SyncStats,
) {
  const msg = await withRetry(() => g.users.messages.get({ userId: "me", id, format: "raw" }));
  stats.fetched++;
  const raw = msg.data.raw;
  if (!raw) return;
  const parsed = await parseRawEmail(Buffer.from(raw, "base64url"));
  const result = await ingestParsedEmail(
    parsed,
    {
      source: "gmail",
      mailboxId: mailbox.id,
      gmailMessageId: msg.data.id,
      gmailThreadId: msg.data.threadId,
      gmailLabels: msg.data.labelIds ?? [],
      receivedAt: msg.data.internalDate ? new Date(Number(msg.data.internalDate)).toISOString() : null,
    },
    ctx,
  );
  stats[result.status === "inserted" ? "inserted" : result.status === "duplicate" ? "duplicates" : "ignored"]++;
}

async function existingGmailIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const keys = ids.map((id) => `gmail:${id}`);
  const r = await supabaseAdmin().from("emails").select("dedupe_key").in("dedupe_key", keys);
  return new Set((r.data ?? []).map((row) => (row.dedupe_key as string).slice(6)));
}

/** Query-based sync: lists matching messages and ingests the ones we don't have yet. */
async function queryIngest(
  g: gmail_v1.Gmail,
  mailbox: Mailbox,
  query: string,
  ctx: { brands: Brand[]; accounts: TestAccount[] },
  stats: SyncStats,
  deadline: number,
) {
  let pageToken: string | undefined;
  do {
    const list = await withRetry(() =>
      g.users.messages.list({ userId: "me", q: query, maxResults: 100, pageToken, includeSpamTrash: false }),
    );
    const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);
    const have = await existingGmailIds(ids);
    stats.duplicates += have.size;
    await mapLimit(
      ids.filter((id) => !have.has(id)),
      CONCURRENCY,
      (id) => fetchAndIngest(g, mailbox, id, ctx, stats),
    );
    pageToken = list.data.nextPageToken ?? undefined;
    if (Date.now() > deadline) {
      stats.done = !pageToken;
      return;
    }
  } while (pageToken);
  stats.done = true;
}

/** History-based incremental sync (fast path). Returns false if the history cursor expired. */
async function historyIngest(
  g: gmail_v1.Gmail,
  mailbox: Mailbox,
  ctx: { brands: Brand[]; accounts: TestAccount[] },
  stats: SyncStats,
  deadline: number,
): Promise<{ ok: boolean; historyId: string | null }> {
  let pageToken: string | undefined;
  let latest: string | null = mailbox.history_id;
  const added = new Set<string>();
  try {
    do {
      const res = await withRetry(() =>
        g.users.history.list({
          userId: "me",
          startHistoryId: mailbox.history_id!,
          historyTypes: ["messageAdded"],
          maxResults: 500,
          pageToken,
        }),
      );
      for (const h of res.data.history ?? []) {
        for (const m of h.messagesAdded ?? []) {
          const labels = m.message?.labelIds ?? [];
          if (m.message?.id && !labels.includes("DRAFT") && !labels.includes("SENT")) added.add(m.message.id);
        }
      }
      latest = res.data.historyId ?? latest;
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 404) return { ok: false, historyId: null }; // cursor too old
    throw err;
  }

  const ids = [...added];
  const have = await existingGmailIds(ids);
  stats.duplicates += have.size;
  const todo = ids.filter((id) => !have.has(id));

  // Look at headers first so personal mail is never downloaded in full.
  const unknownSenders: Observation[] = [];
  await mapLimit(todo, CONCURRENCY, async (id) => {
    if (Date.now() > deadline) return;
    const meta = await withRetry(() =>
      g.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "Reply-To", "List-Unsubscribe", "Subject"] }),
    );
    const hdr = (n: string) => meta.data.payload?.headers?.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value ?? null;
    const fromRaw = hdr("From") ?? "";
    const fromEmail = (fromRaw.match(/<([^>]+)>/)?.[1] ?? fromRaw).trim().toLowerCase() || null;
    const replyRaw = hdr("Reply-To") ?? "";
    const replyTo = (replyRaw.match(/<([^>]+)>/)?.[1] ?? replyRaw).trim().toLowerCase() || null;
    const listUnsubscribe = hdr("List-Unsubscribe");
    const quick = matchBrand(ctx.brands, {
      fromEmail,
      fromDomain: fromEmail?.split("@")[1] ?? null,
      replyTo,
      links: [],
      listUnsubscribe: null,
    });
    if (!quick) unknownSenders.push(observationFrom(meta.data));
    // Bulk mail from an unknown sender might still be a tracked brand using an ESP: check the body.
    if (quick || listUnsubscribe) await fetchAndIngest(g, mailbox, id, ctx, stats);
    else stats.ignored++;
  });
  // Untracked senders become signup candidates (headers only) for a person to confirm.
  await recordObservations(mailbox, ctx.brands, unknownSenders).catch(() => 0);
  stats.done = Date.now() <= deadline;
  return { ok: true, historyId: stats.done ? latest : mailbox.history_id };
}

async function startRun(mailboxId: string, kind: string) {
  const r = await supabaseAdmin().from("sync_runs").insert({ mailbox_id: mailboxId, kind }).select("id").single();
  return must(r, "start sync run").id as string;
}

async function finishRun(runId: string, stats: SyncStats, error?: string) {
  await supabaseAdmin()
    .from("sync_runs")
    .update({
      status: error ? "error" : stats.done ? "success" : "partial",
      finished_at: new Date().toISOString(),
      fetched: stats.fetched,
      inserted: stats.inserted,
      duplicates: stats.duplicates,
      ignored: stats.ignored,
      error: error ?? null,
    })
    .eq("id", runId);
}

/**
 * Syncs one mailbox. First run does the historical backfill; later runs use the
 * Gmail history cursor, falling back to a date query if the cursor expired.
 * `budgetMs` keeps a run inside serverless time limits; unfinished work resumes next run.
 */
export async function syncMailbox(mailboxId: string, kind: SyncKind = "incremental", budgetMs = 240_000): Promise<SyncStats> {
  const sb = supabaseAdmin();
  const mailbox = must(await sb.from("mailboxes").select("*").eq("id", mailboxId).single(), "load mailbox") as Mailbox;
  const stats: SyncStats = { fetched: 0, inserted: 0, duplicates: 0, ignored: 0, done: false };
  const runKind = !mailbox.initial_sync_done ? "initial" : kind;
  const runId = await startRun(mailbox.id, runKind);
  const deadline = Date.now() + budgetMs;

  try {
    const g = await gmailFor(mailbox);
    const ctx = await loadBrandsAndAccounts();
    if (ctx.brands.filter((b) => b.active).length === 0) {
      stats.done = true;
      await finishRun(runId, stats);
      return stats;
    }
    const profile = await withRetry(() => g.users.getProfile({ userId: "me" }));
    const profileHistoryId = profile.data.historyId ?? null;
    let nextHistoryId: string | null = mailbox.history_id;

    if (!mailbox.initial_sync_done || !mailbox.history_id) {
      const { initial_sync_days } = await getSetting("sync", { initial_sync_days: 90 });
      const after = new Date(Date.now() - initial_sync_days * 86_400_000);
      await queryIngest(g, mailbox, gmailQueryForBrands(ctx.brands, after), ctx, stats, deadline);
      nextHistoryId = mailbox.history_id ?? profileHistoryId;
      // Find operators signed up to outside the tool.
      if (Date.now() < deadline - 20_000) {
        await scanInboxForSignups(g, mailbox, ctx.brands, { days: Math.min(initial_sync_days, 60), deadline: deadline - 5_000 }).catch(() => null);
      }
    } else {
      const res = await historyIngest(g, mailbox, ctx, stats, deadline);
      if (res.ok) {
        nextHistoryId = res.historyId;
      } else {
        // History expired (>~1 week offline): re-query everything since the last sync.
        const since = new Date(new Date(mailbox.last_synced_at ?? Date.now() - 30 * 86_400_000).getTime() - 86_400_000);
        await queryIngest(g, mailbox, gmailQueryForBrands(ctx.brands, since), ctx, stats, deadline);
        nextHistoryId = profileHistoryId;
      }
    }

    await sb
      .from("mailboxes")
      .update({
        status: "connected",
        last_error: null,
        last_synced_at: new Date().toISOString(),
        history_id: nextHistoryId,
        initial_sync_done: mailbox.initial_sync_done || stats.done,
      })
      .eq("id", mailbox.id);
    await finishRun(runId, stats);
    await triageCandidates(5).catch(() => 0);
    return stats;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sb
      .from("mailboxes")
      .update({ status: err instanceof ReauthRequiredError ? "reauth_required" : "error", last_error: message })
      .eq("id", mailbox.id);
    await finishRun(runId, stats, message);
    throw err;
  }
}

/** Backfills history for one brand (e.g. right after adding it). */
export async function backfillBrand(mailboxId: string, brandId: string, days = 365, budgetMs = 240_000): Promise<SyncStats> {
  const sb = supabaseAdmin();
  const mailbox = must(await sb.from("mailboxes").select("*").eq("id", mailboxId).single(), "load mailbox") as Mailbox;
  const stats: SyncStats = { fetched: 0, inserted: 0, duplicates: 0, ignored: 0, done: false };
  const runId = await startRun(mailbox.id, "brand_backfill");
  try {
    const g = await gmailFor(mailbox);
    const ctx = await loadBrandsAndAccounts();
    const brand = ctx.brands.find((b) => b.id === brandId);
    if (!brand) throw new Error("Brand not found");
    const after = new Date(Date.now() - days * 86_400_000);
    await queryIngest(g, mailbox, gmailQueryForBrands([brand], after), ctx, stats, Date.now() + budgetMs);
    await finishRun(runId, stats);
    return stats;
  } catch (err) {
    await finishRun(runId, stats, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/** Starts / renews Gmail push notifications (only if a Pub/Sub topic is configured). */
export async function ensureWatch(mailbox: Mailbox) {
  if (!env.gmailPubsubTopic || mailbox.provider !== "gmail") return null;
  const g = await gmailFor(mailbox);
  const res = await g.users.watch({ userId: "me", requestBody: { topicName: env.gmailPubsubTopic, labelIds: ["INBOX"] } });
  const expires = res.data.expiration ? new Date(Number(res.data.expiration)).toISOString() : null;
  await supabaseAdmin().from("mailboxes").update({ watch_expires_at: expires }).eq("id", mailbox.id);
  return expires;
}

export async function syncAllMailboxes(kind: SyncKind = "incremental", budgetMs = 240_000) {
  const sb = supabaseAdmin();
  const mailboxes = must(
    await sb.from("mailboxes").select("*").eq("provider", "gmail").eq("active", true).not("refresh_token", "is", null),
    "load mailboxes",
  ) as Mailbox[];
  const results: Record<string, SyncStats | { error: string }> = {};
  const per = Math.max(30_000, Math.floor(budgetMs / Math.max(1, mailboxes.length)));
  for (const m of mailboxes) {
    if (m.status === "reauth_required") {
      results[m.email] = { error: "Reconnect required" };
      continue;
    }
    try {
      results[m.email] = await syncMailbox(m.id, kind, per);
      // Renew push watch a day before it lapses.
      if (env.gmailPubsubTopic && (!m.watch_expires_at || new Date(m.watch_expires_at).getTime() - Date.now() < 86_400_000)) {
        await ensureWatch(m).catch(() => null);
      }
    } catch (err) {
      results[m.email] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return results;
}
