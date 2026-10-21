import { NextResponse, type NextRequest } from "next/server";
import { parseFilters } from "@/lib/data";
import { generateAiSummary, generatePeriodicInsights } from "@/lib/insights";

export const maxDuration = 300;

/** Runs deterministic feed items + the AI summary. Used by the dashboard button and by cron. */
export async function POST(req: NextRequest) {
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const filters = parseFilters(sp);
  try {
    const periodic = await generatePeriodicInsights();
    const ai = await generateAiSummary(filters);
    return NextResponse.json({ ok: true, periodic, findings: ai.findings.length });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
