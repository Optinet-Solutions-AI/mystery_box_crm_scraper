import { NextResponse, type NextRequest } from "next/server";
import { backfillBrand, syncAllMailboxes, syncMailbox } from "@/lib/gmail/sync";
import { processPending } from "@/lib/pipeline";

export const maxDuration = 300;

/**
 * Manual re-sync from the UI (behind the login cookie).
 * Body: { mailboxId?, brandId?, days?, analyze?: boolean }
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { mailboxId?: string; brandId?: string; days?: number; analyze?: boolean };
  try {
    let sync: unknown;
    if (body.brandId && body.mailboxId) sync = await backfillBrand(body.mailboxId, body.brandId, body.days ?? 365, 180_000);
    else if (body.mailboxId) sync = await syncMailbox(body.mailboxId, "manual", 180_000);
    else sync = await syncAllMailboxes("manual", 180_000);
    const processed = body.analyze === false ? null : await processPending({ limit: 20, budgetMs: 90_000 });
    return NextResponse.json({ ok: true, sync, processed });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
