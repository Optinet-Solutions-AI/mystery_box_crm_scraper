import Link from "next/link";
import type { ReactNode } from "react";
import { label } from "@/lib/constants";
import { loadDataset, parseFilters } from "@/lib/data";
import { fmtAgo, fmtDate, fmtNum, fmtPct } from "@/lib/format";
import { computeBrandStats, topEntries } from "@/lib/metrics";
import { db } from "@/lib/supabase";
import type { Brand } from "@/lib/types";
import { ApiButton } from "@/components/api-button";
import { Badge, Card, CategoryBadge, DefList, KpiCard } from "@/components/ui";

type Profile = {
  status: "pending" | "researching" | "ready" | "error";
  overview: string | null;
  category: string | null;
  launch_date: string | null;
  launch_date_source: string | null;
  founders: { name: string; role: string | null; source_url: string | null }[];
  headquarters: string | null;
  headquarters_source: string | null;
  legal_entity: string | null;
  parent_company: string | null;
  platform_summary: string | null;
  site_tech: { name: string; category: string; evidence: string }[];
  email_platforms: { name: string; emails: number }[];
  business_model: string | null;
  products: string[];
  markets: string[];
  payment_methods: string[];
  licensing: string | null;
  funding: string | null;
  social: { network: string; url: string }[];
  facts: { fact: string; source_url: string | null }[];
  sources: { title: string; url: string }[];
  site_title: string | null;
  confidence: number | null;
  caveats: string | null;
  model: string | null;
  error: string | null;
  researched_at: string | null;
};

const safeUrl = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);

function Src({ url }: { url: string | null | undefined }) {
  const u = safeUrl(url);
  return u ? (
    <a href={u} target="_blank" rel="noopener noreferrer" className="ml-1 text-xs text-accent hover:underline" title={u}>
      [source]
    </a>
  ) : null;
}

const join = (xs: string[]) => (xs.length ? xs.map((x) => x.trim().replace(/[.;,]+$/, "")).filter(Boolean).join(", ") : null);

