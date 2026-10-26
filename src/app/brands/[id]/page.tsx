import Link from "next/link";
import { notFound } from "next/navigation";
import { db, must } from "@/lib/supabase";
import { categoriesOf } from "@/lib/data";
import { fmtAgo, fmtDate, fmtDateTime } from "@/lib/format";
import type { Brand, Campaign, EmailAnalysis, Industry, Mailbox, TestAccount } from "@/lib/types";
import { ApiButton } from "@/components/api-button";
import { LocalDateTimeInput } from "@/components/local-datetime";
import { Badge, buttonClass, Card, CategoryBadge, EmptyState, Field, inputClass, PageHeader, secondaryButtonClass, Table } from "@/components/ui";
import { deleteBrand, deleteTestAccount, registerTestAccount, updateBrand, updateTestAccount } from "../actions";
import { SignupButton } from "../signup-button";

type EmailListRow = { id: string; subject: string | null; sent_at: string | null; email_type: string | null; is_promotional: boolean | null; processing_status: string; campaign_id: string | null; to_email: string | null };

export default async function BrandPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const sb = await db();
  const brand = (await sb.from("brands").select("*").eq("id", id).maybeSingle()).data as Brand | null;
  if (!brand) notFound();

  const [industries, accounts, mailboxes, emails, campaigns] = await Promise.all([
    sb.from("industries").select("*").order("name").then((r) => must(r) as Industry[]),
    sb.from("test_accounts").select("*").eq("brand_id", id).order("created_at").then((r) => must(r) as TestAccount[]),
    sb.from("mailboxes").select("id, email, provider, status").then((r) => must(r) as Pick<Mailbox, "id" | "email" | "provider" | "status">[]),
    sb
      .from("emails")
      .select("id, subject, sent_at, email_type, is_promotional, processing_status, campaign_id, to_email")
      .eq("brand_id", id)
      .order("sent_at", { ascending: false })
      .limit(25)
      .then((r) => must(r) as EmailListRow[]),
    sb.from("campaigns").select("*").eq("brand_id", id).order("last_seen_at", { ascending: false }).limit(10).then((r) => must(r) as Campaign[]),
  ]);
  const analyses = emails.length
    ? (must(await sb.from("email_analyses").select("email_id, categories, industry_categories, manual_categories").in("email_id", emails.map((e) => e.id))) as EmailAnalysis[])
    : [];
  const analysisBy = new Map(analyses.map((a) => [a.email_id, a]));
  const gmailBoxes = mailboxes.filter((m) => m.provider === "gmail");
  const defaultEmail = gmailBoxes[0]?.email ?? "";
  const highlight = sp.signup === "1";

  return (
    <>
      <PageHeader
        title={brand.name}
        description={
          <>
            <a href={brand.website_url ?? `https://${brand.domain}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              {brand.domain}
            </a>{" "}
            · {industries.find((i) => i.id === brand.industry_id)?.name}
            {brand.country ? ` · ${brand.country}` : ""}
          </>
        }
        actions={
          <>
            <SignupButton url={brand.signup_url ?? `https://${brand.domain}`} brandId={brand.id} />
            {gmailBoxes[0] && (
              <ApiButton endpoint="/api/sync" body={{ mailboxId: gmailBoxes[0].id, brandId: brand.id, days: 365 }} describe="sync">
                Backfill this brand&apos;s emails
              </ApiButton>
            )}
          </>
        }
      />

      {sp.confirmed === "1" && (
        <div className="mb-6 rounded-xl border border-good/30 bg-good/10 p-4 text-sm text-ink">
          Signup confirmed — this brand is now tracked. Its past emails are being pulled in and analyzed in the background; refresh in a minute or two.
        </div>
      )}
      {sp.new === "1" && (
        <div className="mb-6 rounded-xl border border-accent/30 bg-accent/10 p-4 text-sm text-ink">
          Brand added. Next: click <b>Open signup window</b>, sign up with the research Google account, then confirm the registration below.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card
            title="Test accounts"
            subtitle="Each signup is day 0 for lifecycle tracking. Emails sent to the account's address are attributed to it."
          >
            {accounts.length === 0 ? (
              <p className="text-sm text-ink-2">No test account yet.</p>
            ) : (
              <div className="space-y-4">
                {accounts.map((a) => (
                  <form key={a.id} action={updateTestAccount.bind(null, a.id, brand.id)} className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-5 sm:items-end">
                    <div className="sm:col-span-2">
                      <div className="text-sm font-medium text-ink">{a.email}</div>
                      <div className="text-xs text-muted">
                        via {a.signup_method ?? "?"} · {a.mailbox_id ? "mailbox connected" : "mailbox not connected"}
                      </div>
                    </div>
                    <Field label="Registered at">
                      <LocalDateTimeInput name="registered_at" defaultIso={a.registered_at} allowEmpty />
                    </Field>
                    <Field label="Persona">
                      <input name="persona" defaultValue={a.persona} className={inputClass} />
                    </Field>
                    <div className="flex gap-2">
                      <select name="status" defaultValue={a.status} className={inputClass}>
                        <option value="pending">Pending</option>
                        <option value="registered">Registered</option>
                        <option value="closed">Closed</option>
                      </select>
                      <button className={secondaryButtonClass}>Save</button>
                    </div>
                    <div className="text-xs sm:col-span-5">
                      <Link href={`/lifecycle?accounts=${a.id}`} className="text-accent hover:underline">
                        View lifecycle →
                      </Link>
                      <button formAction={deleteTestAccount.bind(null, a.id, brand.id)} className="ml-4 text-bad hover:underline">
                        Remove
                      </button>
                    </div>
                  </form>
                ))}
              </div>
            )}
          </Card>

          <section id="register" className={highlight ? "rounded-xl ring-2 ring-accent" : ""}>
            <Card
              title="Confirm a signup"
              subtitle={
                highlight
                  ? "Finish signing up in the popup window (use “Continue with Google” with the research account), then confirm here."
                  : "Record a new test account after signing up on the brand's site."
              }
            >
              <form action={registerTestAccount.bind(null, brand.id)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
                <Field label="Email used to sign up">
                  <input name="email" required defaultValue={defaultEmail} placeholder="research@gmail.com" className={inputClass} list="mailbox-emails" />
                  <datalist id="mailbox-emails">
                    {mailboxes.map((m) => (
                      <option key={m.id} value={m.email} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Signed up at">
                  <LocalDateTimeInput name="registered_at" />
                </Field>
                <Field label="Method">
                  <select name="signup_method" className={inputClass} defaultValue="google">
                    <option value="google">Google sign-in</option>
                    <option value="email">Email + password</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <Field label="Persona">
                  <input name="persona" defaultValue="default" className={inputClass} />
                </Field>
                <button className={`${buttonClass} lg:col-start-4`}>I&apos;ve signed up</button>
              </form>
              {!gmailBoxes.length && (
                <p className="mt-3 text-xs text-muted">
                  No Gmail mailbox connected yet — <Link href="/settings" className="text-accent hover:underline">connect it in Settings</Link> so the agent can read this account&apos;s emails.
                </p>
              )}
            </Card>
          </section>

          <Card title="Recent emails" actions={<Link href={`/emails?brand=${brand.id}`} className="text-xs text-accent hover:underline">All emails →</Link>} bodyClassName="p-0">
            {emails.length === 0 ? (
              <div className="p-4">
                <EmptyState title="No emails yet">Once the test account receives mail and a sync runs, it shows up here.</EmptyState>
              </div>
            ) : (
              <Table head={["Subject", "Type", "Categories", "Sent"]}>
                {emails.map((e) => (
                  <tr key={e.id}>
                    <td className="max-w-md px-3 py-2">
                      <Link href={`/emails/${e.id}`} className="line-clamp-1 text-ink hover:underline">
                        {e.subject ?? "(no subject)"}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {e.processing_status !== "analyzed" ? (
                        <Badge>{e.processing_status}</Badge>
                      ) : (
                        <Badge tone={e.is_promotional ? "accent" : "neutral"}>{e.email_type}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {categoriesOf(analysisBy.get(e.id)).slice(0, 2).map((c) => (
                          <CategoryBadge key={c} category={c} />
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink-2">{fmtDateTime(e.sent_at)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Recent campaigns" subtitle="Inferred groupings of related emails">
            {campaigns.length === 0 ? (
              <p className="text-sm text-ink-2">None detected yet.</p>
            ) : (
              <ul className="space-y-2">
                {campaigns.map((c) => (
                  <li key={c.id}>
                    <Link href={`/campaigns/${c.id}`} className="text-sm text-ink hover:underline">
                      {c.title}
                    </Link>
                    <div className="text-xs text-muted">
                      {c.email_count} email{c.email_count === 1 ? "" : "s"} · {fmtDate(c.first_seen_at)} – {fmtDate(c.last_seen_at)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Brand settings">
            <form action={updateBrand.bind(null, brand.id)} className="space-y-3">
              <Field label="Name">
                <input name="name" defaultValue={brand.name} className={inputClass} />
              </Field>
              <Field label="Domain">
                <input name="domain" defaultValue={brand.domain} className={inputClass} />
              </Field>
              <Field label="Signup URL">
                <input name="signup_url" defaultValue={brand.signup_url ?? ""} className={inputClass} />
              </Field>
              <Field label="Website URL">
                <input name="website_url" defaultValue={brand.website_url ?? ""} className={inputClass} />
              </Field>
              <Field label="Logo URL">
                <input name="logo_url" defaultValue={brand.logo_url ?? ""} className={inputClass} />
              </Field>
              <Field label="Industry">
                <select name="industry_id" defaultValue={brand.industry_id} className={inputClass}>
                  {industries.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Country / market">
                <input name="country" defaultValue={brand.country ?? ""} placeholder="US" className={inputClass} />
              </Field>
              <Field label="Extra sending domains" hint="If the brand emails from another domain (e.g. mail.brand-news.com). Comma separated.">
                <input name="sender_domains" defaultValue={brand.sender_domains.join(", ")} className={inputClass} />
              </Field>
              <Field label="Exact sender addresses" hint="Optional, comma separated.">
                <input name="sender_emails" defaultValue={brand.sender_emails.join(", ")} className={inputClass} />
              </Field>
              <Field label="Notes">
                <textarea name="notes" defaultValue={brand.notes ?? ""} rows={2} className={inputClass} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" name="active" defaultChecked={brand.active} /> Actively tracked
              </label>
              <div className="flex items-center justify-between">
                <button className={buttonClass}>Save</button>
                <button formAction={deleteBrand.bind(null, brand.id)} className="text-sm text-bad hover:underline">
                  Delete brand
                </button>
              </div>
            </form>
          </Card>
          <p className="text-xs text-muted">Added {fmtAgo(brand.created_at)}.</p>
        </div>
      </div>
    </>
  );
}
