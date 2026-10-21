import { format, formatDistanceToNowStrict } from "date-fns";

export const fmtDate = (d: string | Date | null | undefined, pattern = "MMM d, yyyy") =>
  d ? format(new Date(d), pattern) : "—";
export const fmtDateTime = (d: string | Date | null | undefined) => (d ? format(new Date(d), "MMM d, yyyy HH:mm") : "—");
export const fmtAgo = (d: string | Date | null | undefined) =>
  d ? `${formatDistanceToNowStrict(new Date(d))} ago` : "never";
export const fmtPct = (x: number | null | undefined, digits = 0) =>
  x == null || Number.isNaN(x) ? "—" : `${(x * 100).toFixed(digits)}%`;
export const fmtNum = (x: number | null | undefined, digits = 0) =>
  x == null || Number.isNaN(x) ? "—" : x.toLocaleString(undefined, { maximumFractionDigits: digits });
export const notStated = (v: string | number | null | undefined) =>
  v == null || v === "" ? "Not stated" : String(v);

export function fmtMoney(amount: number | null | undefined, currency: string | null | undefined) {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount} ${currency ?? ""}`.trim();
  }
}
