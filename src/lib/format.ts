import { TZDate } from "@date-fns/tz";
import { format, formatDistanceToNowStrict } from "date-fns";

/**
 * One timezone for every date in the app, so server-rendered pages and
 * browser-rendered charts agree. Set NEXT_PUBLIC_APP_TIMEZONE (e.g. "Asia/Manila")
 * to change it; the default is UTC.
 */
export const APP_TIMEZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE || "UTC";

/** Short label for the app timezone, e.g. "UTC" or "GMT+8". */
export function tzLabel(d: Date = new Date()): string {
  if (APP_TIMEZONE === "UTC") return "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, timeZoneName: "short" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? APP_TIMEZONE;
  } catch {
    return APP_TIMEZONE;
  }
}

const inTz = (d: string | Date) => new TZDate(new Date(d).getTime(), APP_TIMEZONE);

export const fmtDate = (d: string | Date | null | undefined, pattern = "MMM d, yyyy") => (d ? format(inTz(d), pattern) : "—");
export const fmtDateTime = (d: string | Date | null | undefined) => (d ? `${format(inTz(d), "MMM d, yyyy HH:mm")} ${tzLabel(new Date(d))}` : "—");
export const fmtAgo = (d: string | Date | null | undefined) => (d ? `${formatDistanceToNowStrict(new Date(d))} ago` : "never");
export const fmtPct = (x: number | null | undefined, digits = 0) => (x == null || Number.isNaN(x) ? "—" : `${(x * 100).toFixed(digits)}%`);
export const fmtNum = (x: number | null | undefined, digits = 0) =>
  x == null || Number.isNaN(x) ? "—" : x.toLocaleString(undefined, { maximumFractionDigits: digits });
export const notStated = (v: string | number | null | undefined) => (v == null || v === "" ? "Not stated" : String(v));

export function fmtMoney(amount: number | null | undefined, currency: string | null | undefined) {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount} ${currency ?? ""}`.trim();
  }
}
