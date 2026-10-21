"use client";

import { useState } from "react";
import { buttonClass, Field, inputClass } from "@/components/ui";
import { createRule } from "./actions";

const TYPES: { value: string; label: string }[] = [
  { value: "new_campaign", label: "New campaign detected" },
  { value: "new_offer", label: "New offer or new incentive type" },
  { value: "offer_expiring", label: "Offer expiring within 72h" },
  { value: "volume_spike", label: "Email volume change ≥ threshold" },
  { value: "keyword", label: "Keyword in a feed item" },
  { value: "any", label: "Any feed item" },
];

export function RuleForm({ brands }: { brands: { id: string; name: string }[] }) {
  const [type, setType] = useState("new_campaign");
  return (
    <form action={createRule} className="grid gap-3 md:grid-cols-2">
      <Field label="Name">
        <input name="name" required className={inputClass} placeholder="e.g. Crown Rips new campaigns" />
      </Field>
      <Field label="Trigger">
        <select name="rule_type" className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      {type === "volume_spike" && (
        <Field label="Threshold (% change, up or down)">
          <input name="threshold_pct" type="number" min={1} defaultValue={50} className={inputClass} />
        </Field>
      )}
      {type === "keyword" && (
        <Field label="Keyword">
          <input name="keyword" required className={inputClass} placeholder="e.g. cashback" />
        </Field>
      )}
      <Field label="Brand">
        <select name="brand_id" className={inputClass} defaultValue="">
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Webhook URL (optional)" hint="A Slack incoming webhook works as-is: it posts the alert text to a channel. Any HTTPS endpoint receives JSON.">
        <input name="webhook_url" type="url" className={inputClass} placeholder="https://hooks.slack.com/services/…" />
      </Field>
      <div className="md:col-span-2">
        <button type="submit" className={buttonClass}>
          Add alert rule
        </button>
      </div>
    </form>
  );
}
