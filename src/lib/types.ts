export type IndustryField = { key: string; label: string; type: string; description: string };

export type Industry = {
  id: string;
  name: string;
  description: string | null;
  extra_offer_fields: IndustryField[];
  extra_categories: string[];
};

export type Brand = {
  id: string;
  name: string;
  domain: string;
  website_url: string | null;
  signup_url: string | null;
  logo_url: string | null;
  industry_id: string;
  country: string | null;
  sender_domains: string[];
  sender_emails: string[];
  color: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
};

export type Mailbox = {
  id: string;
  email: string;
  provider: "gmail" | "forwarding";
  refresh_token: string | null;
  access_token: string | null;
  token_expires_at: string | null;
  history_id: string | null;
  status: "connected" | "error" | "disconnected" | "reauth_required";
  last_error: string | null;
  last_synced_at: string | null;
  initial_sync_done: boolean;
  watch_expires_at: string | null;
  oauth_client_id: string | null;
  label: string | null;
  active: boolean;
  created_at: string;
};

export type GoogleOAuthClient = {
  id: string;
  name: string;
  client_id: string;
  client_secret: string; // encrypted at rest
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type RecordedEvent = { type: string; at: string; note?: string };

export type TestAccount = {
  id: string;
  brand_id: string;
  mailbox_id: string | null;
  email: string;
  persona: string;
  signup_method: string | null;
  status: "pending" | "registered" | "closed";
  registered_at: string | null;
  recorded_events: RecordedEvent[];
  notes: string | null;
  created_at: string;
};

export type LinkInfo = { url: string; text: string; is_cta: boolean; kind: "cta" | "unsubscribe" | "social" | "legal" | "tracking" | "other" };
export type ImageInfo = { src: string; alt: string; width: number | null; height: number | null; is_tracking: boolean };
export type AttachmentInfo = { filename: string; mime_type: string; size: number };

export type Email = {
  id: string;
  dedupe_key: string;
  source: "gmail" | "forwarding";
  mailbox_id: string | null;
  brand_id: string | null;
  test_account_id: string | null;
  campaign_id: string | null;
  campaign_role: string | null;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  message_id_header: string | null;
  gmail_labels: string[];
  from_name: string | null;
  from_email: string | null;
  from_domain: string | null;
  reply_to: string | null;
  to_email: string | null;
  subject: string | null;
  preview_text: string | null;
  sent_at: string | null;
  received_at: string | null;
  html_body: string | null;
  text_body: string | null;
  links: LinkInfo[];
  images: ImageInfo[];
  attachments: AttachmentInfo[];
  cta_links: { text: string; url: string }[];
  promo_codes: string[];
  unsubscribe_url: string | null;
  list_unsubscribe: string | null;
  headers: Record<string, string>;
  match_method: string | null;
  email_type: string | null;
  is_promotional: boolean | null;
  processing_status: "pending" | "processing" | "analyzed" | "skipped" | "error";
  processing_error: string | null;
  processing_attempts: number;
  created_at: string;
};

export type EmailAnalysis = {
  email_id: string;
  model: string | null;
  email_type: string | null;
  is_promotional: boolean | null;
  categories: string[];
  primary_category: string | null;
  industry_categories: string[];
  manual_categories: string[] | null;
  summary: string | null;
  main_message: string | null;
  promotional_angle: string | null;
  tone: string | null;
  copy_style: string | null;
  urgency_tactics: string[];
  has_urgency: boolean | null;
  subject_line_style: string | null;
  emoji_count: number | null;
  personalization: string[];
  is_personalized: boolean | null;
  emotional_appeals: string[];
  social_proof: string[];
  content_focus: string | null;
  cta_count: number | null;
  cta_placement: string | null;
  creative_format: string | null;
  hero_description: string | null;
  featured_products: string[];
  partnerships: string[];
  seasonal_event: string | null;
  campaign_theme: string | null;
  confidence: number | null;
  raw: unknown;
  created_at: string;
};

export type Offer = {
  id: string;
  email_id: string;
  brand_id: string | null;
  campaign_id: string | null;
  offer_type: string | null;
  headline: string | null;
  incentive_value: number | null;
  incentive_unit: string | null;
  incentive_text: string | null;
  currency: string | null;
  min_requirement: string | null;
  min_requirement_amount: number | null;
  max_reward: string | null;
  max_reward_amount: number | null;
  promo_code: string | null;
  eligibility: string | null;
  geo_restrictions: string | null;
  starts_at: string | null;
  ends_at: string | null;
  starts_text: string | null;
  ends_text: string | null;
  product_category: string | null;
  conditions: string | null;
  cta_text: string | null;
  cta_url: string | null;
  confidence: number | null;
  source_evidence: string | null;
  industry_fields: Record<string, { value: string; evidence: string | null }>;
  created_at: string;
};

export type Campaign = {
  id: string;
  brand_id: string;
  title: string;
  signature: string | null;
  primary_category: string | null;
  categories: string[];
  offer_type: string | null;
  offer_headline: string | null;
  promo_codes: string[];
  landing_urls: string[];
  seasonal_event: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  email_count: number;
  offer_starts_at: string | null;
  offer_ends_at: string | null;
  confidence: number | null;
  is_inferred: boolean;
  confirmed_by_user: boolean;
  created_at: string;
  updated_at: string;
};

export type Insight = {
  id: string;
  kind: string;
  severity: "info" | "notable" | "important";
  title: string;
  body: string | null;
  brand_ids: string[];
  email_ids: string[];
  campaign_ids: string[];
  offer_ids: string[];
  data: Record<string, unknown>;
  dedupe_key: string | null;
  period_start: string | null;
  period_end: string | null;
  read: boolean;
  created_at: string;
};

export type AlertRule = {
  id: string;
  name: string;
  rule_type: string;
  brand_id: string | null;
  params: Record<string, unknown>;
  webhook_url: string | null;
  active: boolean;
  created_at: string;
};

export type SyncRun = {
  id: string;
  mailbox_id: string | null;
  kind: string;
  status: "running" | "success" | "error" | "partial";
  started_at: string;
  finished_at: string | null;
  fetched: number;
  inserted: number;
  duplicates: number;
  ignored: number;
  analyzed: number;
  error: string | null;
};
