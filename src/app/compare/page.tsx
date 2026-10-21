import Link from "next/link";
import type { ReactNode } from "react";
import { addDays, format } from "date-fns";
import { Filters } from "@/components/filters";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { CompareVolume, type VolumeSeries } from "@/components/charts/compare-volume";
import { CompareHeatmap } from "@/components/charts/compare-heatmap";
import { computeBenchmarks, fmtHours, loadLifecycleTiming, type LifecycleTiming } from "@/lib/benchmarks";
import { label } from "@/lib/constants";
import { brandColor, loadDataset, parseFilters, previousPeriod, scopedBrands, type SearchParams } from "@/lib/data";
import { fmtMoney, fmtPct } from "@/lib/format";
import { computeBrandStats, computeScorecard, DEFAULT_WEIGHTS, SCORE_FORMULAS, topEntries, type BrandStats, type Weights } from "@/lib/metrics";
import { db } from "@/lib/supabase";
import { Scorecard, type ScoreRow } from "./scorecard";

const MAX_BRANDS = 10;

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted">{children}</span>;
}

function List({ items, empty = "Not observed" }: { items: ReactNode[]; empty?: string }) {
  if (items.length === 0) return <Muted>{empty}</Muted>;
  return (
    <ul className="space-y-0.5">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n)}…` : s);

function Clipped({ text }: { text: string }) {
  return <span title={text}>{clip(text)}</span>;
}

function changePct(cur: number, prev: number) {
  if (prev === 0) return cur === 0 ? null : 100;
  return Math.round(((cur - prev) / prev) * 100);
}

function Delta({ cur, prev, unit }: { cur: number; prev: number; unit: string }) {
  const pct = changePct(cur, prev);
  return (
    <span>
      {cur} {unit} <Muted>(prev. {prev})</Muted>{" "}
      {pct !== null && pct !== 0 && (
        <span className="font-medium text-ink-2">
          {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%
        </span>
      )}
    </span>
  );
}

type Row = { label: string; hint?: string; cells: ReactNode[] };
type Section = { title: string; rows: Row[] };

function buildSections(stats: BrandStats[], prevStats: BrandStats[], lifecycle: Record<string, LifecycleTiming | null>): Section[] {
  const prevOf = (s: BrandStats) => prevStats.find((p) => p.brand.id === s.brand.id);
  const maxPctOffer = (s: BrandStats) =>
    s.offers.filter((o) => o.incentive_unit === "percent" && o.incentive_value != null).sort((a, b) => Number(b.incentive_value) - Number(a.incentive_value))[0];
  const maxAmtOffer = (s: BrandStats) =>
    s.offers.filter((o) => o.incentive_unit === "currency" && o.incentive_value != null).sort((a, b) => Number(b.incentive_value) - Number(a.incentive_value))[0];
  const lc = (s: BrandStats) => lifecycle[s.brand.id];
  const noAccount = <Muted>No test account registered</Muted>;

  return [
    {
      title: "CRM activity",
      rows: [
        { label: "Promo emails / week", cells: stats.map((s) => s.emailsPerWeek) },
        { label: "Promo emails / month", cells: stats.map((s) => s.emailsPerMonth) },
        { label: "Active sending days", cells: stats.map((s) => s.activeSendingDays) },
        { label: "Transactional / service emails", hint: "Kept as lifecycle events; excluded from promo metrics", cells: stats.map((s) => s.transactionalEmails) },
      ],
    },
    {
      title: "Campaign strategy",
      rows: [
        { label: "Unique campaigns (est.)", cells: stats.map((s) => <Link key={s.brand.id} href={`/campaigns?brands=${s.brand.id}`} className="hover:underline">{s.uniqueCampaigns}</Link>) },
        { label: "Top categories", cells: stats.map((s) => <List key={s.brand.id} items={topEntries(s.categoryCounts, 3).map(([k, v]) => `${label(k)} (${v})`)} />) },
        { label: "Repetition", hint: "Promo emails per campaign", cells: stats.map((s) => (s.uniqueCampaigns ? `${s.repetitionRate} emails / campaign` : <Muted key={s.brand.id}>—</Muted>)) },
      ],
    },
    {
      title: "Timing",
      rows: [
        { label: "Preferred day", cells: stats.map((s) => s.preferredDay ?? <Muted key={s.brand.id}>—</Muted>) },
        { label: "Preferred hour (UTC)", cells: stats.map((s) => (s.preferredHour != null ? `${String(s.preferredHour).padStart(2, "0")}:00` : <Muted key={s.brand.id}>—</Muted>)) },
        { label: "Avg. interval between emails", cells: stats.map((s) => fmtHours(s.avgIntervalHours)) },
      ],
    },
    {
      title: "Promotions",
      rows: [
        { label: "Offer types", cells: stats.map((s) => <List key={s.brand.id} items={topEntries(s.offerTypeCounts, 4).map(([k, v]) => `${label(k)} (${v})`)} />) },
        {
          label: "Highest advertised %",
          cells: stats.map((s) => {
            const o = maxPctOffer(s);
            return o ? (
              <Link key={s.brand.id} href={`/emails/${o.email_id}`} className="text-accent hover:underline" title={o.headline ?? undefined}>
                {o.incentive_text ?? `${o.incentive_value}%`}
              </Link>
            ) : (
              <Muted key={s.brand.id}>Not observed</Muted>
            );
          }),
        },
        {
          label: "Highest advertised amount",
          cells: stats.map((s) => {
            const o = maxAmtOffer(s);
            return o ? (
              <Link key={s.brand.id} href={`/emails/${o.email_id}`} className="text-accent hover:underline" title={o.headline ?? undefined}>
                {fmtMoney(Number(o.incentive_value), o.currency)}
              </Link>
            ) : (
              <Muted key={s.brand.id}>Not observed</Muted>
            );
          }),
        },
        { label: "Share of promo emails with an offer", cells: stats.map((s) => fmtPct(s.offerRate)) },
      ],
    },
    {
      title: "Incentive terms",
      rows: [
        { label: "Minimum requirements", cells: stats.map((s) => <List key={s.brand.id} empty="Not stated" items={s.minRequirements.slice(0, 3).map((t) => <Clipped key={t} text={t} />)} />) },
        { label: "Maximum rewards", cells: stats.map((s) => <List key={s.brand.id} empty="Not stated" items={s.maxRewards.slice(0, 3).map((t) => <Clipped key={t} text={t} />)} />) },
        { label: "Conditions", cells: stats.map((s) => <List key={s.brand.id} empty="Not stated" items={s.conditions.slice(0, 2).map((t) => <Clipped key={t} text={t} />)} />) },
      ],
    },
    {
      title: "Lifecycle (observed from signup)",
      rows: [
        {
          label: "Time to first email",
          cells: stats.map((s) => {
            const l = lc(s);
            if (!l) return <span key={s.brand.id}>{noAccount}</span>;
            return l.firstEmail ? (
              <Link key={s.brand.id} href={`/emails/${l.firstEmail.id}`} className="text-accent hover:underline">
                {fmtHours(l.firstEmail.hours)}
              </Link>
            ) : (
              <Muted key={s.brand.id}>No email yet</Muted>
            );
          }),
        },
        {
          label: "Time to welcome email",
          cells: stats.map((s) => {
            const l = lc(s);
            if (!l) return <span key={s.brand.id}>{noAccount}</span>;
            return l.welcomeEmail ? (
              <Link key={s.brand.id} href={`/emails/${l.welcomeEmail.id}`} className="text-accent hover:underline">
                {fmtHours(l.welcomeEmail.hours)}
              </Link>
            ) : (
              <Muted key={s.brand.id}>No welcome email observed</Muted>
            );
          }),
        },
        { label: "Emails in first 7 days", cells: stats.map((s) => (lc(s) ? lc(s)!.emailsFirst7Days : <span key={s.brand.id}>{noAccount}</span>)) },
        {
          label: "Observed onboarding sequence",
          hint: "First 5 emails after signup; observed for one test account, not guaranteed for all customers",
          cells: stats.map((s) => {
            const l = lc(s);
            if (!l) return <span key={s.brand.id}>{noAccount}</span>;
            return (
              <List
                key={s.brand.id}
                empty="No emails yet"
                items={l.sequence.map((q) => (
                  <Link key={q.id} href={`/emails/${q.id}`} className="hover:underline">
                    Day {q.day}: {label(q.category)}
                  </Link>
                ))}
              />
            );
          }),
        },
      ],
    },
    {
      title: "Retention",
      rows: [
        { label: "Reactivation / win-back", cells: stats.map((s) => s.retentionCounts.reactivation ?? 0) },
        { label: "Loyalty / VIP", cells: stats.map((s) => s.retentionCounts.loyalty_vip ?? 0) },
        { label: "Cashback", cells: stats.map((s) => s.retentionCounts.cashback ?? 0) },
        { label: "Retention", cells: stats.map((s) => s.retentionCounts.retention ?? 0) },
      ],
    },
    {
      title: "Marketing content",
      rows: [
        { label: "Campaign themes", cells: stats.map((s) => <List key={s.brand.id} items={s.themes.slice(0, 3).map((t) => <Clipped key={t} text={t} />)} />) },
        { label: "Subject-line styles", cells: stats.map((s) => <List key={s.brand.id} items={topEntries(s.subjectStyles, 2).map(([k, v]) => `${k} (${v})`)} />) },
        { label: "Urgency / scarcity", cells: stats.map((s) => fmtPct(s.urgencyRate)) },
        { label: "Personalized", cells: stats.map((s) => fmtPct(s.personalizationRate)) },
        { label: "Emoji in subject/preview", cells: stats.map((s) => fmtPct(s.emojiRate)) },
        { label: "Tone", cells: stats.map((s) => <List key={s.brand.id} items={topEntries(s.tones, 2).map(([k, v]) => `${k} (${v})`)} />) },
      ],
    },
    {
      title: "Creative",
      rows: [
        {
          label: "Visual format",
          cells: stats.map((s) => {
            const total = Object.values(s.creativeFormats).reduce((a, b) => a + b, 0);
            return <List key={s.brand.id} items={topEntries(s.creativeFormats, 3).map(([k, v]) => `${label(k)} ${fmtPct(total ? v / total : 0)}`)} />;
          }),
        },
        { label: "Avg. CTAs per email", cells: stats.map((s) => s.avgCtaCount ?? <Muted key={s.brand.id}>—</Muted>) },
      ],
    },
    {
      title: "Seasonality",
      rows: [{ label: "Events referenced", cells: stats.map((s) => <List key={s.brand.id} items={topEntries(s.seasonalEvents, 4).map(([k, v]) => `${k} (${v})`)} />) }],
    },
    {
      title: "Strategic changes vs previous period",
      rows: [
        { label: "Promo email volume", cells: stats.map((s) => <Delta key={s.brand.id} cur={s.promoEmails} prev={prevOf(s)?.promoEmails ?? 0} unit="emails" />) },
        { label: "Unique campaigns", cells: stats.map((s) => <Delta key={s.brand.id} cur={s.uniqueCampaigns} prev={prevOf(s)?.uniqueCampaigns ?? 0} unit="campaigns" />) },
        {
          label: "New offer types",
          cells: stats.map((s) => {
            const p = prevOf(s);
            const fresh = Object.keys(s.offerTypeCounts).filter((t) => !p || !(t in p.offerTypeCounts));
            return <List key={s.brand.id} empty="None" items={fresh.map(label)} />;
          }),
        },
        {
          label: "Dropped offer types",
          cells: stats.map((s) => {
            const p = prevOf(s);
            const gone = p ? Object.keys(p.offerTypeCounts).filter((t) => !(t in s.offerTypeCounts)) : [];
            return <List key={s.brand.id} empty="None" items={gone.map(label)} />;
          }),
        },
      ],
    },
  ];
}

export default async function ComparePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  let filters = parseFilters(sp);
  const sb = await db();

  let notice: string | null = null;
  if (filters.brandIds.length < 2) {
    const all = await scopedBrands(sb, { ...filters, brandIds: [] });
    const pick = all.filter((b) => b.active).slice(0, MAX_BRANDS);
    notice =
      pick.length < 2
        ? null
        : `Fewer than 2 brands selected, so this shows ${pick.length === all.length ? "all" : `the first ${pick.length} of ${all.length}`} tracked brands. Pick 2–10 brands above to narrow it.`;
    filters = { ...filters, brandIds: pick.map((b) => b.id) };
  } else if (filters.brandIds.length > MAX_BRANDS) {
    filters = { ...filters, brandIds: filters.brandIds.slice(0, MAX_BRANDS) };
    notice = `Comparison is limited to ${MAX_BRANDS} brands; showing the first ${MAX_BRANDS} selected.`;
  }

  const [ds, prev, weightsRow] = await Promise.all([
    loadDataset(filters),
    loadDataset(previousPeriod(filters)),
    sb.from("app_settings").select("value").eq("key", "scorecard_weights").maybeSingle(),
  ]);
  const weights: Weights = { ...DEFAULT_WEIGHTS, ...((weightsRow.data?.value as Partial<Weights>) ?? {}) };

  const header = (
    <>
      <PageHeader
        title="Compare competitors"
        description="Side-by-side view of what each brand's CRM program looks like from the inbox: volume, timing, offers, lifecycle and content."
      />
      <Filters maxBrands={MAX_BRANDS} />
    </>
  );

  if (ds.brands.length < 2) {
    return (
      <div>
        {header}
        <EmptyState title="Add at least two brands to compare">
          <Link href="/brands" className="text-accent hover:underline">
            Add brands
          </Link>{" "}
          and connect a mailbox to start collecting emails.
        </EmptyState>
      </div>
    );
  }

  const stats = ds.brands.map((b) => computeBrandStats(ds, b));
  const prevStats = prev.brands.map((b) => computeBrandStats(prev, b));
  const lifecycle = await loadLifecycleTiming(ds.brands);
  const benchmarks = computeBenchmarks(ds, prev, stats, prevStats);
  const colorOf = new Map(ds.brands.map((b, i) => [b.id, brandColor(b, i)]));

  const scoreRows: ScoreRow[] = stats.map((s) => {
    const sc = computeScorecard(s, weights);
    return { brandId: s.brand.id, name: s.brand.name, color: colorOf.get(s.brand.id)!, scores: sc.scores, coverage: sc.coverage, confidence: sc.confidence };
  });

  const volume: VolumeSeries[] = stats.map((s) => ({
    brandId: s.brand.id,
    name: s.brand.name,
    color: colorOf.get(s.brand.id)!,
    perWeek: s.emailsPerWeek,
    weeks: s.weeklyCounts.map((count, i) => ({ week: format(addDays(filters.from, i * 7), "MMM d"), count })),
  }));

  const heat = stats.map((s) => ({ brandId: s.brand.id, name: s.brand.name, counts: s.weekdayCounts, total: s.promoEmails }));
  const sections = buildSections(stats, prevStats, lifecycle);

  return (
    <div className="space-y-6">
      {header}
      {notice && <p className="-mt-3 text-sm text-ink-2">{notice}</p>}

      <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-ink-2">
        <strong className="font-medium text-ink">How to read this:</strong> every metric describes CRM behavior observed in our research inboxes
        ({fmtDateRange(filters.from, filters.to)}). Scores say nothing about a competitor&apos;s deliverability, conversion rates or profitability.
        Campaigns are grouped by inference, and lifecycle timings come from a single test account per brand.
      </p>

      <Card title="Competitor scorecard" subtitle="0–100 per dimension. Hover a column title or open the formulas to see exactly how each score is computed.">
        <Scorecard rows={scoreRows} initialWeights={weights} formulas={SCORE_FORMULAS} />
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Promotional emails per week" subtitle="Same scale in every panel, so bar heights compare across brands">
          <CompareVolume series={volume} />
        </Card>
        <Card className="xl:col-span-2" title="When each brand sends" subtitle="Promotional emails by weekday, shaded within each brand">
          <CompareHeatmap rows={heat} />
        </Card>
      </div>

      <Card title="Benchmarks" subtitle="Answered from structured offer and campaign data, with links to the supporting emails">
        <div className="divide-y divide-line">
          {benchmarks.map((b) => (
            <div key={b.question} className="py-3 first:pt-0 last:pb-0">
              <p className="text-xs font-medium text-ink-2">{b.question}</p>
              <p className="mt-1 text-sm text-ink">{b.answer}</p>
              {b.detail && <p className="mt-0.5 text-xs text-ink-2">{b.detail}</p>}
              {b.evidence.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {b.evidence.map((e) => (
                    <Link key={e.href + e.label} href={e.href} className="text-accent hover:underline">
                      {clip(e.label, 60)} →
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Side-by-side comparison" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line">
                <th className="w-56 px-4 py-3 text-xs font-medium text-ink-2">Metric</th>
                {ds.brands.map((b) => (
                  <th key={b.id} className="min-w-44 px-4 py-3">
                    <Link href={`/brands/${b.id}`} className="inline-flex items-center gap-1.5 font-medium text-ink hover:underline">
                      {b.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={b.logo_url} alt="" className="h-4 w-4 rounded-sm object-contain" />
                      ) : (
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf.get(b.id) }} aria-hidden />
                      )}
                      {b.name}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            {sections.map((sec) => (
              <tbody key={sec.title} className="tabular">
                <tr className="bg-surface-2">
                  <th colSpan={ds.brands.length + 1} className="px-4 py-2 text-xs font-semibold tracking-wide text-ink uppercase">
                    {sec.title}
                  </th>
                </tr>
                {sec.rows.map((r) => (
                  <tr key={r.label} className="border-b border-line align-top last:border-b-0">
                    <td className="px-4 py-2 text-ink-2">
                      {r.label}
                      {r.hint && <div className="text-xs text-muted">{r.hint}</div>}
                    </td>
                    {r.cells.map((c, i) => (
                      <td key={i} className="px-4 py-2 text-ink">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </Card>
    </div>
  );
}

function fmtDateRange(from: Date, to: Date) {
  return `${format(from, "MMM d, yyyy")} – ${format(to, "MMM d, yyyy")}`;
}
