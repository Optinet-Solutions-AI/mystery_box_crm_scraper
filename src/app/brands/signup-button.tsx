"use client";

import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { secondaryButtonClass } from "@/components/ui";

/**
 * Opens the brand's signup page in a popup window. Signup pages (and Google's
 * sign-in especially) refuse to load inside an iframe, so a popup is the closest
 * thing to an in-app frame. The main window jumps to the "confirm registration"
 * form so day 0 of the lifecycle gets recorded once signup is done.
 * (We don't watch for the popup closing: Google's sign-in cuts the link between
 * the windows, which makes that unreliable.)
 */
export function SignupButton({ url, brandId, compact }: { url: string; brandId: string; compact?: boolean }) {
  const router = useRouter();

  function open() {
    const w = 520;
    const h = 780;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(url, `signup-${brandId}`, `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) window.open(url, "_blank");
    router.push(`/brands/${brandId}?signup=1#register`);
  }

  return (
    <button type="button" onClick={open} className={compact ? "text-sm text-accent hover:underline" : secondaryButtonClass}>
      <ExternalLink size={14} className={compact ? "mr-1 inline" : ""} />
      {compact ? "Sign up" : "Open signup window"}
    </button>
  );
}
