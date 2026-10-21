import "server-only";
import { label } from "./constants";
import { categoriesOf, type Dataset } from "./data";
import { fmtMoney, fmtPct } from "./format";
import type { BrandStats } from "./metrics";
import { db, must } from "./supabase";
import type { Brand, EmailAnalysis, TestAccount } from "./types";

export type Evidence = { label: string; href: string };
export type BenchmarkAnswer = { question: string; answer: string; detail?: string; evidence: Evidence[] };

const RETENTION = new Set(["retention", "reactivation", "loyalty_vip"]);

function brandName(ds: Dataset, id: string | null | undefined) {
  return ds.brands.find((b) => b.id === id)?.name ?? "Unknown brand";
}

function promoOffers(ds: Dataset) {
  const promoIds = new Set(ds.promoEmails.map((e) => e.id));
  return ds.offers.filter((o) => promoIds.has(o.email_id));
}

/** Deterministic answers to the spec's benchmark questions, each with links to evidence. */
export function computeBenchmarks(ds: Dataset, prev: Dataset, stats: BrandStats[], prevStats: BrandStats[]): BenchmarkAnswer[] {
  const out: BenchmarkAnswer[] = [];
  const offers = promoOffers(ds);

  // 1. Highest advertised incentive — percent and amount reported separately.
  const pct = offers
    .filter((o) => o.incentive_unit === "percent" && o.incentive_value != null)
    .sort((a, b) => Number(b.incentive_value) - Number(a.incentive_value))[0];
  out.push(
    pct
      ? {
          question: "Which competitor offers the highest advertised bonus (percentage)?",
          answer: `${brandName(ds, pct.brand_id)}: ${pct.incentive_text ?? `${pct.incentive_value}%`}`,
          detail: [pct.headline, pct.min_requirement && `Min: ${pct.min_requirement}`, pct.max_reward && `Cap: ${pct.max_reward}`, pct.conditions && `Conditions: ${pct.conditions}`]
            .filter(Boolean)
            .join(" · "),
          evidence: [{ label: "Source email", href: `/emails/${pct.email_id}` }],
        }
      : { question: "Which competitor offers the highest advertised bonus (percentage)?", answer: "No percentage-based offers observed in this period.", evidence: [] },
  );

  const money = offers.filter((o) => o.incentive_unit === "currency" && o.incentive_value != null);
  const byCurrency = new Map<string, (typeof money)[number]>();
  for (const o of money) {
    const c = o.currency ?? "Unknown currency";
    const cur = byCurrency.get(c);
    if (!cur || Number(o.incentive_value) > Number(cur.incentive_value)) byCurrency.set(c, o);
  }
  out.push(
    byCurrency.size
      ? {
          question: "Which competitor offers the highest advertised bonus (amount)?",
          answer: [...byCurrency.values()]
            .map((o) => `${brandName(ds, o.brand_id)}: ${fmtMoney(Number(o.incentive_value), o.currency)}`)
            .join(" · "),
          detail: byCurrency.size > 1 ? "Amounts in different currencies are not converted or compared with each other." : (money[0]?.headline ?? undefined),
          evidence: [...byCurrency.values()].map((o) => ({ label: `${brandName(ds, o.brand_id)} email`, href: `/emails/${o.email_id}` })),
        }
      : { question: "Which competitor offers the highest advertised bonus (amount)?", answer: "No amount-based offers observed in this period.", evidence: [] },
  );

  // 2. Most promotional campaigns.
  const byCampaigns = [...stats].sort((a, b) => b.uniqueCampaigns - a.uniqueCampaigns || b.promoEmails - a.promoEmails);
  const top = byCampaigns[0];
  out.push(
    top && top.uniqueCampaigns > 0
      ? {
          question: "Who is sending the most promotional campaigns?",
          answer: `${top.brand.name}: ${top.uniqueCampaigns} estimated unique campaigns from ${top.promoEmails} promotional emails`,
          detail: byCampaigns
            .slice(1, 4)
            .map((s) => `${s.brand.name} ${s.uniqueCampaigns}`)
            .join(" · ") || undefined,
          evidence: [{ label: `${top.brand.name} campaigns`, href: `/campaigns?brands=${top.brand.id}` }],
        }
      : { question: "Who is sending the most promotional campaigns?", answer: "No promotional campaigns observed in this period.", evidence: [] },
  );

  // 3. Cashback frequency.
  const cashback = stats
    .map((s) => {
      const emails = ds.promoEmails.filter(
        (e) => e.brand_id === s.brand.id && (categoriesOf(e.analysis).includes("cashback") || offers.some((o) => o.email_id === e.id && o.offer_type === "cashback")),
      );
      return { s, emails, share: s.promoEmails ? emails.length / s.promoEmails : 0 };
    })
    .filter((x) => x.emails.length > 0)
    .sort((a, b) => b.emails.length - a.emails.length || b.share - a.share);
  out.push(
    cashback.length
      ? {
          question: "Which brands promote cashback most frequently?",
          answer: cashback.map((c) => `${c.s.brand.name}: ${c.emails.length} emails (${fmtPct(c.share)} of promo)`).join(" · "),
          evidence: cashback.flatMap((c) => c.emails.slice(0, 2).map((e) => ({ label: `${c.s.brand.name}: ${e.subject ?? "email"}`, href: `/emails/${e.id}` }))),
        }
      : { question: "Which brands promote cashback most frequently?", answer: "No cashback promotions observed in this period.", evidence: [] },
  );

  // 4. New retention campaigns started this period.
  const { from, to } = ds.filters;
  const retention = ds.campaigns.filter(
    (c) =>
      c.first_seen_at &&
      new Date(c.first_seen_at) >= from &&
      new Date(c.first_seen_at) <= to &&
      (RETENTION.has(c.primary_category ?? "") || c.categories.some((x) => RETENTION.has(x))),
  );
  out.push(
    retention.length
      ? {
          question: "Who started a new retention campaign this period?",
          answer: [...new Set(retention.map((c) => brandName(ds, c.brand_id)))].join(", "),
          detail: `${retention.length} campaign${retention.length > 1 ? "s" : ""} (retention, reactivation or loyalty/VIP). Campaign grouping is inferred.`,
          evidence: retention.slice(0, 6).map((c) => ({ label: `${brandName(ds, c.brand_id)}: ${c.title}`, href: `/campaigns/${c.id}` })),
        }
      : { question: "Who started a new retention campaign this period?", answer: "No new retention, reactivation or loyalty campaigns observed in this period.", evidence: [] },
  );

  // 5. Brand A vs Brand B.
  if (stats.length >= 2) {
    const [a, b] = stats;
    const pa = prevStats.find((p) => p.brand.id === a.brand.id);
    const pb = prevStats.find((p) => p.brand.id === b.brand.id);
    const line = (s: BrandStats, p?: BrandStats) =>
      `${s.brand.name}: ${s.emailsPerWeek}/wk (was ${p?.emailsPerWeek ?? 0}), ${s.uniqueCampaigns} campaigns (was ${p?.uniqueCampaigns ?? 0}), offers in ${fmtPct(s.offerRate)} of emails (was ${fmtPct(p?.offerRate ?? 0)}), urgency ${fmtPct(s.urgencyRate)} (was ${fmtPct(p?.urgencyRate ?? 0)})`;
    const newTypes = (s: BrandStats, p?: BrandStats) =>
      Object.keys(s.offerTypeCounts).filter((t) => !p || !(t in p.offerTypeCounts)).map(label);
    const na = newTypes(a, pa);
    const nb = newTypes(b, pb);
    out.push({
      question: `How has ${a.brand.name} changed compared with ${b.brand.name}?`,
      answer: `${line(a, pa)}. ${line(b, pb)}.`,
      detail: [na.length && `${a.brand.name} new offer types: ${na.join(", ")}`, nb.length && `${b.brand.name} new offer types: ${nb.join(", ")}`]
        .filter(Boolean)
        .join(" · ") || "No new offer types for either brand vs the previous period.",
      evidence: [
        { label: `${a.brand.name} brand page`, href: `/brands/${a.brand.id}` },
        { label: `${b.brand.name} brand page`, href: `/brands/${b.brand.id}` },
      ],
    });
  }
  void prev;
  return out;
}

