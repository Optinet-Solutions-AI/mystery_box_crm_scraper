import { NextResponse, type NextRequest } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { syncAllMailboxes } from "@/lib/gmail/sync";
import { parseFilters } from "@/lib/data";
import { env } from "@/lib/env";
import { generateAiSummary, generatePeriodicInsights } from "@/lib/insights";
import { supabaseAdmin } from "@/lib/supabase";
import { processPending } from "@/lib/pipeline";

export const maxDuration = 300;

/**
 * Scheduled job: incremental Gmail sync → AI analysis → periodic insights.
 * Call every 5–15 minutes for near-real-time ingestion (Vercel Cron, Supabase pg_cron,
 * GitHub Actions, or any uptime pinger) with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result: Record<string, unknown> = {};
  try {
    result.sync = await syncAllMailboxes("incremental", 120_000);
  } catch (err) {
    result.syncError = err instanceof Error ? err.message : String(err);
  }
  try {
    result.processed = await processPending({ limit: 40, budgetMs: 130_000 });
  } catch (err) {
    result.processError = err instanceof Error ? err.message : String(err);
  }
  try {
    result.insights = await generatePeriodicInsights();
  } catch (err) {
    result.insightsError = err instanceof Error ? err.message : String(err);
  }
  // AI summary of the last 30 days, at most once a day.
  try {
    if (env.hasAnthropic) {
      const last = (await supabaseAdmin().from("insights").select("created_at").eq("kind", "ai_finding").order("created_at", { ascending: false }).limit(1)).data?.[0];
      if (!last || Date.now() - new Date(last.created_at).getTime() > 20 * 3_600_000) {
        result.aiSummary = (await generateAiSummary(parseFilters({}))).findings.length;
      }
    }
  } catch (err) {
    result.aiSummaryError = err instanceof Error ? err.message : String(err);
  }
  return NextResponse.json(result);
}
