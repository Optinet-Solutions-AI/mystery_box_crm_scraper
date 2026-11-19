import Link from "next/link";
import { db, must } from "@/lib/supabase";
import { brandColor, categoriesOf, EMAIL_LIGHT_COLUMNS, type EmailLight } from "@/lib/data";
import { CATEGORIES, EMAIL_TYPES, label } from "@/lib/constants";
import { fmtDateTime } from "@/lib/format";
import type { Brand, EmailAnalysis } from "@/lib/types";
import { Badge, BrandChip, Card, CategoryBadge, EmptyState, inputClass, PageHeader, secondaryButtonClass, Table } from "@/components/ui";

const PAGE = 50;

export default async function EmailsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const sb = await db();
  const brands = must(await sb.from("brands").select("*").order("name")) as Brand[];

  // Category filter needs the analysis table: resolve matching ids first.
  let categoryIds: string[] | null = null;
  if (sp.category) {
    const ids = must(
      await sb.from("email_analyses").select("email_id").or(`categories.cs.{${sp.category}},manual_categories.cs.{${sp.category}},industry_categories.cs.{${sp.category}}`).limit(5000),
    ) as { email_id: string }[];
    categoryIds = ids.length ? ids.map((r) => r.email_id) : ["00000000-0000-0000-0000-000000000000"];
  }

  const term = (sp.q ?? "").replace(/[%,()]/g, " ").trim();
  // Accent-insensitive search uses the search_text column; falls back to plain matching if it doesn't exist yet.
  const run = (accentInsensitive: boolean) => {
    let q = sb.from("emails").select(EMAIL_LIGHT_COLUMNS, { count: "exact" });
    if (sp.brand) q = q.eq("brand_id", sp.brand);
    if (sp.type === "promotional") q = q.eq("is_promotional", true);
    else if (sp.type) q = q.eq("email_type", sp.type);
    if (sp.status) q = q.eq("processing_status", sp.status);
    if (term) {
      q = accentInsensitive
        ? q.ilike("search_text", `%${term.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()}%`)
        : q.or(`subject.ilike.%${term}%,preview_text.ilike.%${term}%`);
    }
    if (sp.campaign) q = q.eq("campaign_id", sp.campaign);
    if (sp.account) q = q.eq("test_account_id", sp.account);
    if (categoryIds) q = q.in("id", categoryIds);
    return q.order("sent_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
  };
  let res = await run(Boolean(term));
  if (res.error && term) res = await run(false);
  const emails = must(res) as unknown as EmailLight[];
  const total = res.count ?? 0;
  const analyses = emails.length ? (must(await sb.from("email_analyses").select("*").in("email_id", emails.map((e) => e.id))) as EmailAnalysis[]) : [];
  const byId = new Map(analyses.map((a) => [a.email_id, a]));
  const offers = emails.length
    ? ((await sb.from("offers").select("email_id, incentive_text, headline, promo_code").in("email_id", emails.map((e) => e.id))).data ?? [])
    : [];
  const offersBy = new Map<string, { incentive_text: string | null; headline: string | null; promo_code: string | null }[]>();
  for (const o of offers as { email_id: string; incentive_text: string | null; headline: string | null; promo_code: string | null }[]) {
    offersBy.set(o.email_id, [...(offersBy.get(o.email_id) ?? []), o]);
  }
  const brandIdx = new Map(brands.map((b, i) => [b.id, i]));

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/emails?${p.toString()}`;
  };

  return (
    <>
      <PageHeader title="Emails" description={`${total.toLocaleString()} emails from tracked brands. Only mail from brands you track is ever stored.`} />

      <form key={JSON.stringify(sp)} className="mb-4 flex flex-wrap items-center gap-2" action="/emails">
        <input name="q" defaultValue={sp.q} placeholder="Search subject or preview…" className={`${inputClass} max-w-xs`} />
        <select name="brand" defaultValue={sp.brand ?? ""} className={`${inputClass} w-auto`}>
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select name="type" defaultValue={sp.type ?? ""} className={`${inputClass} w-auto`}>
          <option value="">All types</option>
          {EMAIL_TYPES.map((t) => (
            <option key={t} value={t}>
              {label(t)}
            </option>
          ))}
        </select>
        <select name="category" defaultValue={sp.category ?? ""} className={`${inputClass} w-auto`}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {label(c)}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={sp.status ?? ""} className={`${inputClass} w-auto`}>
          <option value="">Any status</option>
          {["pending", "processing", "analyzed", "error"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button className={secondaryButtonClass}>Filter</button>
        {Object.keys(sp).length > 0 && (
          <Link href="/emails" className="text-sm text-accent hover:underline">
            Clear
          </Link>
        )}
      </form>

      {emails.length === 0 ? (
        <EmptyState title="No emails match">
          Connect the research mailbox in <Link href="/settings" className="text-accent hover:underline">Settings</Link> and run a sync.
        </EmptyState>
      ) : (
        <Card bodyClassName="p-0">
          <Table head={["Brand", "Subject", "Type", "Categories", "Offers / codes", "Sent"]}>
            {emails.map((e) => {
              const brand = brands.find((b) => b.id === e.brand_id);
              const a = byId.get(e.id);
              return (
                <tr key={e.id} className="align-top">
                  <td className="px-3 py-2">{brand && <BrandChip name={brand.name} color={brandColor(brand, brandIdx.get(brand.id) ?? 0)} logo={brand.logo_url} />}</td>
                  <td className="max-w-md px-3 py-2">
                    <Link href={`/emails/${e.id}`} className="font-medium text-ink hover:underline">
                      {e.subject ?? "(no subject)"}
                    </Link>
                    <div className="line-clamp-1 text-xs text-muted">{a?.summary ?? e.preview_text}</div>
                  </td>
                  <td className="px-3 py-2">
                    {e.processing_status !== "analyzed" ? (
                      <Badge tone={e.processing_status === "error" ? "bad" : "neutral"}>{e.processing_status}</Badge>
                    ) : (
                      <Badge tone={e.is_promotional ? "accent" : "neutral"}>{label(e.email_type)}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex max-w-xs flex-wrap gap-1">
                      {categoriesOf(a).slice(0, 3).map((c) => (
                        <CategoryBadge key={c} category={c} />
                      ))}
                    </div>
                  </td>
                  <td className="max-w-[14rem] px-3 py-2 text-xs text-ink-2">
                    {(offersBy.get(e.id) ?? []).slice(0, 2).map((o, i) => (
                      <div key={i} className="truncate" title={o.headline ?? ""}>
                        {o.incentive_text ?? o.headline}
                      </div>
                    ))}
                    {(() => {
                      const codes = [...new Set([...e.promo_codes, ...(offersBy.get(e.id) ?? []).map((o) => o.promo_code).filter((c): c is string => !!c)])];
                      return codes.length ? <div className="font-mono">{codes.join(", ")}</div> : null;
                    })()}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-ink-2">{fmtDateTime(e.sent_at)}</td>
                </tr>
              );
            })}
          </Table>
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-ink-2">
            <span>
              {page * PAGE + 1}–{Math.min(total, page * PAGE + PAGE)} of {total}
            </span>
            <span className="flex gap-3">
              {page > 0 && (
                <Link href={qs({ page: String(page - 1) })} className="text-accent hover:underline">
                  ← Newer
                </Link>
              )}
              {(page + 1) * PAGE < total && (
                <Link href={qs({ page: String(page + 1) })} className="text-accent hover:underline">
                  Older →
                </Link>
              )}
            </span>
          </div>
        </Card>
      )}
    </>
  );
}
