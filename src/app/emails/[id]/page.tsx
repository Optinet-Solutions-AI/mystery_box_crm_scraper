import Link from "next/link";
import { notFound } from "next/navigation";
import { db, must } from "@/lib/supabase";
import { categoriesOf } from "@/lib/data";
import { CATEGORIES, label } from "@/lib/constants";
import { fmtDateTime } from "@/lib/format";
import { safePreviewHtml } from "@/lib/email/preview";
import type { Brand, Campaign, Email, EmailAnalysis, Industry, Offer, TestAccount } from "@/lib/types";
import { ApiButton } from "@/components/api-button";
import { Badge, Card, CategoryBadge, DefList, PageHeader, secondaryButtonClass } from "@/components/ui";
import { OfferCard } from "@/components/offer-card";
import { removeFromCampaign, setManualCategories, setPromotional } from "../actions";

const list = (xs: string[] | null | undefined) => (xs && xs.length ? xs.join(", ") : null);

export default async function EmailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const sb = await db();
  const email = (await sb.from("emails").select("*").eq("id", id).maybeSingle()).data as Email | null;
  if (!email) notFound();

  const [brand, analysis, offers, campaign, account] = await Promise.all([
    email.brand_id ? sb.from("brands").select("*").eq("id", email.brand_id).single().then((r) => r.data as Brand) : null,
    sb.from("email_analyses").select("*").eq("email_id", id).maybeSingle().then((r) => r.data as EmailAnalysis | null),
    sb.from("offers").select("*").eq("email_id", id).then((r) => must(r) as Offer[]),
    email.campaign_id ? sb.from("campaigns").select("*").eq("id", email.campaign_id).single().then((r) => r.data as Campaign) : null,
    email.test_account_id ? sb.from("test_accounts").select("*").eq("id", email.test_account_id).single().then((r) => r.data as TestAccount) : null,
  ]);
  const industry = brand ? ((await sb.from("industries").select("*").eq("id", brand.industry_id).maybeSingle()).data as Industry | null) : null;
  const loadImages = sp.images === "1";
  const preview = email.html_body ? safePreviewHtml(email.html_body, email.images, loadImages) : null;
  const cats = categoriesOf(analysis);
  const contentImages = email.images.filter((i) => !i.is_tracking);
  const dayN =
    account?.registered_at && email.sent_at
      ? Math.floor((new Date(email.sent_at).getTime() - new Date(account.registered_at).getTime()) / 86_400_000)
      : null;

  return (
    <>
      <PageHeader
        title={email.subject ?? "(no subject)"}
        description={
          <>
            {brand && (
              <Link href={`/brands/${brand.id}`} className="text-accent hover:underline">
                {brand.name}
              </Link>
            )}{" "}
            · {fmtDateTime(email.sent_at)}
            {dayN != null && ` · day ${dayN} after signup`}
          </>
        }
        actions={
          <ApiButton endpoint="/api/process" body={{ emailId: email.id }}>
            Re-analyze
          </ApiButton>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card
            title="Original email"
            subtitle={loadImages ? "Remote images loaded (this can register an open with the sender)." : "Remote images and tracking pixels are blocked so viewing doesn't count as an open."}
            actions={
              <Link href={loadImages ? `/emails/${id}` : `/emails/${id}?images=1`} className="text-xs text-accent hover:underline">
                {loadImages ? "Block images" : "Load images"}
              </Link>
            }
            bodyClassName="p-0"
          >
            {preview ? (
              <iframe
                title="Email preview"
                srcDoc={preview}
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                className="h-[900px] w-full rounded-b-xl bg-white"
              />
            ) : (
              <pre className="max-h-[900px] overflow-auto p-4 text-sm whitespace-pre-wrap text-ink">{email.text_body ?? "(empty)"}</pre>
            )}
          </Card>

          <Card title="Email details">
            <DefList
              items={[
                ["From", `${email.from_name ?? ""} <${email.from_email ?? ""}>`],
                ["Sender domain", email.from_domain],
                ["Reply-to", email.reply_to],
                ["To", email.to_email],
                ["Test account", account ? `${account.email} (${account.persona})` : null],
                ["Preview text", email.preview_text],
                ["Sent", fmtDateTime(email.sent_at)],
                ["Received", fmtDateTime(email.received_at)],
                ["Promo codes (pattern match)", list(email.promo_codes)],
                [
                  "Unsubscribe",
                  email.unsubscribe_url ? (
                    <span className="break-all text-xs" key="u">
                      {email.unsubscribe_url}
                    </span>
                  ) : null,
                ],
                ["Source", `${email.source}${email.match_method ? ` · matched by ${email.match_method.replace("_", " ")}` : ""}`],
                ["Gmail message / thread ID", email.gmail_message_id ? `${email.gmail_message_id} / ${email.gmail_thread_id}` : null],
                ["Attachments", email.attachments.length ? email.attachments.map((a) => `${a.filename} (${Math.round(a.size / 1024)} KB)`).join(", ") : null],
              ]}
            />
          </Card>

          <Card title={`Calls to action (${email.cta_links.length})`}>
            {email.cta_links.length === 0 ? (
              <p className="text-sm text-muted">None detected.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {email.cta_links.map((l, i) => (
                  <li key={i}>
                    <span className="font-medium text-ink">{l.text}</span>
                    <span className="block truncate text-xs text-muted" title={l.url}>
                      {l.url}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {contentImages.length > 0 && (
            <Card title={`Promotional images (${contentImages.length})`} subtitle="Image URLs as sent. Shown only when images are loaded.">
              {loadImages ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {contentImages.slice(0, 24).map((img, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={img.src} alt={img.alt} className="h-32 w-full rounded-md border border-line object-contain" referrerPolicy="no-referrer" />
                  ))}
                </div>
              ) : (
                <ul className="space-y-1 text-xs text-ink-2">
                  {contentImages.slice(0, 15).map((img, i) => (
                    <li key={i} className="truncate" title={img.src}>
                      {img.alt || "(no alt text)"} — {img.src}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card
            title="AI analysis"
            subtitle={analysis ? `${analysis.model === "heuristic" ? "Keyword rules (no AI key)" : analysis.model} · confidence ${Math.round(Number(analysis.confidence ?? 0) * 100)}%` : undefined}
          >
            {!analysis ? (
              <p className="text-sm text-ink-2">
                Not analyzed yet ({email.processing_status}
                {email.processing_error ? `: ${email.processing_error}` : ""}).
              </p>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-ink">{analysis.summary}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={email.is_promotional ? "accent" : "neutral"}>{label(email.email_type)}</Badge>
                  {cats.map((c) => (
                    <CategoryBadge key={c} category={c} />
                  ))}
                  {analysis.manual_categories?.length ? <Badge tone="warn">Manually corrected</Badge> : null}
                </div>
                <DefList
                  items={[
                    ["Main message", analysis.main_message],
                    ["Promotional angle", analysis.promotional_angle],
                    ["Tone / copy", [analysis.tone, analysis.copy_style].filter(Boolean).join(" — ")],
                    ["Subject-line style", analysis.subject_line_style],
                    ["Urgency", analysis.has_urgency ? list(analysis.urgency_tactics) ?? "Yes" : "None"],
                    ["Emoji (subject + preview)", String(analysis.emoji_count ?? 0)],
                    ["Personalization", analysis.is_personalized ? list(analysis.personalization) : "None observed"],
                    ["Emotional appeal", list(analysis.emotional_appeals)],
                    ["Social proof", list(analysis.social_proof)],
                    ["Content focus", label(analysis.content_focus)],
                    ["CTAs", `${analysis.cta_count ?? 0}${analysis.cta_placement ? ` — ${analysis.cta_placement}` : ""}`],
                    ["Creative format", label(analysis.creative_format)],
                    ["Hero", analysis.hero_description],
                    ["Featured products", list(analysis.featured_products)],
                    ["Partners / influencers", list(analysis.partnerships)],
                    ["Seasonal / event", analysis.seasonal_event],
                    ["Campaign theme", analysis.campaign_theme],
                  ]}
                />
              </div>
            )}
          </Card>

          <Card title={`Offers (${offers.length})`} subtitle="Structured extraction. Anything not in the email shows as “Not stated”.">
            {offers.length === 0 ? (
              <p className="text-sm text-muted">No offer in this email.</p>
            ) : (
              <div className="space-y-4">
                {offers.map((o) => (
                  <OfferCard key={o.id} offer={o} industry={industry} />
                ))}
              </div>
            )}
          </Card>

          <Card title="Campaign">
            {campaign ? (
              <div className="space-y-2 text-sm">
                <Link href={`/campaigns/${campaign.id}`} className="font-medium text-accent hover:underline">
                  {campaign.title}
                </Link>
                <p className="text-ink-2">
                  Role in campaign: <b>{email.campaign_role ?? "—"}</b> · {campaign.email_count} emails · inferred
                  {campaign.confirmed_by_user ? ", confirmed by user" : ""}
                </p>
                <form action={removeFromCampaign.bind(null, email.id)}>
                  <button className="text-xs text-bad hover:underline">Remove from this campaign</button>
                </form>
              </div>
            ) : (
              <p className="text-sm text-muted">{email.is_promotional ? "Not grouped yet." : "Not promotional — excluded from campaign metrics."}</p>
            )}
          </Card>

          <Card title="Corrections" subtitle="Manual corrections override the AI everywhere in the app.">
            <div className="mb-4 flex flex-wrap gap-2">
              {email.is_promotional ? (
                <form action={setPromotional.bind(null, email.id, false)}>
                  <button className={secondaryButtonClass}>Mark as not promotional</button>
                </form>
              ) : (
                <form action={setPromotional.bind(null, email.id, true)}>
                  <button className={secondaryButtonClass}>Mark as promotional</button>
                </form>
              )}
            </div>
            {analysis && (
              <form action={setManualCategories.bind(null, email.id)} className="space-y-3">
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {[...CATEGORIES, ...(industry?.extra_categories ?? [])].map((c) => (
                    <label key={c} className="flex items-center gap-2 text-sm text-ink">
                      <input type="checkbox" name="categories" value={c} defaultChecked={cats.includes(c)} />
                      {label(c)}
                    </label>
                  ))}
                </div>
                <button className={secondaryButtonClass}>Save categories</button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