/** Background on the brand (AI web research + detected tech) and a summary of its email activity. */
export async function BrandProfile({ brand }: { brand: Brand }) {
  const sb = await db();
  const profile = (await sb.from("brand_profiles").select("*").eq("brand_id", brand.id).maybeSingle()).data as Profile | null;
  const ds = await loadDataset(parseFilters({ days: "90", brands: brand.id }));
  const stats = computeBrandStats(ds, brand);
  const lastEmail = ds.emails.at(-1)?.sent_at ?? null;
  const researching = profile?.status === "researching";
  const emailCount = (await sb.from("emails").select("id", { count: "exact", head: true }).eq("brand_id", brand.id)).count ?? 0;

  const techByCategory = (profile?.site_tech ?? []).reduce<Record<string, string[]>>((m, t) => {
    (m[t.category] ??= []).push(t.name);
    return m;
  }, {});

  const facts: [string, ReactNode][] = profile
    ? [
        ["Category", profile.category],
        ["Went live", profile.launch_date ? <span key="l">{profile.launch_date}<Src url={profile.launch_date_source} /></span> : null],
        [
          "Founders",
          profile.founders.length ? (
            <span key="f">
              {profile.founders.map((f, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  {f.name}
                  {f.role && <span className="text-ink-2"> ({f.role})</span>}
                  <Src url={f.source_url} />
                </span>
              ))}
            </span>
          ) : null,
        ],
        ["Headquarters", profile.headquarters ? <span key="h">{profile.headquarters}<Src url={profile.headquarters_source} /></span> : null],
        ["Company", [profile.legal_entity, profile.parent_company && `part of ${profile.parent_company}`].filter(Boolean).join(" · ") || null],
        ["Business model", profile.business_model],
        ["Built on", profile.platform_summary],
        ["Products", join(profile.products)],
        ["Payments", join(profile.payment_methods)],
        ["Markets", join(profile.markets)],
        ["Licensing / restrictions", profile.licensing],
        ["Funding", profile.funding],
      ]
    : [];

  return (
    <div className="mb-6 space-y-6">
      <Card
        title="Brand profile"
        subtitle={
          profile?.researched_at
            ? `AI web research ${fmtAgo(profile.researched_at)} · confidence ${Math.round(Number(profile.confidence ?? 0) * 100)}% · verify with the linked sources`
            : "Background on the company, researched from public sources"
        }
        actions={
          <ApiButton endpoint={`/api/brands/${brand.id}/research`} describe="plain">
            {profile?.researched_at ? "Refresh research" : "Research this brand"}
          </ApiButton>
        }
      >
        {!profile || profile.status === "pending" ? (
          <p className="text-sm text-ink-2">Not researched yet. Click “Research this brand” — it takes about a minute.</p>
        ) : researching ? (
          <p className="text-sm text-ink-2">Researching now… refresh the page in a minute.</p>
        ) : (
          <div className="space-y-5">
            {profile.status === "error" && <p className="text-sm text-bad">Research failed: {profile.error}</p>}
            {profile.overview && <p className="text-sm leading-relaxed text-ink">{profile.overview}</p>}
            <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <DefList items={facts} />
              <div className="space-y-4 text-sm">
                <div>
                  <div className="mb-1 text-xs font-medium text-ink-2">Website technology (detected)</div>
                  {Object.keys(techByCategory).length ? (
                    <ul className="space-y-0.5">
                      {Object.entries(techByCategory).map(([cat, names]) => (
                        <li key={cat}>
                          <span className="text-ink-2">{cat}:</span> {names.join(", ")}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted">Couldn&apos;t read the website (it may block automated visits).</p>
                  )}
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-ink-2">Email / CRM platform (from their emails)</div>
                  {profile.email_platforms.length ? (
                    <div className="flex flex-wrap gap-1">
                      {profile.email_platforms.map((p) => (
                        <Badge key={p.name} tone="accent" title="Emails whose headers or links show this service. One email can use more than one.">
                          {p.name} · {p.emails} of {emailCount} email{emailCount === 1 ? "" : "s"}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted">Not identified from the emails received so far.</p>
                  )}
                </div>
                {profile.social.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-ink-2">Social</div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {profile.social.map((s) =>
                        safeUrl(s.url) ? (
                          <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                            {s.network}
                          </a>
                        ) : null,
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            {profile.facts.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-ink-2">Notable facts</div>
                <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
                  {profile.facts.map((f, i) => (
                    <li key={i}>
                      {f.fact}
                      <Src url={f.source_url} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {profile.caveats && <p className="text-xs text-ink-2">Caveats: {profile.caveats}</p>}
            {profile.sources.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-ink-2">Sources ({profile.sources.length})</summary>
                <ul className="mt-2 space-y-1">
                  {profile.sources.map((s) =>
                    safeUrl(s.url) ? (
                      <li key={s.url} className="truncate">
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                          {s.title || s.url}
                        </a>
                      </li>
                    ) : null,
                  )}
                </ul>
              </details>
            )}
          </div>
        )}
      </Card>

      <Card
        title="Email activity — last 90 days"
        subtitle="From the emails this brand sent to the research inbox"
        actions={
          <span className="flex gap-3 text-xs">
            <Link href={`/emails?brand=${brand.id}`} className="text-accent hover:underline">
              Emails
            </Link>
            <Link href={`/campaigns?brands=${brand.id}&days=90`} className="text-accent hover:underline">
              Campaigns
            </Link>
            <Link href={`/compare?brands=${brand.id}`} className="text-accent hover:underline">
              Compare
            </Link>
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Promotional emails" value={fmtNum(stats.promoEmails)} hint={`${stats.transactionalEmails} other`} />
          <KpiCard label="Emails / week" value={fmtNum(stats.emailsPerWeek, 1)} />
          <KpiCard label="Campaigns" value={fmtNum(stats.uniqueCampaigns)} />
          <KpiCard label="Offers" value={fmtNum(stats.offers.length)} hint={stats.maxPercent != null ? `up to ${stats.maxPercent}%` : undefined} />
          <KpiCard label="Use urgency" value={fmtPct(stats.urgencyRate)} />
          <KpiCard label="Last email" value={<span className="text-xl">{lastEmail ? fmtDate(lastEmail, "MMM d") : "—"}</span>} hint={lastEmail ? fmtAgo(lastEmail) : undefined} />
        </div>
        {Object.keys(stats.categoryCounts).length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-ink-2">Most common:</span>
            {topEntries(stats.categoryCounts, 6).map(([c]) => (
              <CategoryBadge key={c} category={c} />
            ))}
            {Object.keys(stats.offerTypeCounts).length > 0 && (
              <span className="ml-2 text-xs text-ink-2">Offer types: {Object.keys(stats.offerTypeCounts).map(label).join(", ")}</span>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
