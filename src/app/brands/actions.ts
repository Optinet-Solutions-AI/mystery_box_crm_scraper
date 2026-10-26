"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { insertBrand, normalizeDomain } from "@/lib/brands";
import { backfillBrand } from "@/lib/gmail/sync";
import { processPending } from "@/lib/pipeline";
import { supabaseAdmin, must } from "@/lib/supabase";

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
  const id = await insertBrand({
    name: str(formData.get("name")),
    domain: String(formData.get("domain") ?? ""),
    signupUrl: str(formData.get("signup_url")),
    industryId: str(formData.get("industry_id")),
    country: str(formData.get("country")),
    senderDomains: list(formData.get("sender_domains")),
  });
  revalidatePath("/brands");
  redirect(`/brands/${id}?new=1`);
}

/**
 * Confirms a detected signup: it becomes a tracked brand with a test account
 * (day 0 = first welcome email), and its past emails are pulled in and analyzed.
 */
export async function confirmCandidate(candidateId: string, formData: FormData) {
  const sb = supabaseAdmin();
  const c = must(await sb.from("brand_candidates").select("*").eq("id", candidateId).single(), "load candidate") as {
    id: string;
    domain: string;
    mailbox_id: string | null;
    signup_detected_at: string | null;
    first_seen_at: string | null;
    ai_brand_name: string | null;
    display_name: string | null;
    ai_website: string | null;
  };
  const website = normalizeDomain(str(formData.get("domain")) ?? c.ai_website ?? c.domain);
  const existing = (await sb.from("brands").select("id").eq("domain", website).maybeSingle()).data;
  const brandId =
    existing?.id ??
    (await insertBrand({
      name: str(formData.get("name")) ?? c.ai_brand_name ?? c.display_name,
      domain: website,
      industryId: str(formData.get("industry_id")),
      senderDomains: [c.domain],
    }));
  if (existing) {
    const b = (await sb.from("brands").select("sender_domains").eq("id", brandId).single()).data as { sender_domains: string[] };
    if (website !== c.domain && !b.sender_domains.includes(c.domain)) {
      await sb.from("brands").update({ sender_domains: [...b.sender_domains, c.domain] }).eq("id", brandId);
    }
  }

  const mailbox = c.mailbox_id ? ((await sb.from("mailboxes").select("id, email").eq("id", c.mailbox_id).maybeSingle()).data as { id: string; email: string } | null) : null;
  if (mailbox) {
    await sb.from("test_accounts").upsert(
      {
        brand_id: brandId,
        mailbox_id: mailbox.id,
        email: mailbox.email,
        persona: "default",
        status: "registered",
        signup_method: "detected",
        registered_at: c.signup_detected_at ?? c.first_seen_at,
        notes: "Signed up outside the tool; detected from the inbox and confirmed.",
      },
      { onConflict: "brand_id,email,persona", ignoreDuplicates: true },
    );
  }
  await sb.from("brand_candidates").update({ status: "confirmed", brand_id: brandId, updated_at: new Date().toISOString() }).eq("id", c.id);

  // Pull in and analyze this brand's past emails after responding.
  if (mailbox) {
    after(async () => {
      await backfillBrand(mailbox.id, brandId, 365, 200_000).catch(() => null);
      await processPending({ limit: 30, budgetMs: 80_000 }).catch(() => null);
    });
  }
  revalidatePath("/brands");
  redirect(`/brands/${brandId}?confirmed=1`);
}

export async function dismissCandidate(candidateId: string) {
  must(
    await supabaseAdmin().from("brand_candidates").update({ status: "dismissed", updated_at: new Date().toISOString() }).eq("id", candidateId),
    "dismiss candidate",
  );
  revalidatePath("/brands");
}

export async function restoreCandidate(candidateId: string) {
  must(
    await supabaseAdmin().from("brand_candidates").update({ status: "pending", updated_at: new Date().toISOString() }).eq("id", candidateId),
    "restore candidate",
  );
  revalidatePath("/brands");
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
