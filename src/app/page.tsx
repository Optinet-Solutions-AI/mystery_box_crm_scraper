import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { Filters } from "@/components/filters";
import { DashboardAiButton } from "@/components/charts/dashboard-ai-button";
import { DashboardTimeline, type TimelineEvent } from "@/components/charts/dashboard-timeline";
import { DashboardVolumeChart } from "@/components/charts/dashboard-volume";
import { Badge, BrandChip, Card, EmptyState, KpiCard, PageHeader, Table } from "@/components/ui";
import { label } from "@/lib/constants";
import { brandColor, loadDataset, parseFilters, previousPeriod, type SearchParams } from "@/lib/data";
import { fmtAgo, fmtDate } from "@/lib/format";
import { computeKpis, isOfferActive, volumeSeries } from "@/lib/metrics";
import { db, must } from "@/lib/supabase";
import type { Insight } from "@/lib/types";

const pctDelta = (cur: number, prev: number) => (prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 100));

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = parseFilters(await searchParams);
  const [ds, prev] = await Promise.all([loadDataset(filters), loadDataset(previousPeriod(filters))]);
  const now = new Date();
  const kpis = computeKpis(ds, prev, now);
  const prevKpis = computeKpis(prev, prev, filters.from);

  const sb = await db();
  const scopeBrandIds = ds.brands.map((b) => b.id);
  const brandFilterActive = filters.brandIds.length > 0 || !!filters.industry || !!filters.country;
  const overlaps = (i: Insight) => !brandFilterActive || i.brand_ids.length === 0 || i.brand_ids.some((id) => scopeBrandIds.includes(id));
  const [feedRaw, findingsRaw] = await Promise.all([
    sb.from("insights").select("*").neq("kind", "ai_finding").order("created_at", { ascending: false }).limit(40),
    sb.from("insights").select("*").eq("kind", "ai_finding").order("created_at", { ascending: false }).limit(20),
  ]);
  const feed = (must(feedRaw, "load feed") as Insight[]).filter(overlaps).slice(0, 10);
  const findings = (must(findingsRaw, "load findings") as Insight[]).filter(overlaps).slice(0, 6);

  const colorOf = new Map(ds.brands.map((b, i) => [b.id, brandColor(b, i)]));
  const nameOf = new Map(ds.brands.map((b) => [b.id, b.name]));
  const series = ds.brands.map((b) => ({ id: b.id, name: b.name, color: colorOf.get(b.id)! }));

  const header = (
    <PageHeader
      title="Intelligence dashboard"
      description="Competitor CRM activity observed in your research inboxes. Campaigns are grouped automatically and shown as inferred, not confirmed."
    />
  );

  if (ds.brands.length === 0 || (ds.emails.length === 0 && prev.emails.length === 0)) {
    return (
      <>
        {header}
        <Filters />
        <EmptyState title="No competitor emails yet">
          Add the brands you want to monitor on the <Link className="text-accent underline" href="/brands">Brands</Link> page, sign
          up to each with your research Gmail, then connect that inbox on{" "}
          <Link className="text-accent underline" href="/settings">Settings</Link> and run a sync. Emails show up here once
          they&apos;ve been analyzed.
        </EmptyState>
      </>
    );
  }

  const campaignTitle = new Map(ds.campaigns.map((c) => [c.id, c.title]));
  const events: TimelineEvent[] = ds.promoEmails
    .filter((e) => e.sent_at && e.brand_id)
    .map((e) => ({
      id: e.id,
      brandId: e.brand_id!,
      t: new Date(e.sent_at!).getTime(),
      subject: e.subject ?? "(no subject)",
      isLaunch: e.campaign_role === "launch",
      campaignId: e.campaign_id,
      campaignTitle: e.campaign_id ? (campaignTitle.get(e.campaign_id) ?? null) : null,
    }));

  const promoIds = new Set(ds.promoEmails.map((e) => e.id));
  const activeOffers = ds.offers
    .filter((o) => promoIds.has(o.email_id) && isOfferActive(o, now))
    .sort((a, b) => {
      if (a.ends_at && b.ends_at) return a.ends_at.localeCompare(b.ends_at);
      if (a.ends_at) return -1;
      if (b.ends_at) return 1;
      return b.created_at.localeCompare(a.created_at);
    })
    .slice(0, 12);

  const totalPromo = ds.promoEmails.length;
  const share = ds.brands
    .map((b) => ({ brand: b, n: ds.promoEmails.filter((e) => e.brand_id === b.id).length }))
    .sort((a, b) => b.n - a.n);
  const maxShare = Math.max(1, ...share.map((s) => s.n));

  return (
    <>
      {header}
      <Filters />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Competitors monitored" value={kpis.competitorsMonitored} href="/brands" />
        <KpiCard
          label="Active competitors sending"
          value={kpis.activeCompetitors}
          hint="sent ≥1 promo email"
          delta={{ value: pctDelta(kpis.activeCompetitors, prevKpis.activeCompetitors) }}
        />
        <KpiCard
          label="Marketing emails collected"
          value={kpis.totalMarketingEmails}
          hint="vs previous period"
          delta={{ value: pctDelta(kpis.totalMarketingEmails, prevKpis.totalMarketingEmails) }}
          href="/emails"
        />
        <KpiCard
          label="Unique campaigns (est.)"
          value={kpis.uniqueCampaigns}
          hint="inferred groups"
          delta={{ value: pctDelta(kpis.uniqueCampaigns, prevKpis.uniqueCampaigns) }}
          href="/campaigns"
        />
        <KpiCard label="Active offers" value={kpis.activeOffers} hint="not yet expired" href="/offers" />
        <KpiCard
          label="New offers in period"
          value={kpis.newOffers}
          delta={{ value: pctDelta(kpis.newOffers, prevKpis.newOffers) }}
          href="/offers"
        />
        <KpiCard label="Offers expiring in 7 days" value={kpis.offersExpiringSoon} hint="stated expiry dates" href="/calendar" />
        <KpiCard
          label="Brands with big CRM changes"
          value={kpis.significantChanges.length}
          hint={
            kpis.significantChanges.length
              ? kpis.significantChanges
                  .slice(0, 2)
                  .map((c) => `${nameOf.get(c.brandId)} ${c.changePct > 0 ? "+" : ""}${c.changePct}%`)
                  .join(", ")
              : "±50% email volume"
          }
          href="/compare"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Competitor activity timeline"
          subtitle="Each dot is a promotional email; ringed marks are inferred campaign launches"
        >
          <DashboardTimeline lanes={series} events={events} from={filters.from.getTime()} to={filters.to.getTime()} />
        </Card>

        <Card title="Share of inbox-observed promotional emails — not market share" subtitle={`${totalPromo} promotional emails in period`}>
          {totalPromo === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No promotional emails in this period.</p>
          ) : (
            <ul className="space-y-3">
              {share.map(({ brand, n }) => (
                <li key={brand.id}>
                  <div className="flex items-center justify-between text-sm">
                    <BrandChip name={brand.name} color={colorOf.get(brand.id)!} href={`/brands/${brand.id}`} logo={brand.logo_url} />
                    <span className="text-ink-2 tabular">
                      {Math.round((n / totalPromo) * 100)}% <span className="text-muted">({n})</span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-surface-2">
                    <div className="h-2 rounded-full" style={{ width: `${(n / maxShare) * 100}%`, background: colorOf.get(brand.id) }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="xl:col-span-2" title="Campaign volume" subtitle="Promotional emails and new campaigns per brand">
          <DashboardVolumeChart series={series} daily={volumeSeries(ds, "day")} weekly={volumeSeries(ds, "week")} />
        </Card>

        <Card
          title="AI intelligence summary"
          subtitle="Key findings, each linked to its evidence"
          actions={
            <Suspense fallback={null}>
              <DashboardAiButton />
            </Suspense>
          }
        >
          {findings.length === 0 ? (
            <p className="text-sm text-muted">
              No findings yet. Press <span className="font-medium text-ink-2">Generate summary</span> to analyze this period
              {" "}(needs an OpenAI API key).
            </p>
          ) : (
            <ul className="space-y-4">
              {findings.map((f) => (
                <li key={f.id}>
                  <div className="flex items-start gap-2">
                    {f.severity !== "info" && (
                      <Badge tone={f.severity === "important" ? "accent" : "neutral"}>{f.severity === "important" ? "Important" : "Notable"}</Badge>
                    )}
                    <p className="text-sm font-medium text-ink">{f.title}</p>
                  </div>
                  {f.body && <p className="mt-1 text-sm text-ink-2">{f.body}</p>}
                  <EvidenceLinks insight={f} />
                </li>
              ))}
              <li className="text-xs text-muted">Generated {fmtAgo(findings[0].created_at)}</li>
            </ul>
          )}
        </Card>

        <Card
          className="xl:col-span-2"
          title="Top offers"
          subtitle="Currently active offers, soonest expiry first. Values are as advertised."
          actions={
            <Link href="/offers" className="inline-flex items-center gap-1 text-xs text-accent">
              All offers <ArrowRight size={12} />
            </Link>
          }
          bodyClassName="p-0"
        >
          {activeOffers.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted">No active offers detected in this period.</p>
          ) : (
            <Table head={["Brand", "Offer", "Value", "Min. requirement", "Max reward", "Eligibility", "Conditions", "Expires", ""]}>
              {activeOffers.map((o) => (
                <tr key={o.id} className="align-top">
                  <td className="px-3 py-2">
                    <BrandChip name={nameOf.get(o.brand_id ?? "") ?? "?"} color={colorOf.get(o.brand_id ?? "") ?? "#898781"} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-ink">{o.headline ?? label(o.offer_type)}</div>
                    <div className="text-xs text-muted">
                      {label(o.offer_type)}
                      {o.promo_code && <> · code <span className="font-mono">{o.promo_code}</span></>}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-ink">{o.incentive_text ?? <NS />}</td>
                  <td className="px-3 py-2 text-ink-2">{o.min_requirement ?? <NS />}</td>
                  <td className="px-3 py-2 text-ink-2">{o.max_reward ?? <NS />}</td>
                  <td className="px-3 py-2 text-ink-2">{o.eligibility ?? <NS />}</td>
                  <td className="max-w-56 px-3 py-2 text-xs text-ink-2">{o.conditions ?? <NS />}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-ink-2">{o.ends_at ? fmtDate(o.ends_at) : (o.ends_text ?? <NS />)}</td>
                  <td className="px-3 py-2">
                    <Link href={`/emails/${o.email_id}`} className="text-xs whitespace-nowrap text-accent">
                      Email →
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card
          title="New intelligence"
          subtitle="Latest campaigns, offers and changes"
          actions={
            <Link href="/feed" className="inline-flex items-center gap-1 text-xs text-accent">
              Feed <ArrowRight size={12} />
            </Link>
          }
        >
          {feed.length === 0 ? (
            <p className="text-sm text-muted">Nothing new yet.</p>
          ) : (
            <ul className="space-y-3">
              {feed.map((i) => (
                <li key={i.id} className="border-b border-line pb-3 last:border-b-0 last:pb-0">
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span>{label(i.kind)}</span>·<span>{fmtAgo(i.created_at)}</span>
                  </div>
                  <Link href={`/feed#${i.id}`} className="mt-0.5 block text-sm text-ink hover:underline">
                    {i.title}
                  </Link>
                  <EvidenceLinks insight={i} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function NS() {
  return <span className="text-muted">Not stated</span>;
}

function EvidenceLinks({ insight }: { insight: Insight }) {
  const links = [
    ...insight.campaign_ids.slice(0, 3).map((id, n) => ({ href: `/campaigns/${id}`, text: `Campaign ${n + 1}` })),
    ...insight.email_ids.slice(0, 3).map((id, n) => ({ href: `/emails/${id}`, text: `Email ${n + 1}` })),
  ];
  if (links.length === 0) return null;
  const more = insight.campaign_ids.length + insight.email_ids.length - links.length;
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="text-accent hover:underline">
          {l.text}
        </Link>
      ))}
      {more > 0 && (
        <Link href={`/feed#${insight.id}`} className="text-muted hover:underline">
          +{more} more
        </Link>
      )}
    </div>
  );
}
