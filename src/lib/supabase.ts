import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { connection } from "next/server";
import { env } from "./env";

let client: SupabaseClient | null = null;

/** Server-only Supabase client using the service role key (bypasses RLS). */
export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    });
  }
  return client;
}

/**
 * Use in Server Components: marks the render as request-time (fresh data on
 * every load) and returns the client.
 */
export async function db(): Promise<SupabaseClient> {
  await connection();
  return supabaseAdmin();
}

/** Throws on a Supabase error, returns data otherwise. */
export function must<T>(res: { data: T | null; error: { message: string } | null }, what = "query"): NonNullable<T> {
  if (res.error) throw new Error(`${what} failed: ${res.error.message}`);
  return res.data as NonNullable<T>;
}
