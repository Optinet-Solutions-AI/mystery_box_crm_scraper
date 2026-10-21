import { headers } from "next/headers";
import { db, must } from "@/lib/supabase";
import { env } from "@/lib/env";
import { fmtAgo, fmtDateTime } from "@/lib/format";
import type { GoogleOAuthClient, Mailbox, SyncRun } from "@/lib/types";
import { ApiButton } from "@/components/api-button";
import { ConfirmButton } from "@/components/confirm-button";
import { Badge, buttonClass, Card, DefList, Field, inputClass, PageHeader, secondaryButtonClass, Table } from "@/components/ui";
import {
  createMailbox,
  createOAuthClient,
  deleteMailbox,
  deleteOAuthClient,
  disconnectMailbox,
  resetMailboxSync,
  retryFailedEmails,
  saveSyncSettings,
  updateMailbox,
  updateOAuthClient,
} from "./actions";

const STATUS: Record<Mailbox["status"], { tone: "good" | "warn" | "bad" | "neutral"; label: string }> = {
  connected: { tone: "good", label: "✓ Connected" },
  error: { tone: "bad", label: "✕ Error" },
  reauth_required: { tone: "warn", label: "! Reconnect needed" },
  disconnected: { tone: "neutral", label: "Not connected" },
};

const maskId = (id: string) => (id.length > 24 ? `${id.slice(0, 12)}…${id.slice(-28)}` : id);

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const redirectUri = `${origin}/api/gmail/callback`;

  const sb = await db();
  const [mailboxes, clients, runs, syncSetting, queue] = await Promise.all([
    sb.from("mailboxes").select("*").order("created_at").then((r) => must(r) as Mailbox[]),
    sb.from("google_oauth_clients").select("id, name, client_id, notes, created_at, updated_at").order("created_at").then((r) => must(r) as Omit<GoogleOAuthClient, "client_secret">[]),
    sb.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(15).then((r) => must(r) as SyncRun[]),
    sb.from("app_settings").select("value").eq("key", "sync").maybeSingle().then((r) => (r.data?.value as { initial_sync_days?: number }) ?? {}),
    Promise.all(
      (["pending", "error", "analyzed"] as const).map((s) =>
        sb.from("emails").select("id", { count: "exact", head: true }).eq("processing_status", s).then((r) => [s, r.count ?? 0] as const),
      ),
    ).then(Object.fromEntries) as Promise<Record<string, number>>,
  ]);
  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name;
  const hasAnyClient = clients.length > 0 || Boolean(env.envGoogleClient);

  return (
    <>
      <PageHeader title="Settings" description="Google OAuth clients, research mailboxes, sync and processing." />

      {sp.connected && (
        <div className="mb-6 rounded-xl border border-good/30 bg-good/10 p-4 text-sm text-ink">
          Connected {sp.connected}. The historical sync is running in the background — refresh in a minute.
        </div>
      )}
      {sp.notice && <div className="mb-6 rounded-xl border border-accent/30 bg-accent/10 p-4 text-sm text-ink">{sp.notice}</div>}
      {sp.error && <div className="mb-6 rounded-xl border border-bad/30 bg-bad/10 p-4 text-sm text-ink">{sp.error}</div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* ── Mailboxes ─────────────────────────────────────────── */}
          <Card
            title="Research mailboxes"
            subtitle="Any number of Gmail accounts. Access is read-only: the app only downloads emails from tracked brands and can't send, delete or mark anything as read."
          >
            <div className="space-y-3">
              {mailboxes.length === 0 && <p className="text-sm text-ink-2">No mailbox yet. Add the research Gmail below, then click Connect.</p>}
              {mailboxes.map((m) => (
                <details key={m.id} className="group rounded-lg border border-line">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 p-3">
                    <div>
                      <div className="text-sm font-medium text-ink">
                        {m.email}
                        {m.label && <span className="ml-2 text-xs font-normal text-muted">{m.label}</span>}
                      </div>
                      <div className="text-xs text-muted">
                        {m.provider === "gmail" ? `Gmail API · ${clientName(m.oauth_client_id) ?? (env.envGoogleClient ? "env OAuth client" : "no OAuth client")}` : "Forwarding"}
                        {" · "}last sync {fmtAgo(m.last_synced_at)}
                        {m.provider === "gmail" && m.refresh_token && !m.initial_sync_done && " · historical sync in progress"}
                        {!m.active && " · paused"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!m.active && <Badge>Paused</Badge>}
                      <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                      <span className="text-xs text-accent group-open:hidden">Manage ▾</span>
                    </div>
                  </summary>

                  <div className="space-y-4 border-t border-line p-3">
                    {m.last_error && <p className="text-xs text-bad">{m.last_error}</p>}
                    {m.provider === "gmail" && (
                      <div className="flex flex-wrap items-center gap-2">
                        <a href={`/api/gmail/connect?mailbox=${m.id}`} className={m.refresh_token && m.status === "connected" ? secondaryButtonClass : buttonClass}>
                          {m.refresh_token ? "Reconnect" : "Connect with Google"}
                        </a>
                        {m.refresh_token && m.status !== "reauth_required" && (
                          <ApiButton endpoint="/api/sync" body={{ mailboxId: m.id }} describe="sync">
                            Sync now
                          </ApiButton>
                        )}
                        {m.refresh_token && (
                          <form action={resetMailboxSync.bind(null, m.id)}>
                            <button className={secondaryButtonClass} title="Re-run the historical backfill (duplicates are skipped)">
                              Full re-sync
                            </button>
                          </form>
                        )}
                        {m.refresh_token && (
                          <form action={disconnectMailbox.bind(null, m.id)}>
                            <ConfirmButton message={`Disconnect ${m.email}? Collected emails are kept.`} className={secondaryButtonClass}>
                              Disconnect
                            </ConfirmButton>
                          </form>
                        )}
                      </div>
                    )}

                    <form action={updateMailbox.bind(null, m.id)} className="grid gap-3 sm:grid-cols-3 sm:items-end">
                      <Field label="Label">
                        <input name="label" defaultValue={m.label ?? ""} placeholder="e.g. Christian — US persona" className={inputClass} />
                      </Field>
                      {m.provider === "gmail" ? (
                        <Field label="OAuth client">
                          <select name="oauth_client_id" defaultValue={m.oauth_client_id ?? ""} className={inputClass}>
                            <option value="">{env.envGoogleClient ? "Env-var client (fallback)" : "— none —"}</option>
                            {clients.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                      ) : (
                        <input type="hidden" name="oauth_client_id" value="" />
                      )}
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-sm text-ink">
                          <input type="checkbox" name="active" defaultChecked={m.active} /> Sync active
                        </label>
                        <button className={secondaryButtonClass}>Save</button>
                      </div>
                    </form>

                    <form action={deleteMailbox.bind(null, m.id)} className="text-right">
                      <ConfirmButton message={`Delete mailbox ${m.email}? Emails already collected stay in the database.`}>Delete mailbox</ConfirmButton>
                    </form>
                  </div>
                </details>
              ))}
            </div>

            <form action={createMailbox} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
              <Field label="Email address">
                <input name="email" type="email" required placeholder="research@gmail.com" className={inputClass} />
              </Field>
              <Field label="Label (optional)">
                <input name="label" placeholder="Persona / note" className={inputClass} />
              </Field>
              <Field label="Type">
                <select name="provider" defaultValue="gmail" className={inputClass}>
                  <option value="gmail">Gmail (API)</option>
                  <option value="forwarding">Forwarding only</option>
                </select>
              </Field>
              <Field label="OAuth client">
                <select name="oauth_client_id" defaultValue={clients[0]?.id ?? ""} className={inputClass}>
                  <option value="">{env.envGoogleClient ? "Env-var client (fallback)" : "— none —"}</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <button className={buttonClass}>Add mailbox</button>
            </form>
            {!hasAnyClient && <p className="mt-2 text-xs text-muted">Add a Google OAuth client first (right column) so Gmail mailboxes can connect.</p>}
          </Card>

          <Card title="Sync history" bodyClassName="p-0">
            <Table head={["Started", "Mailbox", "Kind", "Status", "Fetched", "New", "Dupes", "Ignored", "Error"]}>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 whitespace-nowrap text-ink-2">{fmtDateTime(r.started_at)}</td>
                  <td className="px-3 py-2 text-ink-2">{mailboxes.find((m) => m.id === r.mailbox_id)?.email ?? "—"}</td>
                  <td className="px-3 py-2">{r.kind}</td>
                  <td className="px-3 py-2">
                    <Badge tone={r.status === "success" ? "good" : r.status === "error" ? "bad" : r.status === "partial" ? "warn" : "neutral"}>{r.status}</Badge>
                  </td>
                  <td className="px-3 py-2">{r.fetched}</td>
                  <td className="px-3 py-2">{r.inserted}</td>
                  <td className="px-3 py-2">{r.duplicates}</td>
                  <td className="px-3 py-2">{r.ignored}</td>
                  <td className="max-w-xs truncate px-3 py-2 text-xs text-bad" title={r.error ?? ""}>
                    {r.error}
                  </td>
                </tr>
              ))}
            </Table>
            {runs.length === 0 && <p className="p-4 text-sm text-ink-2">No syncs yet.</p>}
          </Card>

          <Card title="Alternative: email forwarding" subtitle="Use this if you'd rather not grant Gmail API access, or for extra research inboxes.">
            <div className="space-y-2 text-sm text-ink-2">
              <p>
                Send raw emails to <code className="rounded bg-surface-2 px-1">POST {origin}/api/ingest/forward?mailbox=&lt;address&gt;</code> with header{" "}
                <code className="rounded bg-surface-2 px-1">Authorization: Bearer $INGEST_SECRET</code>. It accepts raw MIME, JSON{" "}
                <code className="rounded bg-surface-2 px-1">{"{ raw: <base64> }"}</code>, Postmark&apos;s <code className="rounded bg-surface-2 px-1">RawEmail</code> or SendGrid&apos;s raw form field.
              </p>
              <p>
                Works with Cloudflare Email Routing + an Email Worker, Mailgun/SendGrid/Postmark inbound parsing, or a Gmail auto-forward filter. Auto-forwarding keeps the original
                sender; forwarding by hand does not, so the brand can&apos;t be matched.
              </p>
              <p>Status: {env.ingestSecret ? <Badge tone="good">✓ INGEST_SECRET set</Badge> : <Badge tone="warn">! INGEST_SECRET not set (endpoint disabled)</Badge>}</p>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          {/* ── OAuth clients ─────────────────────────────────────── */}
          <Card title="Google OAuth clients" subtitle="Each mailbox signs in through one of these. Secrets are stored encrypted.">
            <details className="mb-4 rounded-lg bg-surface-2 p-3 text-xs text-ink-2">
              <summary className="cursor-pointer font-medium text-ink">How to create one</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-4">
                <li>Google Cloud Console → new project → enable the <b>Gmail API</b>.</li>
                <li>
                  OAuth consent screen: External, add scope <code>gmail.readonly</code>, set publishing status to <b>In production</b> (in Testing, tokens expire every 7 days).
                </li>
                <li>Credentials → Create OAuth client ID → Web application.</li>
                <li>
                  Authorized redirect URI:
                  <code className="mt-1 block rounded bg-surface px-1.5 py-1 break-all text-ink select-all">{redirectUri}</code>
                  Add one per environment (localhost and the Vercel URL).
                </li>
                <li>Paste the client ID and secret below.</li>
              </ol>
            </details>

            <div className="space-y-3">
              {clients.map((c) => {
                const used = mailboxes.filter((m) => m.oauth_client_id === c.id).length;
                return (
                  <details key={c.id} className="rounded-lg border border-line">
                    <summary className="cursor-pointer list-none p-3">
                      <div className="text-sm font-medium text-ink">{c.name}</div>
                      <div className="text-xs break-all text-muted">{maskId(c.client_id)}</div>
                      <div className="text-xs text-muted">
                        {used} mailbox{used === 1 ? "" : "es"} · updated {fmtAgo(c.updated_at)}
                      </div>
                    </summary>
                    <form action={updateOAuthClient.bind(null, c.id)} className="space-y-2 border-t border-line p-3">
                      <Field label="Name">
                        <input name="name" defaultValue={c.name} className={inputClass} />
                      </Field>
                      <Field label="Client ID">
                        <input name="client_id" defaultValue={c.client_id} className={inputClass} />
                      </Field>
                      <Field label="Client secret" hint="Leave blank to keep the current secret.">
                        <input name="client_secret" type="password" autoComplete="off" placeholder="••••••••" className={inputClass} />
                      </Field>
                      <Field label="Notes">
                        <input name="notes" defaultValue={c.notes ?? ""} className={inputClass} />
                      </Field>
                      <div className="flex items-center justify-between">
                        <button className={secondaryButtonClass}>Save</button>
                        <ConfirmButton message={`Delete OAuth client “${c.name}”?`} formAction={deleteOAuthClient.bind(null, c.id)}>
                          Delete
                        </ConfirmButton>
                      </div>
                    </form>
                  </details>
                );
              })}
              {env.envGoogleClient && <p className="text-xs text-muted">Also available: the client from GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env vars (fallback).</p>}
            </div>

            <form action={createOAuthClient} className="mt-4 space-y-2 border-t border-line pt-4">
              <Field label="Name">
                <input name="name" placeholder="e.g. Optinet research project" className={inputClass} />
              </Field>
              <Field label="Client ID">
                <input name="client_id" required placeholder="xxxx.apps.googleusercontent.com" className={inputClass} />
              </Field>
              <Field label="Client secret">
                <input name="client_secret" type="password" required autoComplete="off" className={inputClass} />
              </Field>
              <button className={buttonClass}>Add OAuth client</button>
            </form>
          </Card>

          <Card title="AI processing">
            <DefList
              items={[
                ["Model", env.hasAI ? env.aiModel : <Badge key="m" tone="warn">! No OPENAI_API_KEY — using basic keyword rules</Badge>],
                ["Queued", queue.pending ?? 0],
                ["Analyzed", queue.analyzed ?? 0],
                ["Failed", queue.error ?? 0],
              ]}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <ApiButton endpoint="/api/process" primary describe="sync">
                Analyze queued emails
              </ApiButton>
              {(queue.error ?? 0) > 0 && (
                <form action={retryFailedEmails}>
                  <button className={secondaryButtonClass}>Retry failed</button>
                </form>
              )}
            </div>
          </Card>

          <Card title="Sync settings">
            <form action={saveSyncSettings} className="space-y-3">
              <Field label="Historical sync window (days)" hint="How far back the first sync looks for emails from tracked brands.">
                <input name="initial_sync_days" type="number" min={1} max={3650} defaultValue={syncSetting.initial_sync_days ?? 90} className={inputClass} />
              </Field>
              <button className={buttonClass}>Save</button>
            </form>
          </Card>

          <Card title="Ongoing sync">
            <div className="space-y-2 text-sm text-ink-2">
              <p>
                Scheduled: <code className="rounded bg-surface-2 px-1">GET /api/cron/sync</code> with <code className="rounded bg-surface-2 px-1">Authorization: Bearer $CRON_SECRET</code>.{" "}
                {env.cronSecret ? <Badge tone="good">✓ CRON_SECRET set</Badge> : <Badge tone="warn">! CRON_SECRET not set</Badge>}
              </p>
              <p>
                Near-real-time (optional): Gmail push via Pub/Sub.{" "}
                {env.gmailPubsubTopic ? <Badge tone="good">✓ Topic configured</Badge> : <Badge>Not configured</Badge>}
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
