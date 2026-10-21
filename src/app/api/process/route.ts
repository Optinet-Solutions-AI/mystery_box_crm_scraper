import { NextResponse, type NextRequest } from "next/server";
import { processEmail, processPending } from "@/lib/pipeline";

export const maxDuration = 300;

/** Runs AI analysis on queued emails, or re-analyzes one email ({ emailId }). */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { emailId?: string; limit?: number };
  try {
    if (body.emailId) {
      await processEmail(body.emailId, { force: true });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: true, ...(await processPending({ limit: body.limit ?? 30, budgetMs: 240_000 })) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
