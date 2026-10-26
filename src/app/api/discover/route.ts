import { NextResponse } from "next/server";
import { scanInboxForSignups, triageCandidates } from "@/lib/discovery";
import { loadBrandsAndAccounts } from "@/lib/email/ingest";
import { gmailFor } from "@/lib/gmail/client";
import { supabaseAdmin, must } from "@/lib/supabase";
import type { Mailbox } from "@/lib/types";

export const maxDuration = 300;

/** "Scan inbox now": looks for operators signed up to outside the tool, then triages them. */
export async function POST() {
  try {
    const mailboxes = must(
      await supabaseAdmin().from("mailboxes").select("*").eq("provider", "gmail").eq("active", true).not("refresh_token", "is", null),
      "load mailboxes",
    ) as Mailbox[];
    const { brands } = await loadBrandsAndAccounts();
    let scanned = 0;
    let created = 0;
    const deadline = Date.now() + 180_000;
    for (const m of mailboxes) {
      if (m.status === "reauth_required") continue;
      const g = await gmailFor(m);
      const r = await scanInboxForSignups(g, m, brands, { days: 60, maxMessages: 500, deadline });
      scanned += r.scanned;
      created += r.created;
    }
    const triaged = await triageCandidates(25);
    return NextResponse.json({ ok: true, scanned, created, triaged });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
