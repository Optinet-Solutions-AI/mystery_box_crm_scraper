import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

export const env = {
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabaseServiceKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  /** Public URL of the app (used in alert links). On Vercel, a localhost APP_URL is ignored. */
  get appUrl() {
    const configured = process.env.APP_URL;
    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    if (vercel && (!configured || configured.includes("localhost"))) return `https://${vercel}`;
    return (configured ?? "http://localhost:3000").replace(/\/$/, "");
  },
  /** Optional fallback OAuth client from env vars (clients are normally added in Settings). */
  get envGoogleClient() {
    const id = process.env.GOOGLE_CLIENT_ID;
    const secret = process.env.GOOGLE_CLIENT_SECRET;
    return id && secret ? { clientId: id, clientSecret: secret } : null;
  },
  /** Optional: projects/<project>/topics/<topic> for Gmail push notifications. */
  get gmailPubsubTopic() {
    return process.env.GMAIL_PUBSUB_TOPIC || null;
  },
  get pushVerificationToken() {
    return process.env.GMAIL_PUSH_TOKEN || null;
  },
  get cronSecret() {
    return process.env.CRON_SECRET || null;
  },
  get ingestSecret() {
    return process.env.INGEST_SECRET || null;
  },
  /** OpenAI model used for email analysis, AI summaries and the analyst. */
  get aiModel() {
    return process.env.OPENAI_MODEL || "gpt-6.1-sol";
  },
  get hasAI() {
    return Boolean(process.env.OPENAI_API_KEY);
  },
};
