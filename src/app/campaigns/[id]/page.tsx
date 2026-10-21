import Link from "next/link";
import { notFound } from "next/navigation";
import { db, must } from "@/lib/supabase";
import { label } from "@/lib/constants";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { safePreviewHtml } from "@/lib/email/preview";
import type { Brand, Campaign, Email, EmailAnalysis, Industry, Offer } from "@/lib/types";
import { OfferCard } from "@/components/offer-card";
import { Badge, Card, CategoryBadge, DefList, inputClass, PageHeader, secondaryButtonClass, Table } from "@/components/ui";
import { renameCampaign, setCampaignConfirmed } from "../actions";

type Row = Pick<Email, "id" | "subject" | "sent_at" | "campaign_role" | "preview_text" | "promo_codes">;

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await db();
  const campaign = (await sb.from("campaigns").select("*").eq("id", id).maybeSingle()).data as Campaign | null;
  if (!campaign) notFound();

  const [brand, emails, offers] = await Promise.all([
    sb.from("brands").select("*").eq("id", campaign.brand_id).single().then((r) => r.data as Brand),
    sb.from("emails").select("id, subject, sent_at, campaign_role, preview_text, promo_codes").eq("campaign_id", id).order("sent_at").then((r) => must(r) as Row[]),
    sb.from("offers").select("*").eq("campaign_id", id).order("created_at").then((r) => must(r) as Offer[]),
  ]);
  const analyses = emails.length ? (must(await sb.from("email_analyses").select("*").in("email_id", emails.map((e) => e.id))) as EmailAnalysis[]) : [];
  const byId = new Map(analyses.map((a) => [a.email_id, a]));
  const industry = (await sb.from("industries").select("*").eq("id", brand.industry_id).maybeSingle()).data as Industry | null;
  const launch = emails[0] ? ((await sb.from("emails").select("html_body, text_body, images").eq("id", emails[0].id).single()).data as Pick<Email, "html_body" | "text_body" | "images">) : null;
  const launchAnalysis = emails[0] ? byId.get(emails[0].id) : undefined;
  // Show each distinct offer once (repeats of the same offer across emails collapse).
  const uniqueOffers = offers.filter((o, i) => offers.findIndex((x) => (x.incentive_text ?? x.headline) === (o.incentive_text ?? o.headline) && x.offer_type === o.offer_type) === i);

  return (
    <>
      <PageHeader
        title={campaign.title}
        description={
          <>
            <Link href={`/brands/${brand.id}`} className="text-accent hover:underline">
              {brand.name}
            </Link>{" "}
            · {fmtDate(campaign.first_seen_at)} – {fmtDate(campaign.last_seen_at)} · {campaign.email_count} email{campaign.email_count === 1 ? "" : "s"}
          </>
        }
        actions={
          campaign.confirmed_by_user ? (
            <form action={setCampaignConfirmed.bind(null, id, false)}>
              <button className={secondaryButtonClass}>✓ Confirmed — undo</button>
            </form>
          ) : (
            <form action={setCampaignConfirmed.bind(null, id, true)}>
              <button className={secondaryButtonClass}>Confirm grouping</button>
            </form>
          )
        }
      />

      {!campaign.confirmed_by_user && (
        <div className="mb-6 rounded-xl border border-line bg-surface-2 p-3 text-sm text-ink-2">
          This campaign is <b>inferred</b>: the app grouped these emails because they look related (grouping confidence {Math.round(Number(campaign.confidence ?? 0) * 100)}%). It is not an officially confirmed promotion. Review the emails below and confirm or split them.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card title="Emails in this campaign" bodyClassName="p-0">
            <Table head={["Sent", "Subject", "Role"]}>
              {emails.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-ink-2">{fmtDateTime(e.sent_at)}</td>
                  <td className="px-3 py-2">
                    <Link href={`/emails/${e.id}`} className="text-ink hover:underline">
                      {e.subject ?? "(no subject)"}
                    </Link>
                    <div className="line-clamp-1 text-xs text-muted">{byId.get(e.id)?.summary ?? e.preview_text}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={e.campaign_role === "launch" ? "accent" : "neutral"}>{label(e.campaign_role)}</Badge>
                  </td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title={`Offers (${uniqueOffers.length})`}>
            {uniqueOffers.length === 0 ? (
              <p className="text-sm text-muted">No offer stated in these emails.</p>
            ) : (
              <div className="space-y-4">
                {uniqueOffers.map((o) => (
                  <OfferCard key={o.id} offer={o} industry={industry} />
                ))}
              </div>
            )}
          </Card>

          <Card title="Campaign details">
            <DefList
              items={[
                ["Categories", campaign.categories.length ? <span key="c" className="flex flex-wrap gap-1">{campaign.categories.map((c) => <CategoryBadge key={c} category={c} />)}</span> : null],
                ["Offer type", campaign.offer_type ? label(campaign.offer_type) : null],
                ["Promo codes", campaign.promo_codes.join(", ")],
                ["Landing pages", campaign.landing_urls.length ? <span key="l" className="text-xs break-all">{campaign.landing_urls.join(" · ")}</span> : null],
                ["Seasonal / event", campaign.seasonal_event],
                ["Advertised start", campaign.offer_starts_at ? fmtDateTime(campaign.offer_starts_at) : null],
                ["Advertised expiry", campaign.offer_ends_at ? fmtDateTime(campaign.offer_ends_at) : null],
                ["Launch summary", launchAnalysis?.summary],
                ["Marketing angle", launchAnalysis?.promotional_angle],
                ["Tone", launchAnalysis?.tone],
                ["Urgency", launchAnalysis?.urgency_tactics?.join(", ")],
              ]}
            />
            <form action={renameCampaign.bind(null, id)} className="mt-4 flex gap-2">
              <input name="title" defaultValue={campaign.title} className={inputClass} />
              <button className={secondaryButtonClass}>Rename</button>
            </form>
          </Card>
        </div>

        <Card title="Launch email" subtitle="Safe preview: images and tracking pixels blocked." bodyClassName="p-0">
          {launch?.html_body ? (
            <iframe
              title="Launch email preview"
              srcDoc={safePreviewHtml(launch.html_body, launch.images, false)}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              className="h-[900px] w-full rounded-b-xl bg-white"
            />
          ) : (
            <pre className="max-h-[900px] overflow-auto p-4 text-sm whitespace-pre-wrap">{launch?.text_body ?? "—"}</pre>
          )}
        </Card>
      </div>
    </>
  );
}
