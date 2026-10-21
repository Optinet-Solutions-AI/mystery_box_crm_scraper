import { Suspense } from "react";
import { brandColor, loadFilterOptions } from "@/lib/data";
import { FilterBar, type FilterBarProps } from "./filter-bar";

/** Server wrapper: loads filter options and renders the client filter bar. */
export async function Filters(props: Pick<FilterBarProps, "show" | "maxBrands">) {
  const o = await loadFilterOptions();
  const brandName = new Map(o.brands.map((b) => [b.id, b.name]));
  return (
    <Suspense fallback={<div className="mb-6 h-9" />}>
      <FilterBar
        {...props}
        brands={o.brands.map((b, i) => ({ id: b.id, name: b.name, color: brandColor(b, i) }))}
        industries={o.industries.filter((i) => o.brands.some((b) => b.industry_id === i.id)).map((i) => ({ id: i.id, name: i.name }))}
        countries={o.countries}
        accounts={o.accounts.map((a) => ({ id: a.id, name: `${brandName.get(a.brand_id) ?? "?"} · ${a.persona}` }))}
      />
    </Suspense>
  );
}
