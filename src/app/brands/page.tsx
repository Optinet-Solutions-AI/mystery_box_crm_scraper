import Link from "next/link";
import { db, must } from "@/lib/supabase";
import { brandColor } from "@/lib/data";
import { fmtAgo } from "@/lib/format";
import type { Brand, Industry, TestAccount } from "@/lib/types";
import { Badge, BrandChip, buttonClass, Card, EmptyState, Field, inputClass, PageHeader, Table } from "@/components/ui";
import { createBrand } from "./actions";
import { SignupButton } from "./signup-button";
import { DetectedSignups, type Candidate } from "./detected-signups";

// Confirming a detected signup backfills its emails in the background.
export const maxDuration = 300;

export default async function BrandsPage() {
  const sb = await db();
  const [brands, industries, accounts, counts, candidates, mailboxCount] = await Promise.all([
    sb.from("brands").select("*").order("created_at").then((r) => must(r) as Brand[]),
    sb.from("industries").select("*").order("name").then((r) => must(r) as Industry[]),
    sb.from("test_accounts").select("*").then((r) => must(r) as TestAccount[]),
    sb.from("emails").select("brand_id, sent_at, is_promotional").order("sent_at", { ascending: false }).limit(5000).then((r) => (r.data ?? []) as { brand_id: string; sent_at: string; is_promotional: boolean | null }[]),
    sb.from("brand_candidates").select("*").neq("status", "confirmed").order("signup_detected_at", { ascending: false, nullsFirst: false }).limit(100).then((r) => (r.data ?? []) as Candidate[]),
    sb.from("mailboxes").select("id", { count: "exact", head: true }).eq("provider", "gmail").not("refresh_token", "is", null).then((r) => r.count ?? 0),
  ]);

  return (
    <>
      <PageHeader
        title="Brands"
        description="Competitors you track. Sign up to any operator with the research Gmail — here or directly on their site — and confirm it under Detected signups. Only confirmed brands appear on the dashboards."
      />

      <DetectedSignups candidates={candidates} brands={brands} industries={industries} hasMailbox={mailboxCount > 0} />

      <Card title="Add a brand manually" className="mb-6">
        <form action={createBrand} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <Field label="Website domain">
            <input name="domain" required placeholder="brandname.com" className={inputClass} />
          </Field>
          <Field label="Name (optional)">
            <input name="name" placeholder="Brand Name" className={inputClass} />
          </Field>
          <Field label="Signup URL (optional)">
            <input name="signup_url" placeholder="https://brandname.com/signup" className={inputClass} />
          </Field>
          <Field label="Industry">
            <select name="industry_id" className={inputClass} defaultValue="mystery_box">
              {industries.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </Field>
          <button className={buttonClass}>Add brand</button>
        </form>
      </Card>

      {brands.length === 0 ? (
        <EmptyState title="No brands yet">Add the first competitor above.</EmptyState>
      ) : (
        <Card bodyClassName="p-0">
          <Table head={["Brand", "Industry", "Test accounts", "Emails", "Last email", ""]}>
            {brands.map((b, i) => {
              const acc = accounts.filter((a) => a.brand_id === b.id);
              const emails = counts.filter((c) => c.brand_id === b.id);
              const registered = acc.filter((a) => a.status === "registered");
              return (
                <tr key={b.id} className="align-middle">
                  <td className="px-3 py-2.5">
                    <BrandChip name={b.name} color={brandColor(b, i)} logo={b.logo_url} href={`/brands/${b.id}`} />
                    <div className="text-xs text-muted">{b.domain}</div>
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">{industries.find((x) => x.id === b.industry_id)?.name ?? b.industry_id}</td>
                  <td className="px-3 py-2.5">
                    {registered.length ? (
                      <Badge tone="good">✓ {registered.length} registered</Badge>
                    ) : (
                      <Badge tone="warn">! Not signed up</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {emails.length}
                    <span className="text-xs text-muted"> ({emails.filter((e) => e.is_promotional).length} promo)</span>
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">{fmtAgo(emails[0]?.sent_at)}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <SignupButton url={b.signup_url ?? `https://${b.domain}`} brandId={b.id} compact />
                    <Link href={`/brands/${b.id}`} className="ml-3 text-sm text-accent hover:underline">
                      Open
                    </Link>
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}
    </>
  );
}
