import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { MobileNav, Sidebar } from "@/components/sidebar";
import { Loading } from "@/components/ui";

export const metadata: Metadata = {
  title: "CRM Intel",
  description: "Competitor CRM & email marketing intelligence",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <div className="flex min-h-screen">
          <Suspense fallback={<aside className="hidden w-56 shrink-0 border-r border-line bg-surface md:block" />}>
            <Sidebar />
          </Suspense>
          <div className="min-w-0 flex-1">
            <Suspense fallback={null}>
              <MobileNav />
            </Suspense>
            <main className="mx-auto max-w-[1400px] px-4 py-6 md:px-8">
              <Suspense fallback={<Loading />}>{children}</Suspense>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
