"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import "@/styles/binder-discovery.css";

export function ExploreNavigation({ view }: { view: "search" | "wishlist" }) {
  const t = useTranslations("topbar");
  return (
    <nav
      className="yk-collection-tabs yk-explore-tabs"
      aria-label={t("explore")}
    >
      <Link
        href="/catalog"
        aria-current={view === "search" ? "page" : undefined}
      >
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <rect x="4" y="5" width="12" height="16" rx="2" />
          <path d="m9 3 10 1 1 14" />
        </svg>
        {t("catalog")}
      </Link>
      <Link
        href="/wishlist"
        aria-current={view === "wishlist" ? "page" : undefined}
      >
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        >
          <path d="M12 20 4.5 12a5 5 0 0 1 7.5-6.6A5 5 0 0 1 19.5 12Z" />
        </svg>
        {t("wishlist")}
      </Link>
    </nav>
  );
}
