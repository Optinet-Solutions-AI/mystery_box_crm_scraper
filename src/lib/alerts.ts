import "server-only";
import { env } from "./env";
import { supabaseAdmin } from "./supabase";
import type { AlertRule, Insight } from "./types";

type NewInsight = Omit<Insight, "id" | "created_at" | "read" | "body" | "data" | "email_ids" | "campaign_ids" | "offer_ids" | "brand_ids" | "dedupe_key" | "period_start" | "period_end" | "severity"> &
  Partial<Pick<Insight, "body" | "data" | "email_ids" | "campaign_ids" | "offer_ids" | "brand_ids" | "dedupe_key" | "period_start" | "period_end" | "severity">>;

/** Inserts a feed item (skips silently if one with the same dedupe_key exists) and fires matching alert webhooks. */
export async function recordInsight(insight: NewInsight): Promise<string | null> {
  const sb = supabaseAdmin();
  const res = await sb
    .from("insights")
    .upsert({ severity: "info", ...insight }, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select("id");
  const id = res.data?.[0]?.id ?? null;
  if (id) await fireAlerts({ ...insight, id }).catch(() => null);
  return id;
}

function ruleMatches(rule: AlertRule, insight: NewInsight & { id: string }): boolean {
  if (!rule.active) return false;
  if (rule.brand_id && !(insight.brand_ids ?? []).includes(rule.brand_id)) return false;
  switch (rule.rule_type) {
    case "new_campaign":
      return insight.kind === "new_campaign";
    case "new_offer":
      return insight.kind === "new_offer" || insight.kind === "new_category";
    case "offer_expiring":
      return insight.kind === "offer_expiring";
    case "volume_spike": {
      if (insight.kind !== "volume_change") return false;
      const threshold = Number(rule.params.threshold_pct ?? 50);
      return Math.abs(Number((insight.data as Record<string, unknown>)?.change_pct ?? 0)) >= threshold;
    }
    case "keyword": {
      const kw = String(rule.params.keyword ?? "").toLowerCase();
      return !!kw && `${insight.title} ${insight.body ?? ""}`.toLowerCase().includes(kw);
    }
    case "any":
      return true;
    default:
      return false;
  }
}

async function fireAlerts(insight: NewInsight & { id: string }) {
  const rules = (await supabaseAdmin().from("alert_rules").select("*").eq("active", true)).data as AlertRule[] | null;
  for (const rule of rules ?? []) {
    if (!rule.webhook_url || !ruleMatches(rule, insight)) continue;
    const link = `${env.appUrl}/feed#${insight.id}`;
    // Slack-compatible payload ("text"), plus structured fields for other receivers.
    await fetch(rule.webhook_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: `*${rule.name}*: ${insight.title}${insight.body ? `\n${insight.body}` : ""}\n${link}`,
        rule: rule.name,
        insight: { ...insight, link },
      }),
    }).catch(() => null);
  }
}
