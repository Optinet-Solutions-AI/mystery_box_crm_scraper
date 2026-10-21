"use client";

import { useState } from "react";
import { inputClass } from "./ui";

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Date-time picker in the viewer's local time that submits an ISO timestamp
 * (with timezone) under `name`. Defaults to "now" when no value is given.
 */
export function LocalDateTimeInput({ name, defaultIso, allowEmpty }: { name: string; defaultIso?: string | null; allowEmpty?: boolean }) {
  const [value, setValue] = useState(() =>
    defaultIso ? toLocalInput(new Date(defaultIso)) : allowEmpty ? "" : toLocalInput(new Date()),
  );
  return (
    <>
      <input type="datetime-local" className={inputClass} value={value} onChange={(e) => setValue(e.target.value)} />
      <input type="hidden" name={name} value={value ? new Date(value).toISOString() : ""} />
    </>
  );
}
