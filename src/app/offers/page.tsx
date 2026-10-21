import Link from "next/link";
import { db } from "@/lib/supabase";
import { brandColor, fetchAll, parseFilters, scopedBrands, type SearchParams } from "@/lib/data";
import { isOfferActive } from "@/lib/metrics";
import { label, OFFER_TYPES } from "@/lib/constants";
import { fmtDate } from "@/lib/format";
import type { Offer } from "@/lib/types";
import { Filters } from "@/components/filters";
import { Badge, BrandChip, Card, EmptyState, PageHeader, Table } from "@/components/ui";

const NS = <span className="text-muted">Not stated</span>;

export default async function OffersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const f = parseFilters(sp);
  const type = typeof sp.type === "string" ? sp.type : "";
  const onlyActive = sp.active === "1";
  const sb = await db();
  const brands = await scopedBrands(sb, f);
  const brandIdx = new Map(brands.map((b, i) => [b.id, i]));
  const offers = brands.length
    ? await fetchAll<Offer>((a, b) => {
        let q = sb
          .from("offers")
          .select("*, emails!inner(sent_at, is_promotional, subject)")
          .in("brand_id", brands.map((x) => x.id))
          .eq("emails.is_promotional", true)
          .gte("emails.sent_at", f.from.toISOString())
          .lte("emails.sent_at", f.to.toISOString());
        if (type) q = q.eq("offer_type", type);
        return q.order("created_at", { ascending: false }).range(a, b) as unknown as PromiseLike<{ data: Offer[] | null; error: { message: string } | null }>;
      })
    : [];
  const rows = (offers as (Offer & { emails: { sent_at: string; subject: string | null } })[]).filter((o) => !onlyActive || isOfferActive(o));
  const link = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string") as [string, string][]);
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    return `/offers?${p.toString()}`;
  };

  return (
    <>
      <PageHeader title="Offers" description="Every structured offer extracted from promotional emails. Values are as advertised; nothing is inferred." />
      <Filters show={["brands", "date", "industry", "country"]} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href={link({ active: onlyActive ? null : "1" })} className={onlyActive ? "font-medium text-accent" : "text-ink-2 hover:text-ink"}>
          {onlyActive ? "✓ " : ""}Active only
        </Link>
        <span className="text-muted">·</span>
        <Link href={link({ type: null })} className={!type ? "font-medium text-accent" : "text-ink-2 hover:text-ink"}>
          All types
        </Link>
        {OFFER_TYPES.map((t) => (
          <Link key={t} href={link({ type: t })} className={type === t ? "font-medium text-accent" : "text-ink-2 hover:text-ink"}>
            {label(t)}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No offers in this period" />
      ) : (
        <Card bodyClassName="p-0">
          <Table head={["Brand", "Offer", "Value", "Min. requirement", "Max. reward", "Code", "Eligibility", "Conditions", "Expiry", "Email"]}>
            {rows.map((o) => {
              const brand = brands.find((b) => b.id === o.brand_id)!;
              return (
                <tr key={o.id} className="align-top">
                  <td className="px-3 py-2">
                    <BrandChip name={brand.name} color={brandColor(brand, brandIdx.get(brand.id) ?? 0)} logo={brand.logo_url} />
                  </td>
                  <td className="max-w-xs px-3 py-2">
                    <Badge tone="accent">{label(o.offer_type)}</Badge>
                    <div className="mt-1 text-ink">{o.headline}</div>
                  </td>
                  <td className="px-3 py-2">{o.incentive_text ?? NS}</td>
                  <td className="max-w-[12rem] px-3 py-2 text-ink-2">{o.min_requirement ?? NS}</td>
                  <td className="max-w-[12rem] px-3 py-2 text-ink-2">{o.max_reward ?? NS}</td>
                  <td className="px-3 py-2">{o.promo_code ? <code className="rounded bg-surface-2 px-1">{o.promo_code}</code> : NS}</td>
                  <td className="max-w-[12rem] px-3 py-2 text-ink-2">{o.eligibility ?? NS}</td>
                  <td className="max-w-xs px-3 py-2 text-xs text-ink-2">{o.conditions ?? NS}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{o.ends_at ? fmtDate(o.ends_at) : o.ends_text ?? NS}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link href={`/emails/${o.email_id}`} className="text-accent hover:underline">
                      {fmtDate(o.emails.sent_at, "MMM d")}
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
