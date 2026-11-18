import { NextResponse, type NextRequest } from "next/server";
import { researchBrand } from "@/lib/brand-research";

export const maxDuration = 300;

/** (Re)researches one brand's profile: web research + website and email-platform detection. */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/brands/[id]/research">) {
  const { id } = await ctx.params;
  try {
    await researchBrand(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
