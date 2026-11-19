"use server";

import { revalidatePath, refresh } from "next/cache";
import { refreshCampaignCounts } from "@/lib/campaigns";
import { supabaseAdmin, must } from "@/lib/supabase";

/** Manual category correction (overrides the AI's categories everywhere). */
export async function setManualCategories(emailId: string, formData: FormData) {
  const cats = formData.getAll("categories").map(String).filter(Boolean);
  // Saving the AI's own set again isn't a correction: clear it so the badge goes away.
  const ai = (await supabaseAdmin().from("email_analyses").select("categories, industry_categories").eq("email_id", emailId).maybeSingle()).data as
    | { categories: string[]; industry_categories: string[] }
    | null;
  const aiSet = new Set([...(ai?.categories ?? []), ...(ai?.industry_categories ?? [])]);
  const sameAsAI = cats.length === aiSet.size && cats.every((c) => aiSet.has(c));
  must(
    await supabaseAdmin()
      .from("email_analyses")
      .update({ manual_categories: cats.length && !sameAsAI ? cats : null, updated_at: new Date().toISOString() })
      .eq("email_id", emailId),
    "save categories",
  );
  revalidatePath(`/emails/${emailId}`);
  refresh();
}

/** Manual override: promotional vs not (e.g. a receipt the AI called promotional). */
export async function setPromotional(emailId: string, promotional: boolean) {
  const sb = supabaseAdmin();
  const email = (await sb.from("emails").select("campaign_id").eq("id", emailId).single()).data;
  must(
    await sb
      .from("emails")
      .update({
        is_promotional: promotional,
        email_type: promotional ? "promotional" : "transactional",
        ...(promotional ? {} : { campaign_id: null, campaign_role: null }),
      })
      .eq("id", emailId),
    "update email",
  );
  if (!promotional && email?.campaign_id) await refreshCampaignCounts(email.campaign_id);
  revalidatePath(`/emails/${emailId}`);
  refresh();
}

export async function removeFromCampaign(emailId: string) {
  const sb = supabaseAdmin();
  const email = (await sb.from("emails").select("campaign_id").eq("id", emailId).single()).data;
  await sb.from("emails").update({ campaign_id: null, campaign_role: null }).eq("id", emailId);
  await sb.from("offers").update({ campaign_id: null }).eq("email_id", emailId);
  if (email?.campaign_id) await refreshCampaignCounts(email.campaign_id);
  revalidatePath(`/emails/${emailId}`);
  refresh();
}
