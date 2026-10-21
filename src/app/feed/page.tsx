import Link from "next/link";
import clsx from "clsx";
import { Badge, Card, EmptyState, PageHeader, secondaryButtonClass } from "@/components/ui";
import { label } from "@/lib/constants";
import type { SearchParams } from "@/lib/data";
import { fmtAgo, fmtDateTime } from "@/lib/format";
import { db, must } from "@/lib/supabase";
import type { AlertRule, Brand, Insight } from "@/lib/types";
import { deleteRule, markAllRead, markRead, toggleRule } from "./actions";
import { RuleForm } from "./rule-form";

const KINDS = ["new_campaign", "new_category", "new_offer", "volume_change", "offer_expiring", "ai_finding"];
const SEVERITIES = ["important", "notable", "info"] as const;

const RULE_LABELS: Record<string, string> = {
  new_campaign: "New campaign",
  new_offer: "New offer / incentive type",
  offer_expiring: "Offer expiring",
  volume_spike: "Volume change",
  keyword: "Keyword",
  any: "Any feed item",
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function FeedPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const kind = one(sp.kind);
  const severity = one(sp.severity);
  const unread = one(sp.unread) === "1";

  const sb = await db();
  let q = sb.from("insights").select("*").order("created_at", { ascending: false }).limit(200);
  if (kind) q = q.eq("kind", kind);
  if (severity) q = q.eq("severity", severity);
  if (unread) q = q.eq("read", false);
  const [insights, rules, brands] = await Promise.all([
    q.then((r) => must(r, "load insights") as Insight[]),
    sb.from("alert_rules").select("*").order("created_at").then((r) => must(r, "load rules") as AlertRule[]),
    sb.from("brands").select("id, name").order("name").then((r) => must(r, "load brands") as Pick<Brand, "id" | "name">[]),
  ]);
  const brandName = new Map(brands.map((b) => [b.id, b.name]));

  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(kind && { kind }), ...(severity && { severity }), ...(unread && { unread: "1" }), ...patch });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/feed${p.toString() ? `?${p}` : ""}`;
  };
  const chip = (active: boolean) =>
    clsx("rounded-md border px-2 py-1 text-xs", active ? "border-accent/40 bg-accent/10 text-accent" : "border-line text-ink-2 hover:bg-surface-2");

  return (
    <>
      <PageHeader
        title="Feed & alerts"
        description="Every new campaign, offer and change the system detects, newest first. Alert rules send matching items to a webhook."
        actions={
          <form action={markAllRead}>
            <button className={secondaryButtonClass}>Mark all read</button>
          </form>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <Link href={href({ kind: "" })} className={chip(!kind)}>
              All types
            </Link>
            {KINDS.map((k) => (
              <Link key={k} href={href({ kind: k })} className={chip(kind === k)}>
                {k === "ai_finding" ? "AI finding" : label(k)}
              </Link>
            ))}
            <span className="mx-1 h-4 w-px bg-line" />
            {SEVERITIES.map((s) => (
              <Link key={s} href={href({ severity: severity === s ? "" : s })} className={chip(severity === s)}>
                {label(s)}
              </Link>
            ))}
            <Link href={href({ unread: unread ? "" : "1" })} className={chip(unread)}>
              Unread only
            </Link>
          </div>

          {insights.length === 0 ? (
            <EmptyState title="No feed items">
              Items appear as emails are analyzed. Volume changes and expiring offers are added by the scheduled job or the
              dashboard&apos;s Generate summary button.
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {insights.map((i) => (
                <li
                  key={i.id}
                  id={i.id}
                  className={clsx("scroll-mt-6 rounded-xl border bg-surface p-4 target:border-accent", i.read ? "border-line" : "border-accent/30")}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    {!i.read && <span className="h-2 w-2 rounded-full bg-accent" aria-label="Unread" />}
                    <Badge>{i.kind === "ai_finding" ? "AI finding" : label(i.kind)}</Badge>
                    {i.severity !== "info" && <Badge tone={i.severity === "important" ? "accent" : "neutral"}>{label(i.severity)}</Badge>}
                    {i.brand_ids.map((b) => (
                      <span key={b} className="text-ink-2">
                        {brandName.get(b) ?? "Removed brand"}
                      </span>
                    ))}
                    <span title={fmtDateTime(i.created_at)}>{fmtAgo(i.created_at)}</span>
                  </div>
                  <p className="mt-1.5 text-sm font-medium text-ink">{i.title}</p>
                  {i.body && <p className="mt-1 text-sm text-ink-2">{i.body}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {i.campaign_ids.map((id, n) => (
                      <Link key={id} href={`/campaigns/${id}`} className="text-accent hover:underline">
                        Campaign {n + 1}
                      </Link>
                    ))}
                    {i.email_ids.map((id, n) => (
                      <Link key={id} href={`/emails/${id}`} className="text-accent hover:underline">
                        Email {n + 1}
                      </Link>
                    ))}
                    {i.offer_ids.length > 0 && <span className="text-muted">{i.offer_ids.length} offer(s)</span>}
                    <form action={markRead.bind(null, i.id, !i.read)} className="ml-auto">
                      <button className="text-muted hover:text-ink">{i.read ? "Mark unread" : "Mark read"}</button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Alert rules" subtitle="Matching feed items are posted to the rule's webhook">
            {rules.length === 0 ? (
              <p className="text-sm text-muted">No rules yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {rules.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
                    <div className="min-w-0">
                      <p className={clsx("text-sm font-medium", r.active ? "text-ink" : "text-muted line-through")}>{r.name}</p>
                      <p className="text-xs text-ink-2">
                        {RULE_LABELS[r.rule_type] ?? r.rule_type}
                        {r.rule_type === "volume_spike" && ` ≥ ${String(r.params.threshold_pct ?? 50)}%`}
                        {r.rule_type === "keyword" && ` "${String(r.params.keyword ?? "")}"`}
                        {" · "}
                        {r.brand_id ? (brandName.get(r.brand_id) ?? "Removed brand") : "All brands"}
                      </p>
                      <p className="truncate text-xs text-muted">{r.webhook_url ? r.webhook_url.replace(/^(https:\/\/[^/]+).*/, "$1/…") : "No webhook (feed only)"}</p>
                    </div>
                    <div className="flex shrink-0 gap-2 text-xs">
                      <form action={toggleRule.bind(null, r.id, !r.active)}>
                        <button className="text-ink-2 hover:text-ink">{r.active ? "Pause" : "Resume"}</button>
                      </form>
                      <form action={deleteRule.bind(null, r.id)}>
                        <button className="text-bad hover:underline">Delete</button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="New alert rule">
            <RuleForm brands={brands} />
          </Card>
        </div>
      </div>
    </>
  );
}
