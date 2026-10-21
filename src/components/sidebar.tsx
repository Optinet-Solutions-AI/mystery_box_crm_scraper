"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  BarChart3,
  Bell,
  Bot,
  Building2,
  CalendarDays,
  Columns3,
  Inbox,
  Megaphone,
  Route,
  Settings,
  Tag,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Dashboard", icon: BarChart3 },
  { href: "/compare", label: "Compare", icon: Columns3 },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/lifecycle", label: "Lifecycle", icon: Route },
  { href: "/analyst", label: "AI Analyst", icon: Bot },
  { href: "/feed", label: "Feed & alerts", icon: Bell },
  { section: "Data" },
  { href: "/emails", label: "Emails", icon: Inbox },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/offers", label: "Offers", icon: Tag },
  { href: "/brands", label: "Brands", icon: Building2 },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="px-4 py-5">
        <div className="text-sm font-semibold text-ink">CRM Intel</div>
        <div className="text-xs text-muted">Competitor email intelligence</div>
      </div>
      <nav className="flex-1 space-y-0.5 px-2">
        {NAV.map((item, i) =>
          "section" in item ? (
            <div key={i} className="px-2 pt-4 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">
              {item.section}
            </div>
          ) : (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm",
                (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href))
                  ? "bg-surface-2 font-medium text-ink"
                  : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}
            >
              <item.icon size={16} strokeWidth={1.75} />
              {item.label}
            </Link>
          ),
        )}
      </nav>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-3 py-2 md:hidden">
      {NAV.filter((n) => !("section" in n)).map((item) =>
        "href" in item ? (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "rounded-md px-2 py-1 text-xs whitespace-nowrap",
              (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)) ? "bg-surface-2 text-ink" : "text-ink-2",
            )}
          >
            {item.label}
          </Link>
        ) : null,
      )}
    </nav>
  );
}
