"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BRAND_PALETTE } from "@/lib/constants";
import { supabaseAdmin, must } from "@/lib/supabase";

function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
}

const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const str = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s || null;
};

export async function createBrand(formData: FormData) {
  const sb = supabaseAdmin();
  const domain = normalizeDomain(String(formData.get("domain") ?? ""));
  if (!domain || !domain.includes(".")) throw new Error("Enter a valid domain, e.g. brandname.com");
  const name = str(formData.get("name")) ?? domain.split(".")[0].replace(/^\w/, (c) => c.toUpperCase());
  // Next unused palette slot, in fixed order (colors follow the brand, never its rank).
  const used = new Set(((await sb.from("brands").select("color")).data ?? []).map((b) => b.color));
  const color = BRAND_PALETTE.find((c) => !used.has(c)) ?? BRAND_PALETTE[used.size % BRAND_PALETTE.length];
  const signup = str(formData.get("signup_url")) ?? `https://${domain}`;
  const created = must(
    await sb
      .from("brands")
      .insert({
        name,
        domain,
        website_url: `https://${domain}`,
        signup_url: signup.startsWith("http") ? signup : `https://${signup}`,
        industry_id: str(formData.get("industry_id")) ?? "mystery_box",
        country: str(formData.get("country")),
        sender_domains: list(formData.get("sender_domains")).map(normalizeDomain),
        color,
        logo_url: `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
      })
      .select("id")
      .single(),
    "create brand",
  ) as { id: string };
  revalidatePath("/brands");
  redirect(`/brands/${created.id}?new=1`);
}

export async function updateBrand(id: string, formData: FormData) {
  const sb = supabaseAdmin();
  must(
    await sb
      .from("brands")
      .update({
        name: str(formData.get("name")),
        domain: normalizeDomain(String(formData.get("domain") ?? "")),
        signup_url: str(formData.get("signup_url")),
        website_url: str(formData.get("website_url")),
        logo_url: str(formData.get("logo_url")),
        industry_id: str(formData.get("industry_id")) ?? "mystery_box",
        country: str(formData.get("country")),
        sender_domains: list(formData.get("sender_domains")).map(normalizeDomain),
        sender_emails: list(formData.get("sender_emails")),
        notes: str(formData.get("notes")),
        active: formData.get("active") === "on",
      })
      .eq("id", id),
    "update brand",
  );
  revalidatePath(`/brands/${id}`);
  revalidatePath("/brands");
}

export async function deleteBrand(id: string) {
  must(await supabaseAdmin().from("brands").delete().eq("id", id), "delete brand");
  revalidatePath("/brands");
  redirect("/brands");
}

/** Records that a test account was opened on the brand (day 0 of the lifecycle). */
export async function registerTestAccount(brandId: string, formData: FormData) {
  const sb = supabaseAdmin();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email.includes("@")) throw new Error("Enter the email address used to sign up");
  const registeredAt = str(formData.get("registered_at"));
  const mailbox = (await sb.from("mailboxes").select("id").eq("email", email).maybeSingle()).data;
  must(
    await sb.from("test_accounts").upsert(
      {
        brand_id: brandId,
        email,
        persona: str(formData.get("persona")) ?? "default",
        signup_method: str(formData.get("signup_method")) ?? "google",
        status: "registered",
        registered_at: registeredAt ? new Date(registeredAt).toISOString() : new Date().toISOString(),
        mailbox_id: mailbox?.id ?? null,
        notes: str(formData.get("notes")),
      },
      { onConflict: "brand_id,email,persona" },
    ),
    "register test account",
  );
  // Attach already-ingested emails sent to this address.
  const account = (await sb.from("test_accounts").select("id").eq("brand_id", brandId).eq("email", email).eq("persona", str(formData.get("persona")) ?? "default").single()).data;
  if (account) await sb.from("emails").update({ test_account_id: account.id }).eq("brand_id", brandId).eq("to_email", email).is("test_account_id", null);
  revalidatePath(`/brands/${brandId}`);
  revalidatePath("/brands");
}

export async function updateTestAccount(id: string, brandId: string, formData: FormData) {
  const registeredAt = str(formData.get("registered_at"));
  must(
    await supabaseAdmin()
      .from("test_accounts")
      .update({
        registered_at: registeredAt ? new Date(registeredAt).toISOString() : null,
        status: str(formData.get("status")) ?? "registered",
        persona: str(formData.get("persona")) ?? "default",
        notes: str(formData.get("notes")),
      })
      .eq("id", id),
    "update test account",
  );
  revalidatePath(`/brands/${brandId}`);
}

export async function deleteTestAccount(id: string, brandId: string) {
  must(await supabaseAdmin().from("test_accounts").delete().eq("id", id), "delete test account");
  revalidatePath(`/brands/${brandId}`);
}
