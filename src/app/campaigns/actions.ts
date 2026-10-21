"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin, must } from "@/lib/supabase";

/** A human reviewed the evidence: the campaign stops being labelled as inferred. */
export async function setCampaignConfirmed(id: string, confirmed: boolean) {
  must(
    await supabaseAdmin().from("campaigns").update({ confirmed_by_user: confirmed, is_inferred: !confirmed, updated_at: new Date().toISOString() }).eq("id", id),
    "confirm campaign",
  );
  revalidatePath(`/campaigns/${id}`);
}

export async function renameCampaign(id: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  must(await supabaseAdmin().from("campaigns").update({ title, updated_at: new Date().toISOString() }).eq("id", id), "rename campaign");
  revalidatePath(`/campaigns/${id}`);
}