// ─── Lifecycle timing (from manually recorded registration dates) ──────

export type LifecycleTiming = {
  accountEmail: string;
  registeredAt: string;
  firstEmail: { id: string; hours: number } | null;
  welcomeEmail: { id: string; hours: number } | null;
  emailsFirst7Days: number;
  sequence: { id: string; day: number; category: string | null }[];
};

/** Per brand: timing of the earliest registered test account's first emails. */
export async function loadLifecycleTiming(brands: Brand[]): Promise<Record<string, LifecycleTiming | null>> {
  const sb = await db();
  const result: Record<string, LifecycleTiming | null> = Object.fromEntries(brands.map((b) => [b.id, null]));
  if (brands.length === 0) return result;
  const accounts = must(
    await sb
      .from("test_accounts")
      .select("*")
      .in("brand_id", brands.map((b) => b.id))
      .not("registered_at", "is", null)
      .order("registered_at", { ascending: true }),
  ) as TestAccount[];
  const firstPerBrand = new Map<string, TestAccount>();
  for (const a of accounts) if (!firstPerBrand.has(a.brand_id)) firstPerBrand.set(a.brand_id, a);
  const chosen = [...firstPerBrand.values()];
  if (chosen.length === 0) return result;

  const emails = must(
    await sb
      .from("emails")
      .select("id, test_account_id, sent_at, is_promotional")
      .in("test_account_id", chosen.map((a) => a.id))
      .order("sent_at", { ascending: true })
      .limit(2000),
  ) as { id: string; test_account_id: string; sent_at: string; is_promotional: boolean | null }[];
  const analyses = emails.length
    ? (must(
        await sb
          .from("email_analyses")
          .select("email_id, categories, manual_categories, industry_categories, primary_category")
          .in("email_id", emails.map((e) => e.id).slice(0, 1000)),
      ) as Pick<EmailAnalysis, "email_id" | "categories" | "manual_categories" | "industry_categories" | "primary_category">[])
    : [];
  const byEmail = new Map(analyses.map((a) => [a.email_id, a]));

  for (const acc of chosen) {
    const reg = new Date(acc.registered_at!).getTime();
    const mine = emails.filter((e) => e.test_account_id === acc.id && e.sent_at && new Date(e.sent_at).getTime() >= reg - 3_600_000);
    const hours = (e: { sent_at: string }) => Math.max(0, (new Date(e.sent_at).getTime() - reg) / 3_600_000);
    const welcome = mine.find((e) => categoriesOf(byEmail.get(e.id) as EmailAnalysis | undefined).includes("welcome_onboarding"));
    result[acc.brand_id] = {
      accountEmail: acc.email,
      registeredAt: acc.registered_at!,
      firstEmail: mine[0] ? { id: mine[0].id, hours: hours(mine[0]) } : null,
      welcomeEmail: welcome ? { id: welcome.id, hours: hours(welcome) } : null,
      emailsFirst7Days: mine.filter((e) => hours(e) <= 168).length,
      sequence: mine.slice(0, 5).map((e) => ({
        id: e.id,
        day: Math.floor(hours(e) / 24),
        category: byEmail.get(e.id)?.primary_category ?? null,
      })),
    };
  }
  return result;
}

export function fmtHours(h: number | null | undefined) {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round((h / 24) * 10) / 10} days`;
}
