import { label } from "@/lib/constants";
import { fmtDateTime } from "@/lib/format";
import type { Industry, Offer } from "@/lib/types";
import { Badge, DefList } from "./ui";

/** Full structured view of one extracted offer, with its verbatim evidence. */
export function OfferCard({ offer: o, industry }: { offer: Offer; industry?: Industry | null }) {
  const fields = industry?.extra_offer_fields ?? [];
  const extra = Object.entries(o.industry_fields ?? {});
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone="accent">{label(o.offer_type)}</Badge>
        <span className="text-sm font-medium text-ink">{o.headline}</span>
        <span className="ml-auto text-xs text-muted">confidence {Math.round(Number(o.confidence ?? 0) * 100)}%</span>
      </div>
      <DefList
        items={[
          ["Incentive", o.incentive_text],
          ["Value", o.incentive_value != null ? `${o.incentive_value}${o.incentive_unit === "percent" ? "%" : ` ${o.incentive_unit ?? ""}`}${o.currency ? ` ${o.currency}` : ""}` : null],
          ["Minimum requirement", o.min_requirement],
          ["Maximum reward", o.max_reward],
          ["Promo code", o.promo_code ? <code key="c" className="rounded bg-surface-2 px-1">{o.promo_code}</code> : null],
          ["Eligibility", o.eligibility],
          ["Geographic limits", o.geo_restrictions],
          ["Starts", o.starts_at ? `${fmtDateTime(o.starts_at)}${o.starts_text ? ` (“${o.starts_text}”)` : ""}` : o.starts_text],
          ["Ends", o.ends_at ? `${fmtDateTime(o.ends_at)}${o.ends_text ? ` (“${o.ends_text}”)` : ""}` : o.ends_text],
          ["Products / category", o.product_category],
          ["Conditions", o.conditions],
          ["CTA", o.cta_text ? `${o.cta_text}${o.cta_url ? ` → ${o.cta_url}` : ""}` : o.cta_url],
          ...extra.map(([k, v]) => [fields.find((f) => f.key === k)?.label ?? k, v.value] as [string, string]),
        ]}
      />
      {o.source_evidence && (
        <blockquote className="mt-3 border-l-2 border-accent pl-3 text-xs text-ink-2 italic">“{o.source_evidence}”</blockquote>
      )}
    </div>
  );
}
