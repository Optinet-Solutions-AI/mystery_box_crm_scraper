"use client";

import { useEffect, useState } from "react";
import { BRAND_PALETTE_DARK } from "@/lib/constants";

/** True when the dark theme is active (OS setting or data-theme="dark"). */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => {
      const forced = document.documentElement.dataset.theme;
      setDark(forced ? forced === "dark" : mq.matches);
    };
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);
  return dark;
}

/** Series color for the active theme (dark mode uses the same hue stepped for the dark surface). */
export function seriesColor(lightHex: string, dark: boolean) {
  return dark ? (BRAND_PALETTE_DARK[lightHex.toLowerCase()] ?? lightHex) : lightHex;
}

/** Chart chrome from the reference instance. */
export function chartChrome(dark: boolean) {
  return dark
    ? { grid: "#2c2c2a", axis: "#383835", muted: "#898781", ink: "#f0efec", ink2: "#c3c2b7", surface: "#1a1a19" }
    : { grid: "#e1e0d9", axis: "#c3c2b7", muted: "#898781", ink: "#0b0b0b", ink2: "#52514e", surface: "#fcfcfb" };
}
