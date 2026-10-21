import "server-only";
import type { NextRequest } from "next/server";
import { env } from "./env";
import { timingSafeEqual } from "./session";

/** Accepts `Authorization: Bearer <CRON_SECRET>` (Vercel Cron's convention) or `?secret=`. */
export function isCronAuthorized(request: NextRequest): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;
  const header = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const query = request.nextUrl.searchParams.get("secret") ?? "";
  return timingSafeEqual(header, secret) || timingSafeEqual(query, secret);
}
