import Link from "next/link";
import { connection } from "next/server";
import { LifecycleTimeline, LifecycleWeeklyBars, type TimelineLane } from "@/components/charts/lifecycle-timeline";
import { Badge, Card, CategoryBadge, EmptyState, PageHeader, Table, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import { BRAND_PALETTE, label } from "@/lib/constants";
import { fmtDateTime } from "@/lib/format";
import { fmtOffset, loadLifecycles, STAGE_LABELS, type AccountLifecycle, type Stage } from "@/lib/lifecycle";
import { addRecordedEvent, removeRecordedEvent, updateRegisteredAt } from "./actions";
import { AccountPicker } from "./account-picker";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

function laneOf(l: AccountLifecycle): TimelineLane {
  return {
    id: l.account.id,
    title: l.brand.name,
    subtitle: `${l.account.persona} · ${l.account.email}`,
    marks: l.events.map((e) => ({
      emailId: e.emailId,
      hours: e.hours,
      at: e.at,
      subject: e.subject,
      groupKey: e.group.key,
      groupLabel: e.group.label,
      color: e.group.color,
      categoryLabels: e.categories.map((c) => label(c)),
      offerText: e.offers[0] ? (e.offers[0].incentive_text ?? e.offers[0].headline) : null,
    })),
    recorded: l.recorded.filter((r) => r.hours != null).map((r) => ({ hours: r.hours!, at: r.at, type: r.type, note: r.note })),
  };
}

const hrs = (h: number | null) => (h == null ? <span className="text-muted">Not observed</span> : fmtOffset(h));

/** datetime-local value in the server's local time (good enough for an internal tool). */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function LifecyclePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await connection();
  const horizon = Math.min(180, Math.max(1, Number(one(sp.horizon) ?? 30) || 30));
  const lifecycles = await loadLifecycles();
  const registered = lifecycles.filter((l) => l.registeredAt);
  const unregistered = lifecycles.filter((l) => !l.registeredAt);

  const requested = (one(sp.accounts) ?? "").split(",").filter(Boolean);
  const selectedIds = requested.length ? requested.filter((id) => registered.some((l) => l.account.id === id)) : registered.slice(0, 6).map((l) => l.account.id);
  const selected = selectedIds.map((id) => registered.find((l) => l.account.id === id)!).filter(Boolean);

  const brandIndex = new Map<string, number>();
  for (const l of lifecycles) if (!brandIndex.has(l.brand.id)) brandIndex.set(l.brand.id, brandIndex.size);
  const colorOf = (l: AccountLifecycle) => l.brand.color || BRAND_PALETTE[(brandIndex.get(l.brand.id) ?? 0) % BRAND_PALETTE.length];

  return (
    <div className="space-y-6">
      <PageHeader
        title="CRM lifecycle & journeys"
        description="What each test account received from the moment it signed up. These are observed behaviors for these specific test accounts, not guaranteed sequences for every customer. Deposits, purchases and other actions only appear when you record them."
      />

      {lifecycles.length === 0 && (
        <EmptyState title="No test accounts yet">
          Add a brand and sign up on the <Link href="/brands" className="text-accent underline">Brands</Link> page. Each signup creates a test account whose journey appears here.
        </EmptyState>
      )}

      {unregistered.length > 0 && (
        <Card title="Signup time missing" subtitle="Day 0 is unknown for these accounts, so their journey can't be aligned yet.">
          <ul className="space-y-2 text-sm">
            {unregistered.map((l) => (
              <li key={l.account.id} className="flex flex-wrap items-center gap-3">
                <span className="font-medium text-ink">{l.brand.name}</span>
                <span className="text-ink-2">
                  {l.account.persona} · {l.account.email}
                </span>
                <form action={updateRegisteredAt} className="flex items-center gap-2">
                  <input type="hidden" name="account_id" value={l.account.id} />
                  <input type="datetime-local" name="registered_at" required className={`${inputClass} w-auto py-1`} />
                  <button className={secondaryButtonClass}>Set signup time</button>
                </form>
                <Link href={`/brands/${l.brand.id}`} className="text-xs text-accent hover:underline">
                  Open brand
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {registered.length > 0 && (
        <>
          <Card title="Journey comparison" subtitle={`Aligned on signup time · first ${horizon} days · hover a mark for details, click to open the email`}>
            <div className="mb-4">
              <AccountPicker
                options={registered.map((l) => ({ id: l.account.id, label: `${l.brand.name} · ${l.account.persona}`, color: colorOf(l), registered: true }))}
                selected={selectedIds}
                horizon={horizon}
              />
            </div>
            {selected.length === 0 ? (
              <EmptyState title="Pick at least one account to show its journey." />
            ) : (
              <>
                <LifecycleTimeline lanes={selected.map(laneOf)} horizonDays={horizon} />
                <div className="mt-5 space-y-2">
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Observed sequence</h3>
                  {selected.map((l) => (
                    <p key={l.account.id} className="text-sm text-ink-2">
                      <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                        <span className="h-2 w-2 rounded-full" style={{ background: colorOf(l) }} />
                        {l.brand.name} ({l.account.persona}):
                      </span>{" "}
                      {l.sequenceSummary}
                    </p>
                  ))}
                </div>
              </>
            )}
          </Card>

          <Card title="Lifecycle metrics" subtitle="Counts include every email the account received (promotional and transactional). Day ranges are measured from the recorded signup time.">
            <Table
              head={["Account", "Signed up", "First email", "First welcome", "First 24h", "Days 1–7", "Days 8–30", "First offer", "Avg gap (promo)", "Loyalty/VIP", "Reactivation", "Transactional", "Emails / week since signup"]}
            >
              {registered.map((l) => (
                <tr key={l.account.id} className="align-top">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                      <span className="h-2 w-2 rounded-full" style={{ background: colorOf(l) }} />
                      {l.brand.name}
                    </span>
                    <div className="text-xs text-muted">{l.account.persona}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(l.registeredAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{hrs(l.hoursToFirstEmail)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{hrs(l.hoursToWelcome)}</td>
                  <td className="px-3 py-2">{l.first24h}</td>
                  <td className="px-3 py-2">{l.days1to7}</td>
                  <td className="px-3 py-2">{l.days8to30}</td>
                  <td className="px-3 py-2 min-w-[160px]">
                    {l.firstOffer ? (
                      <Link href={`/emails/${l.firstOffer.event.emailId}`} className="hover:underline">
                        <span className="text-ink">{l.firstOffer.offer.incentive_text ?? l.firstOffer.offer.headline}</span>
                        <span className="block text-xs text-muted">{fmtOffset(l.firstOffer.event.hours)}</span>
                      </Link>
                    ) : (
                      <span className="text-muted">Not observed</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{l.avgGapHours == null ? "—" : l.avgGapHours < 48 ? `${l.avgGapHours}h` : `${Math.round(l.avgGapHours / 24)}d`}</td>
                  <td className="px-3 py-2">{l.loyaltyCount}</td>
                  <td className="px-3 py-2">{l.reactivationCount}</td>
                  <td className="px-3 py-2">{l.transactionalCount}</td>
                  <td className="px-3 py-2">
                    <LifecycleWeeklyBars counts={l.weeklyFrequency} />
                  </td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title="Incentives by stage" subtitle="Offer types observed at each stage after signup (count of offers).">
            <Table head={["Account", ...(Object.keys(STAGE_LABELS) as Stage[]).map((s) => STAGE_LABELS[s])]}>
              {registered.map((l) => (
                <tr key={l.account.id} className="align-top">
                  <td className="px-3 py-2 font-medium whitespace-nowrap text-ink">
                    {l.brand.name} <span className="font-normal text-muted">· {l.account.persona}</span>
                  </td>
                  {(Object.keys(STAGE_LABELS) as Stage[]).map((s) => {
                    const entries = Object.entries(l.stageIncentives[s]);
                    return (
                      <td key={s} className="px-3 py-2">
                        {entries.length === 0 ? (
                          <span className="text-muted">None observed</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {entries.map(([k, n]) => (
                              <Badge key={k}>
                                {label(k)} ×{n}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </Table>
          </Card>

          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-ink">Account timelines</h2>
            {registered.map((l) => (
              <details key={l.account.id} className="rounded-xl border border-line bg-surface">
                <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                    <span className="h-2 w-2 rounded-full" style={{ background: colorOf(l) }} />
                    {l.brand.name} · {l.account.persona}
                  </span>
                  <span className="text-ink-2">{l.account.email}</span>
                  <span className="text-muted">
                    {l.events.length} emails since signup{l.preSignupCount ? ` · ${l.preSignupCount} before signup (excluded)` : ""}
                  </span>
                </summary>
                <div className="grid gap-6 border-t border-line p-4 lg:grid-cols-[1fr_320px]">
                  <ol className="space-y-2">
                    {[
                      ...l.events.map((e) => ({ t: e.hours, kind: "email" as const, e })),
                      ...l.recorded.map((r, i) => ({ t: r.hours ?? 0, kind: "rec" as const, r, i })),
                    ]
                      .sort((a, b) => a.t - b.t)
                      .map((item) =>
                        item.kind === "email" ? (
                          <li key={item.e.emailId} className="flex gap-3 text-sm">
                            <span className="w-20 shrink-0 text-xs text-muted tabular">{fmtOffset(item.e.hours)}</span>
                            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: item.e.group.color }} />
                            <div className="min-w-0">
                              <Link href={`/emails/${item.e.emailId}`} className="font-medium text-ink hover:underline">
                                {item.e.subject ?? "(no subject)"}
                              </Link>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {item.e.categories.slice(0, 4).map((c) => (
                                  <CategoryBadge key={c} category={c} />
                                ))}
                                {!item.e.isPromotional && <Badge>{label(item.e.emailType ?? "transactional")}</Badge>}
                                {item.e.offers.map((o) => (
                                  <Badge key={o.id} tone="accent">
                                    {o.incentive_text ?? o.headline}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          </li>
                        ) : (
                          <li key={`rec-${item.i}`} className="flex gap-3 text-sm">
                            <span className="w-20 shrink-0 text-xs text-muted tabular">{item.r.hours == null ? "—" : fmtOffset(item.r.hours)}</span>
                            <span className="mt-1 shrink-0 text-xs text-ink">◆</span>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-ink">Recorded: {item.r.type}</span>
                              {item.r.note && <span className="text-ink-2">{item.r.note}</span>}
                              <form action={removeRecordedEvent}>
                                <input type="hidden" name="account_id" value={l.account.id} />
                                <input type="hidden" name="index" value={item.i} />
                                <button className="text-xs text-muted hover:text-bad">Remove</button>
                              </form>
                            </div>
                          </li>
                        ),
                      )}
                    {l.events.length === 0 && l.recorded.length === 0 && <li className="text-sm text-muted">No emails received since signup yet.</li>}
                  </ol>

                  <div className="space-y-5">
                    <form action={updateRegisteredAt} className="space-y-2">
                      <input type="hidden" name="account_id" value={l.account.id} />
                      <div className="text-xs font-medium text-ink-2">Signup time (day 0)</div>
                      <input type="datetime-local" name="registered_at" defaultValue={toLocalInput(l.registeredAt)} className={inputClass} />
                      <button className={secondaryButtonClass}>Save signup time</button>
                    </form>
                    <form action={addRecordedEvent} className="space-y-2">
                      <input type="hidden" name="account_id" value={l.account.id} />
                      <div className="text-xs font-medium text-ink-2">Record an action on this account</div>
                      <select name="type" className={inputClass} defaultValue="deposit">
                        <option value="deposit">Deposit / top-up</option>
                        <option value="purchase">Purchase / box opened</option>
                        <option value="login">Login / visit</option>
                        <option value="withdrawal">Withdrawal / sell-back</option>
                        <option value="email_click">Clicked an email</option>
                        <option value="kyc">KYC / verification</option>
                        <option value="inactive_start">Went inactive (stopped engaging)</option>
                        <option value="other">Other</option>
                      </select>
                      <input type="datetime-local" name="at" required className={inputClass} />
                      <input type="text" name="note" placeholder="Note (amount, item…)" className={inputClass} />
                      <button className={buttonClass}>Add action</button>
                      <p className="text-xs text-muted">Actions are never inferred from emails; only what you record here appears on the timeline.</p>
                    </form>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
