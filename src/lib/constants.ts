/** Email classification categories (spec section 4A). */
export const CATEGORIES = [
  "welcome_onboarding",
  "first_purchase_incentive",
  "promotional_campaign",
  "discount_bonus",
  "seasonal",
  "product_launch",
  "loyalty_vip",
  "cashback",
  "retention",
  "reactivation",
  "referral",
  "educational",
  "survey_feedback",
  "urgency_limited_time",
  "transactional",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<string, string> = {
  welcome_onboarding: "Welcome / onboarding",
  first_purchase_incentive: "First purchase / deposit incentive",
  promotional_campaign: "Promotional campaign",
  discount_bonus: "Discount / bonus",
  seasonal: "Seasonal",
  product_launch: "Product launch / feature",
  loyalty_vip: "Loyalty / VIP",
  cashback: "Cashback",
  retention: "Retention",
  reactivation: "Reactivation / win-back",
  referral: "Referral / affiliate",
  educational: "Educational / content",
  survey_feedback: "Survey / feedback",
  urgency_limited_time: "Urgency / limited time",
  transactional: "Transactional / service",
  other: "Other",
  box_drop: "Box drop",
  live_rip_event: "Live rip / event",
  giveaway: "Giveaway",
  buyback_promo: "Buyback promo",
  odds_boost: "Odds boost",
  free_bet: "Free bet",
  free_spins: "Free spins",
  abandoned_cart: "Abandoned cart",
  back_in_stock: "Back in stock",
};

/** Lifecycle-stage categories used for "lifecycle coverage" scoring. */
export const LIFECYCLE_CATEGORIES = [
  "welcome_onboarding",
  "first_purchase_incentive",
  "loyalty_vip",
  "cashback",
  "retention",
  "reactivation",
  "referral",
] as const;

export const EMAIL_TYPES = ["promotional", "transactional", "security", "auth_code", "support", "personal", "other"] as const;

export const OFFER_TYPES = [
  "discount",
  "cashback",
  "deposit_bonus",
  "free_box",
  "free_spins",
  "free_gift",
  "free_shipping",
  "credits",
  "giveaway",
  "referral_reward",
  "loyalty_reward",
  "bundle",
  "other",
] as const;

export const INCENTIVE_UNITS = ["percent", "currency", "quantity", "free_spins", "boxes", "credits", "points", "other"] as const;

export const label = (key: string | null | undefined) =>
  key ? (CATEGORY_LABELS[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())) : "—";

/**
 * Categorical palette (validated reference order: blue, orange, aqua, yellow,
 * magenta, green, violet, red). Assigned to brands in fixed order at creation and
 * stored on the brand, so a brand keeps its color no matter what is filtered.
 */
export const BRAND_PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
/** Same hues stepped for the dark surface. */
export const BRAND_PALETTE_DARK: Record<string, string> = {
  "#2a78d6": "#3987e5",
  "#eb6834": "#d95926",
  "#1baf7a": "#199e70",
  "#eda100": "#c98500",
  "#e87ba4": "#d55181",
  "#008300": "#008300",
  "#6250d6": "#9085e9",
  "#e34948": "#e66767",
};

/** 16 categories fold into 8 color groups so color never has to carry more than 8 identities. */
export const CATEGORY_GROUPS: { key: string; label: string; color: string; categories: string[] }[] = [
  { key: "welcome", label: "Welcome / onboarding", color: "#2a78d6", categories: ["welcome_onboarding"] },
  { key: "offer", label: "Offer / incentive", color: "#eb6834", categories: ["first_purchase_incentive", "discount_bonus", "cashback", "free_spins", "free_bet", "odds_boost", "buyback_promo"] },
  { key: "campaign", label: "Campaign / launch", color: "#1baf7a", categories: ["promotional_campaign", "product_launch", "box_drop", "live_rip_event", "giveaway", "back_in_stock"] },
  { key: "seasonal", label: "Seasonal / urgency", color: "#eda100", categories: ["seasonal", "urgency_limited_time"] },
  { key: "loyalty", label: "Loyalty / retention", color: "#e87ba4", categories: ["loyalty_vip", "retention", "reactivation", "abandoned_cart"] },
  { key: "referral", label: "Referral", color: "#008300", categories: ["referral"] },
  { key: "content", label: "Content / survey", color: "#6250d6", categories: ["educational", "survey_feedback"] },
  { key: "transactional", label: "Transactional / other", color: "#898781", categories: ["transactional", "other"] },
];

export function categoryGroup(category: string | null | undefined) {
  return CATEGORY_GROUPS.find((g) => g.categories.includes(category ?? "")) ?? CATEGORY_GROUPS[CATEGORY_GROUPS.length - 1];
}

/** Status colors are reserved for state (never for series) and always shown with an icon + label. */
export const STATUS_COLORS = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" };
