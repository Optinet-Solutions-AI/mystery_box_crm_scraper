"use server";

import { revalidatePath } from "next/cache";
import { refreshCampaignCounts } from "@/lib/campaigns";
import { supabaseAdmin, must } from "@/lib/supabase";

/** Manual category correction (overrides the AI's categories everywhere). */
export async function setManualCategories(emailId: string, formData: FormData) {
  const cats = formData.getAll("categories").map(String).filter(Boolean);
  must(
    await supabaseAdmin()
      .from("email_analyses")
      .update({ manual_categories: cats.length ? cats : null, updated_at: new Date().toISOString() })
      .eq("email_id", emailId),
    "save categories",
  );
  revalidatePath(`/emails/${emailId}`);
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
}

export async function removeFromCampaign(emailId: string) {
  const sb = supabaseAdmin();
  const email = (await sb.from("emails").select("campaign_id").eq("id", emailId).single()).data;
  await sb.from("emails").update({ campaign_id: null, campaign_role: null }).eq("id", emailId);
  await sb.from("offers").update({ campaign_id: null }).eq("email_id", emailId);
  if (email?.campaign_id) await refreshCampaignCounts(email.campaign_id);
  revalidatePath(`/emails/${emailId}`);
}
