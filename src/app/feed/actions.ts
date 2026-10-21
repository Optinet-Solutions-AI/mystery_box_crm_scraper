"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";

const RULE_TYPES = ["new_campaign", "new_offer", "offer_expiring", "volume_spike", "keyword", "any"] as const;

export async function markRead(id: string, read = true) {
  await supabaseAdmin().from("insights").update({ read }).eq("id", id);
  revalidatePath("/feed");
}

export async function markAllRead() {
  await supabaseAdmin().from("insights").update({ read: true }).eq("read", false);
  revalidatePath("/feed");
}

export async function createRule(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const ruleType = String(formData.get("rule_type") ?? "");
  if (!name || !(RULE_TYPES as readonly string[]).includes(ruleType)) return;
  const brandId = String(formData.get("brand_id") ?? "") || null;
  const webhook = String(formData.get("webhook_url") ?? "").trim() || null;
  if (webhook && !/^https:\/\//i.test(webhook)) return;
  const params: Record<string, unknown> = {};
  if (ruleType === "volume_spike") params.threshold_pct = Math.max(1, Number(formData.get("threshold_pct") ?? 50) || 50);
  if (ruleType === "keyword") {
    const kw = String(formData.get("keyword") ?? "").trim();
    if (!kw) return;
    params.keyword = kw;
  }
  await supabaseAdmin().from("alert_rules").insert({ name, rule_type: ruleType, brand_id: brandId, params, webhook_url: webhook });
  revalidatePath("/feed");
}

export async function toggleRule(id: string, active: boolean) {
  await supabaseAdmin().from("alert_rules").update({ active }).eq("id", id);
  revalidatePath("/feed");
}

export async function deleteRule(id: string) {
  await supabaseAdmin().from("alert_rules").delete().eq("id", id);
  revalidatePath("/feed");
}
