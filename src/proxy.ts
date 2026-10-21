import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionToken, timingSafeEqual } from "./lib/session";

// Endpoints that authenticate themselves (secrets / signed tokens) instead of the login cookie.
const PUBLIC = ["/login", "/api/cron", "/api/gmail/push", "/api/ingest"];

/** Password gate for the whole app. Disabled when APP_PASSWORD is not set (local dev). */
export async function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  const cookie = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  if (cookie && timingSafeEqual(cookie, await sessionToken(password))) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
