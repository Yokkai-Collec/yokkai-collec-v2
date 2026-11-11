"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { useSocialFeeds } from "@/components/social-feed-provider";

export function SocialTabs() {
  const t = useTranslations("socialFriends");
  const pathname = usePathname();
  const store = useSocialFeeds().public;
  const { available } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  return (
    <nav aria-label={t("sections")} className="yk-tabs">
      <Link
        href="/social"
        className="yk-tab"
        aria-current={pathname === "/social" ? "page" : undefined}
      >
        {t("feed")}
      </Link>
      {available && (
        <Link
          href="/social/everyone"
          className="yk-tab"
          aria-current={pathname === "/social/everyone" ? "page" : undefined}
        >
          {t("everyone")}
        </Link>
      )}
      <Link
        href="/social/friends"
        className="yk-tab"
        aria-current={pathname === "/social/friends" ? "page" : undefined}
      >
        {t("friends")}
      </Link>
      <Link
        href="/social/leaderboard"
        className="yk-tab"
        aria-current={pathname === "/social/leaderboard" ? "page" : undefined}
      >
        {t("leaderboard")}
      </Link>
    </nav>
  );
}
