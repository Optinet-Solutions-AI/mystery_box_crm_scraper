import Link from "next/link";
import { db, must } from "@/lib/supabase";
import { brandColor, parseFilters, scopedBrands, type SearchParams } from "@/lib/data";
import { label } from "@/lib/constants";
import { fmtDate } from "@/lib/format";
import type { Campaign, Offer } from "@/lib/types";
import { Filters } from "@/components/filters";
import { Badge, BrandChip, Card, CategoryBadge, EmptyState, PageHeader, Table } from "@/components/ui";

/** Active/ended from the advertised expiry; unknown when no expiry is stated. */
function campaignStatus(c: Campaign) {
  if (!c.offer_ends_at) return "unknown";
  return new Date(c.offer_ends_at).getTime() < Date.now() ? "ended" : "active";
}

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const f = parseFilters(await searchParams);
  const sb = await db();
  const brands = await scopedBrands(sb, f);
  const brandIdx = new Map(brands.map((b, i) => [b.id, i]));
  const campaigns = brands.length
    ? (must(
        await sb
          .from("campaigns")
          .select("*")
          .in("brand_id", brands.map((b) => b.id))
          .gte("last_seen_at", f.from.toISOString())
          .lte("first_seen_at", f.to.toISOString())
          .order("first_seen_at", { ascending: false })
          .limit(500),
      ) as Campaign[])
    : [];
  const offers = campaigns.length
    ? (must(await sb.from("offers").select("campaign_id, incentive_text, headline, offer_type").in("campaign_id", campaigns.map((c) => c.id))) as Pick<Offer, "campaign_id" | "incentive_text" | "headline" | "offer_type">[])
    : [];
  const totalEmails = campaigns.reduce((s, c) => s + c.email_count, 0);

  return (
    <>
      <PageHeader
        title="Campaigns"
        description={`${campaigns.length} estimated unique campaigns from ${totalEmails} promotional emails. Campaigns are inferred by grouping related emails (subject, offer, promo code, landing page, timing) — not officially confirmed.`}
      />
      <Filters show={["brands", "date", "industry", "country"]} />
      {campaigns.length === 0 ? (
        <EmptyState title="No campaigns in this period" />
      ) : (
        <Card bodyClassName="p-0">
          <Table head={["Campaign", "Brand", "Type", "Offer", "Emails", "Active", "Expiry", "Status"]}>
            {campaigns.map((c) => {
              const brand = brands.find((b) => b.id === c.brand_id)!;
              const offer = offers.find((o) => o.campaign_id === c.id);
              const status = campaignStatus(c);
              return (
                <tr key={c.id} className="align-top">
                  <td className="max-w-sm px-3 py-2">
                    <Link href={`/campaigns/${c.id}`} className="font-medium text-ink hover:underline">
                      {c.title}
                    </Link>
                    {c.promo_codes.length > 0 && <div className="text-xs text-muted">Code: {c.promo_codes.join(", ")}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <BrandChip name={brand.name} color={brandColor(brand, brandIdx.get(brand.id) ?? 0)} logo={brand.logo_url} />
                  </td>
                  <td className="px-3 py-2">{c.primary_category && <CategoryBadge category={c.primary_category} />}</td>
                  <td className="max-w-xs px-3 py-2 text-ink-2">{offer ? offer.incentive_text ?? offer.headline : <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-2">{c.email_count}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-ink-2">
                    {fmtDate(c.first_seen_at, "MMM d")} – {fmtDate(c.last_seen_at, "MMM d")}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-ink-2">{c.offer_ends_at ? fmtDate(c.offer_ends_at) : "Not stated"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={status === "active" ? "good" : "neutral"}>{label(status)}</Badge>
                      {c.confirmed_by_user ? <Badge tone="good">✓ Confirmed</Badge> : <Badge>Inferred</Badge>}
                    </div>
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
