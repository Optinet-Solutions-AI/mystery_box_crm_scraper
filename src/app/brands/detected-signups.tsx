import { matchBrand } from "@/lib/email/match";
import { label } from "@/lib/constants";
import { fmtAgo, fmtDateTime } from "@/lib/format";
import type { Brand, Industry } from "@/lib/types";
import { ApiButton } from "@/components/api-button";
import { Badge, buttonClass, Card, Field, inputClass, secondaryButtonClass } from "@/components/ui";
import { confirmCandidate, dismissCandidate, restoreCandidate } from "./actions";

export type Candidate = {
  id: string;
  domain: string;
  display_name: string | null;
  sender_emails: string[];
  email_count: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  sample_subjects: string[];
  signup_detected_at: string | null;
  signup_subject: string | null;
  ai_checked_at: string | null;
  ai_is_target: boolean | null;
  ai_vertical: string | null;
  ai_brand_name: string | null;
  ai_website: string | null;
  ai_confidence: number | null;
  ai_reason: string | null;
  status: "pending" | "confirmed" | "dismissed";
};

function ConfirmForm({ c, industries, primary }: { c: Candidate; industries: Industry[]; primary: boolean }) {
  return (
    <form action={confirmCandidate.bind(null, c.id)} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto_auto] sm:items-end">
      <Field label="Brand name">
        <input name="name" defaultValue={c.ai_brand_name ?? c.display_name ?? ""} className={inputClass} />
      </Field>
      <Field label="Website domain">
        <input name="domain" defaultValue={c.ai_website ?? c.domain} className={inputClass} />
      </Field>
      <Field label="Industry">
        <select name="industry_id" defaultValue="mystery_box" className={inputClass}>
          {industries.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </Field>
      <button className={primary ? buttonClass : secondaryButtonClass}>{primary ? "Confirm & track" : "Track anyway"}</button>
      <button formAction={dismissCandidate.bind(null, c.id)} className="px-2 py-2 text-sm text-ink-2 hover:text-bad">
        Dismiss
      </button>
    </form>
  );
}

function CandidateCard({ c, industries }: { c: Candidate; industries: Industry[] }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`https://www.google.com/s2/favicons?domain=${c.domain}&sz=32`} alt="" className="h-4 w-4 rounded-sm" />
            <span className="text-sm font-semibold text-ink">{c.ai_brand_name ?? c.display_name ?? c.domain}</span>
            <span className="text-xs text-muted">{c.domain}</span>
          </div>
          <div className="mt-1 text-xs text-ink-2">
            {c.signup_detected_at ? (
              <>
                Signup detected {fmtDateTime(c.signup_detected_at)}
                {c.signup_subject && <> — “{c.signup_subject}”</>}
              </>
            ) : (
              <>First email {fmtDateTime(c.first_seen_at)}</>
            )}
            {" · "}
            {c.email_count} email{c.email_count === 1 ? "" : "s"} · last {fmtAgo(c.last_seen_at)}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {c.ai_checked_at ? (
            <>
              {c.ai_vertical && <Badge>{label(c.ai_vertical)}</Badge>}
              <Badge tone={c.ai_is_target ? "good" : "neutral"}>
                {c.ai_is_target ? "✓ Looks like a target operator" : "Not a target"} · {Math.round(Number(c.ai_confidence ?? 0) * 100)}%
              </Badge>
            </>
          ) : (
            <Badge>Not reviewed yet</Badge>
          )}
        </div>
      </div>
      {c.ai_reason && <p className="mt-2 text-xs text-ink-2">{c.ai_reason}</p>}
      {c.sample_subjects.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted">
          {c.sample_subjects.slice(0, 3).map((s, i) => (
            <li key={i} className="truncate">
              • {s}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        <ConfirmForm c={c} industries={industries} primary={c.ai_is_target !== false} />
      </div>
    </div>
  );
}

/**
 * Operators signed up to outside the tool, found in the research inbox.
 * Nothing appears in the dashboards until it's confirmed here.
 */
export function DetectedSignups({ candidates, brands, industries, hasMailbox }: { candidates: Candidate[]; brands: Brand[]; industries: Industry[]; hasMailbox: boolean }) {
  // Hide senders that are already tracked (e.g. added by hand after detection).
  const open = candidates.filter(
    (c) => c.status === "pending" && !matchBrand(brands, { fromEmail: null, fromDomain: c.domain, replyTo: null, links: [], listUnsubscribe: null }),
  );
  const likely = open.filter((c) => c.ai_is_target !== false);
  const others = open.filter((c) => c.ai_is_target === false);
  const dismissed = candidates.filter((c) => c.status === "dismissed");

  return (
    <Card
      title={`Detected signups${likely.length ? ` (${likely.length})` : ""}`}
      subtitle="Sign up to any operator with the research Gmail, outside the tool. New senders that look like mystery box, rips or cards operators show up here. Only the ones you confirm are tracked and shown on the dashboards."
      actions={
        hasMailbox ? (
          <ApiButton endpoint="/api/discover" describe="discover">
            Scan inbox now
          </ApiButton>
        ) : undefined
      }
      className="mb-6"
    >
      {likely.length === 0 ? (
        <p className="text-sm text-ink-2">
          No new signups detected. {hasMailbox ? "The inbox is checked on every sync; click Scan inbox now to check right away." : "Connect a mailbox in Settings first."}
        </p>
      ) : (
        <div className="space-y-3">
          {likely.map((c) => (
            <CandidateCard key={c.id} c={c} industries={industries} />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-ink-2">Other senders found — not mystery box / cards ({others.length})</summary>
          <div className="mt-3 space-y-3">
            {others.map((c) => (
              <CandidateCard key={c.id} c={c} industries={industries} />
            ))}
          </div>
        </details>
      )}

      {dismissed.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-ink-2">Dismissed ({dismissed.length})</summary>
          <ul className="mt-2 space-y-1">
            {dismissed.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-ink-2">
                  {c.ai_brand_name ?? c.display_name ?? c.domain} <span className="text-xs text-muted">{c.domain}</span>
                </span>
                <form action={restoreCandidate.bind(null, c.id)}>
                  <button className="text-xs text-accent hover:underline">Restore</button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
