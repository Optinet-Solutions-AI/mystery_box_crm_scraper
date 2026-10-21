import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SESSION_COOKIE, sessionToken, timingSafeEqual } from "@/lib/session";
import { buttonClass, inputClass } from "@/components/ui";

async function login(formData: FormData) {
  "use server";
  const password = process.env.APP_PASSWORD ?? "";
  const given = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");
  if (!password || !timingSafeEqual(given, password)) redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  (await cookies()).set(SESSION_COOKIE, await sessionToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

async function LoginForm({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <form action={login} className="mx-auto mt-24 max-w-sm space-y-4 rounded-xl border border-line bg-surface p-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">CRM Intel</h1>
        <p className="text-sm text-ink-2">Enter the team password to continue.</p>
      </div>
      <input type="hidden" name="next" value={sp.next ?? "/"} />
      <input type="password" name="password" autoFocus required className={inputClass} placeholder="Password" />
      {sp.error && <p className="text-sm text-bad">Wrong password.</p>}
      <button className={`${buttonClass} w-full`}>Sign in</button>
    </form>
  );
}

export default function LoginPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <Suspense>
      <LoginForm {...props} />
    </Suspense>
  );
}
