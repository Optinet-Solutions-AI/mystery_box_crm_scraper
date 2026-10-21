"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin, must } from "@/lib/supabase";
import type { RecordedEvent } from "@/lib/types";

function parseLocalDateTime(v: FormDataEntryValue | null): string | null {
  if (!v || typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Records a manual action on a test account (deposit, purchase, login...). Never inferred. */
export async function addRecordedEvent(formData: FormData) {
  const accountId = String(formData.get("account_id") ?? "");
  const type = String(formData.get("type") ?? "").trim();
  const at = parseLocalDateTime(formData.get("at"));
  const note = String(formData.get("note") ?? "").trim();
  if (!accountId || !type || !at) return;

  const sb = supabaseAdmin();
  const acc = must(await sb.from("test_accounts").select("recorded_events").eq("id", accountId).single(), "load account") as {
    recorded_events: RecordedEvent[] | null;
  };
  const events = [...(acc.recorded_events ?? []), { type, at, ...(note ? { note } : {}) }].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
  must(await sb.from("test_accounts").update({ recorded_events: events }).eq("id", accountId).select("id"), "save event");
  revalidatePath("/lifecycle");
}

export async function removeRecordedEvent(formData: FormData) {
  const accountId = String(formData.get("account_id") ?? "");
  const index = Number(formData.get("index"));
  if (!accountId || !Number.isInteger(index)) return;
  const sb = supabaseAdmin();
  const acc = must(await sb.from("test_accounts").select("recorded_events").eq("id", accountId).single(), "load account") as {
    recorded_events: RecordedEvent[] | null;
  };
  const events = [...(acc.recorded_events ?? [])];
  events.splice(index, 1);
  must(await sb.from("test_accounts").update({ recorded_events: events }).eq("id", accountId).select("id"), "save events");
  revalidatePath("/lifecycle");
}

/** Sets or corrects the signup time (lifecycle day 0). */
export async function updateRegisteredAt(formData: FormData) {
  const accountId = String(formData.get("account_id") ?? "");
  const at = parseLocalDateTime(formData.get("registered_at"));
  if (!accountId) return;
  must(
    await supabaseAdmin()
      .from("test_accounts")
      .update({ registered_at: at, ...(at ? { status: "registered" } : {}) })
      .eq("id", accountId)
      .select("id"),
    "update registration",
  );
  revalidatePath("/lifecycle");
}
