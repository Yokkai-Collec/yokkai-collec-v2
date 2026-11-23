"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { BLACKOUT_EVENT_PATH } from "@/lib/data/blackout-preview";

// English catalog source labels include "Card publishing"; rendering goes
// through adminNavigation so the French catalog can follow the locale flag.
const items = [
  { href: "/admin/cards", label: "cards" },
  { href: "/admin/players", label: "players" },
  { href: "/admin/reports", label: "reports" },
  { href: "/admin/security", label: "security" },
  { href: "/admin/monitoring", label: "monitoring" },
  { href: "/admin/economy", label: "economy" },
  { href: "/admin/gift-codes", label: "giftCodes" },
  { href: "/admin/black-market", label: "blackMarket" }
];

export function AdminNavigation({
  showBlackoutPreview = false
}: {
  showBlackoutPreview?: boolean;
}) {
  const pathname = usePathname();
  const t = useTranslations("adminNavigation");
  return (
    <nav aria-label={t("label")} className="yk-tabs overflow-x-auto">
      {(showBlackoutPreview
        ? [...items, { href: BLACKOUT_EVENT_PATH, label: "blackout" }]
        : items
      ).map(item => (
        <Link
          aria-current={pathname.startsWith(item.href) ? "page" : undefined}
          className={`yk-tab ${pathname.startsWith(item.href) ? "border-cyan-400 bg-cyan-400/10 text-cyan-200 shadow-[0_0_16px_rgba(34,211,238,0.16)]" : ""}`}
          href={item.href}
          key={item.href}
        >
          {t(item.label)}
        </Link>
      ))}
    </nav>
  );
}
