"use client";

import { seriesColor, useIsDark } from "./theme";

/** Brand identity mark for calendar events: logo if set, else the brand's color dot (dark-mode step aware). */
export function CalendarBrandMark({ color, logo, size = 10 }: { color: string; logo?: string | null; size?: number }) {
  const dark = useIsDark();
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logo} alt="" className="shrink-0 rounded-sm object-contain" style={{ width: size + 4, height: size + 4 }} />;
  }
  return <span className="shrink-0 rounded-full" style={{ width: size, height: size, background: seriesColor(color, dark) }} aria-hidden />;
}
