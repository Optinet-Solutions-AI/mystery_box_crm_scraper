import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import { categoryGroup, label } from "@/lib/constants";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className, bodyClassName }: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx("rounded-xl border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={clsx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function KpiCard({ label: l, value, hint, delta, href }: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  delta?: { value: number; goodWhenUp?: boolean } | null;
  href?: string;
}) {
  const body = (
    <div className="h-full rounded-xl border border-line bg-surface p-4 transition-colors hover:bg-surface-2">
      <div className="text-xs font-medium text-ink-2">{l}</div>
      <div className="mt-2 text-3xl font-semibold text-ink">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
        {delta && delta.value !== 0 && (
          <span className={clsx("font-medium", delta.value > 0 ? "text-good" : "text-bad")}>
            {delta.value > 0 ? "▲" : "▼"} {Math.abs(delta.value)}%
          </span>
        )}
        {hint}
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Badge({ children, tone = "neutral", className, title }: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "good" | "warn" | "bad";
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        tone === "neutral" && "border-line bg-surface-2 text-ink-2",
        tone === "accent" && "border-accent/30 bg-accent/10 text-accent",
        tone === "good" && "border-good/30 bg-good/10 text-good",
        tone === "warn" && "border-[#fab219]/40 bg-[#fab219]/15 text-ink",
        tone === "bad" && "border-bad/30 bg-bad/10 text-bad",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Category badge: color dot (by group) + text label, so identity never relies on color alone. */
export function CategoryBadge({ category }: { category: string }) {
  const g = categoryGroup(category);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2 whitespace-nowrap">
      <span className="h-2 w-2 rounded-full" style={{ background: g.color }} aria-hidden />
      {label(category)}
    </span>
  );
}

export function BrandChip({ name, color, href, logo }: { name: string; color: string; href?: string; logo?: string | null }) {
  const inner = (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className="h-4 w-4 rounded-sm object-contain" />
      ) : (
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden />
      )}
      {name}
    </span>
  );
  return href ? (
    <Link href={href} className="hover:underline">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-ink-2">{children}</div>}
    </div>
  );
}

export function Field({ label: l, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink-2">{l}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";
export const buttonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50";
export const secondaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50";

/** Shows a label/value pair; null values render as "Not stated" (never invented). */
export function DefList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(140px,auto)_1fr]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-2">{k}</dt>
          <dd className="text-ink">{v == null || v === "" ? <span className="text-muted">Not stated</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={clsx("overflow-x-auto", className)}>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-ink-2">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line tabular">{children}</tbody>
      </table>
    </div>
  );
}

export function Loading({ label: l = "Loading…" }: { label?: string }) {
  return <div className="animate-pulse py-10 text-center text-sm text-muted">{l}</div>;
}
