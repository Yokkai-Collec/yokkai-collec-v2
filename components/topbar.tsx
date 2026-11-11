"use client";
import { useTranslations, useFormatter } from "next-intl";
import {
  notificationItem,
  type NotificationItem
} from "@/lib/notification-item";
export {
  notificationItem,
  type NotificationItem
} from "@/lib/notification-item";

import { useSyncExternalStore } from "react";
import { i18nEnabled } from "@/i18n/locale";
const subscribeToHydration = () => () => {};

import Link from "next/link";
import { LocaleSelector } from "@/components/locale-controls";
import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import type { CollectedCard } from "@/lib/data/cards";
import { Avatar, Karas } from "@/components/ui";
import "@/styles/topbar.css";
import {
  markNotificationRead,
  type AppNotification
} from "@/lib/data/notifications";
import { useSfx } from "@/hooks/use-sfx";
import { useNotificationFeed } from "@/hooks/use-notification-feed";
import { useSocialUnread } from "@/hooks/use-social-unread";
import type { SocialUnreadAdapter } from "@/lib/data/social-unread";
import { UnreadBadge } from "@/components/unread-badge";
import { useBoostersLoadPriority } from "@/components/boosters-load-priority";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { ProPromotion } from "@/components/pro-promotion";
import { getProfile } from "@/lib/data/profile";
import { subscribePlayerSnapshotInvalidation } from "@/lib/data/player-state";

const notificationStyle = {
  wishlist: ["♥", "text-rarity-ssr bg-rarity-ssr/14"],
  outbid: ["↑", "text-danger bg-danger/14"],
  trade: ["⇄", "text-accent-neon bg-accent-neon/14"],
  "trade-counter": ["↺", "text-accent-neon bg-accent-neon/14"],
  "trade-accepted": ["✓", "text-success bg-success/14"],
  "trade-declined": ["×", "text-danger bg-danger/14"],
  "trade-cancelled": ["−", "text-ink-2 bg-veil"],
  pack: ["✦", "text-accent-gold bg-accent-gold/14"],
  won: ["✓", "text-success bg-success/14"],
  sold: ["◆", "text-accent-gold bg-accent-gold/14"],
  mention: ["@", "text-accent-neon bg-accent-neon/14"],
  message: ["✉", "text-accent-neon bg-accent-neon/14"],
  reply: ["↩", "text-accent-neon bg-accent-neon/14"],
  friend: ["+", "text-accent-neon bg-accent-neon/14"],
  mission: ["✦", "text-success bg-success/14"]
};
export function useNotificationItems(notifications?: AppNotification[]) {
  const t = useTranslations("topbar");
  const tAchievements = useTranslations("achievementUi");
  const fmt = useFormatter();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false
  );
  return notifications?.map(item =>
    notificationItem(
      item,
      t,
      i18nEnabled()
        ? hydrated
          ? fmt.dateTime(new Date(item.createdAt), {
              year: "numeric",
              month: "numeric",
              day: "numeric",
              hour: "numeric",
              minute: "numeric",
              second: "numeric",
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
            })
          : "—"
        : undefined,
      i18nEnabled() ? tAchievements : undefined
    )
  );
}

export function Topbar({
  view,
  account,
  name: providedName,
  karas,
  infoError,
  onRetryInfo,
  notifications,
  socialUnread,
  notificationError: externalNotificationError,
  onRetryNotifications,
  onRefreshNotifications,
  onReadAll,
  onOpenNotification
}: {
  view:
    | "home"
    | "packs"
    | "collection"
    | "leaderboard"
    | "profile"
    | "friends"
    | "feed"
    | "market"
    | "auction"
    | "trades"
    | "search"
    | "wishlist"
    | "admin"
    | "achievements"
    | "settings";
  account?: ReactNode;
  name?: string;
  collection?: CollectedCard[];
  karas?: number;
  infoError?: string;
  onRetryInfo?: () => void;
  notifications?: NotificationItem[];
  socialUnread?: SocialUnreadAdapter;
  notificationError?: string;
  onRetryNotifications?: () => void;
  onRefreshNotifications?: () => void;
  onReadAll?: () => void;
  onOpenNotification?: (id: string, href: string) => Promise<void>;
}) {
  const t = useTranslations("topbar");
  const sound = useSfx();
  const secondaryReady = useBoostersLoadPriority() >= 2;
  const isAdmin = useIsAdmin(secondaryReady);
  const [panel, setPanel] = useState<"notifications" | "account" | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string>();
  const [profileName, setProfileName] = useState<string>();
  const feed = useNotificationFeed(!notifications && secondaryReady);
  const social = useSocialUnread(
    socialUnread,
    secondaryReady && (!!socialUnread || !notifications)
  );
  const loaded = useNotificationItems(feed.notifications);
  const shown = notifications ?? loaded;
  const visibleNotificationError = externalNotificationError ?? feed.error;
  const unread = shown?.filter(n => !n.read).length;
  const name = providedName || profileName;
  useEffect(() => {
    let active = true;
    if (!secondaryReady) return;
    const refreshProfile = () =>
      void getProfile().then(
        profile => {
          if (active) {
            setAvatarUrl(profile.avatarUrl ?? undefined);
            setProfileName(profile.pseudo);
          }
        },
        () => undefined
      );
    refreshProfile();
    const unsubscribe = subscribePlayerSnapshotInvalidation(scopes => {
      if (scopes.includes("profile")) refreshProfile();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [secondaryReady]);
  useEffect(() => {
    if (!panel) return;
    const panelId = `${panel}-panel`;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(`#${panelId},[aria-controls="${panelId}"]`)) return;
      setPanel(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [panel]);
  async function readAll() {
    if (onReadAll) await onReadAll();
    else {
      await markNotificationRead();
      feed.setNotifications(current =>
        current?.map(n => ({
          ...n,
          readAt: n.readAt ?? new Date().toISOString()
        }))
      );
    }
  }
  function toggleNotifications() {
    if (panel === "notifications") {
      setPanel(null);
      return;
    }
    setPanel("notifications");
    if (notifications) onRefreshNotifications?.();
    else void feed.refresh();
  }
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:bg-accent-gold focus:p-3 focus:text-void"
      >
        {t("skipToContent")}
      </a>
      <header
        className="yk-topbar"
        data-mobile-menu={mobileMenu ? "open" : "closed"}
      >
        <Link href="/" className="yk-brand" aria-label={t("yokkaiCollecHome")}>
          <Image
            className="yk-brand-image"
            src="/assets/brand-logo-ice-retro.png"
            alt=""
            width={1672}
            height={941}
            sizes="112px"
            priority
          />
        </Link>
        <nav
          id="primary-navigation"
          aria-label={t("mainNavigation")}
          className="yk-primary-nav"
        >
          <Link href="/" aria-current={view === "home" ? "page" : undefined}>
            {t("home")}
          </Link>
          <Link
            href="/boosters"
            aria-current={view === "packs" ? "page" : undefined}
          >
            {t("packs")}
          </Link>
          <Link
            href="/collection"
            aria-current={view === "collection" ? "page" : undefined}
          >
            {t("collection")}
          </Link>
          <Link
            href="/market"
            aria-current={
              view === "market" || view === "auction" ? "page" : undefined
            }
          >
            {t("market")}
          </Link>
          <Link
            href="/social"
            aria-current={
              view === "feed" || view === "friends" || view === "leaderboard"
                ? "page"
                : undefined
            }
            onClick={() => setMobileMenu(false)}
          >
            <span className="yk-friends-nav-label">
              {t("social")}
              <UnreadBadge
                variant="nav"
                count={
                  (social?.messageCount ?? 0) + (social?.requestCount ?? 0)
                }
                label={t("unreadMessagesAndPendingFriendRequests")}
                singularLabel={t("unreadMessageOrPendingFriendRequest")}
              />
            </span>
          </Link>
          <Link
            href="/wishlist"
            aria-current={view === "wishlist" ? "page" : undefined}
          >
            {t("wishlist")}
          </Link>
          <Link
            href="/catalog"
            aria-current={view === "search" ? "page" : undefined}
          >
            {t("catalog")}
          </Link>
          {isAdmin && (
            <Link
              href="/admin/cards"
              aria-current={view === "admin" ? "page" : undefined}
            >
              Admin
            </Link>
          )}
        </nav>
        <div className="yk-topbar-actions">
          <button
            type="button"
            className="yk-icon-button yk-menu-toggle"
            aria-label={mobileMenu ? t("closeMenu") : t("openMenu")}
            aria-expanded={mobileMenu}
            aria-controls="primary-navigation"
            onClick={() => setMobileMenu(open => !open)}
          >
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path
                d={
                  mobileMenu
                    ? "M6 6l12 12M18 6 6 18"
                    : "M4 7h16M4 12h16M4 17h16"
                }
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={sound.toggle}
            aria-pressed={sound.enabled}
            aria-label={sound.enabled ? t("disableSound") : t("enableSound")}
            title={sound.enabled ? t("soundOn") : t("soundOff")}
            className="yk-icon-button"
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
              <path d="M4 9h4l5-4v14l-5-4H4z" />
              {sound.enabled ? (
                <path d="M17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14" />
              ) : (
                <path d="m17 9 5 6m0-6-5 6" />
              )}
            </svg>
          </button>
          <div className="relative">
            <button
              type="button"
              className="yk-icon-button"
              aria-label={t("notificationCount", { count: unread ?? 0 })}
              aria-expanded={panel === "notifications"}
              aria-controls="notifications-panel"
              onClick={toggleNotifications}
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
              </svg>
              {!!unread && (
                <span className="absolute -top-1 -right-1 min-w-4 rounded-full bg-danger px-1 text-[10px] text-void">
                  {unread}
                </span>
              )}
            </button>
            {panel === "notifications" && (
              <>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t("closeNotifications")}
                  className="yk-notification-backdrop"
                  onClick={() => setPanel(null)}
                />
                <section
                  id="notifications-panel"
                  aria-label={t("notifications")}
                  className="yk-notifications"
                  onKeyDown={e => {
                    if (e.key === "Escape") setPanel(null);
                  }}
                >
                  <div className="yk-notification-head">
                    <div>
                      <h2>{t("notifications")}</h2>
                      {shown && (
                        <p>
                          {(unread ?? 0).toLocaleString("en-US")} {t("unread")}
                        </p>
                      )}
                    </div>
                    {!!unread && (
                      <button onClick={() => void readAll()}>
                        {t("markAllAsRead")}
                      </button>
                    )}
                  </div>
                  {visibleNotificationError ? (
                    <div
                      role="alert"
                      className="yk-notification-state is-error"
                    >
                      <span aria-hidden="true">!</span>
                      <strong>{t("couldnTLoadYourNotifications")}</strong>
                      <p>{visibleNotificationError}</p>
                      <button
                        type="button"
                        className="yk-button yk-button-secondary"
                        onClick={() => {
                          if (onRetryNotifications) onRetryNotifications();
                          else feed.retry();
                        }}
                      >
                        {t("tryAgain")}
                      </button>
                    </div>
                  ) : !shown ? (
                    <div className="yk-notification-state">
                      <span className="yk-skeleton block h-10 w-10" />
                      <p>{t("loadingNotifications")}</p>
                    </div>
                  ) : shown.length === 0 ? (
                    <div className="yk-notification-state">
                      <span aria-hidden="true">♢</span>
                      <strong>{t("noNotificationsYet")}</strong>
                      <p>{t("youReAllCaughtUpYourAlertsAndActivityWill")}</p>
                    </div>
                  ) : (
                    <ul className="yk-notification-list">
                      {shown.map(n => {
                        const [glyph, color] = notificationStyle[n.kind];
                        const content = (
                          <>
                            <span
                              className={`flex size-9 shrink-0 items-center justify-center rounded-input ${color}`}
                            >
                              {glyph}
                            </span>
                            <span className="min-w-0 flex-1 text-xs leading-5">
                              <strong className="font-semibold text-ink">
                                {n.title}
                              </strong>
                              <span className="block text-ink-2">{n.text}</span>
                              <span className="text-ink-3">{n.time}</span>
                            </span>
                            {!n.read && (
                              <span
                                aria-label={t("unreadLabel")}
                                className="mt-2 size-1.5 shrink-0 rounded-full bg-accent-gold"
                              />
                            )}
                          </>
                        );
                        return (
                          <li
                            key={n.id}
                            className={n.read ? "is-read" : "is-unread"}
                            data-notification-kind={n.kind}
                          >
                            {n.href ? (
                              <Link
                                href={n.href}
                                onClick={e => {
                                  e.preventDefault();
                                  void (onOpenNotification
                                    ? onOpenNotification(n.id, n.href!)
                                    : markNotificationRead(n.id).then(() =>
                                        window.location.assign(n.href!)
                                      ));
                                }}
                              >
                                {content}
                              </Link>
                            ) : (
                              <div>{content}</div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>
          <span
            className="yk-balance"
            title={karas == null ? t("loadingBalance") : t("myBalance")}
          >
            {infoError ? (
              <button
                type="button"
                className="text-xs text-danger-ink"
                title={infoError}
                onClick={onRetryInfo}
              >
                {t("balanceAndUsernameUnavailableTryAgain")}
              </button>
            ) : karas == null ? (
              <span
                role="status"
                aria-label={t("loadingKarasBalance")}
                className="yk-balance-skeleton"
              />
            ) : (
              <Karas amount={karas} className="yk-karas-gold" />
            )}
          </span>
          <div className="relative">
            <button
              type="button"
              aria-label={t("openMyAccount")}
              title={t("myAccount")}
              aria-expanded={panel === "account"}
              aria-controls="account-panel"
              className="yk-account-trigger"
              onClick={() =>
                setPanel(current => (current === "account" ? null : "account"))
              }
            >
              <Avatar name={name || "Account"} image={avatarUrl} />
              <svg
                aria-hidden="true"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m7 10 5 5 5-5" />
              </svg>
            </button>
            {panel === "account" && (
              <>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t("closeAccountMenu")}
                  className="yk-notification-backdrop yk-account-backdrop"
                  onClick={() => setPanel(null)}
                />
                <section
                  id="account-panel"
                  aria-label={t("profileMenu")}
                  className="yk-account-panel"
                  onKeyDown={event => {
                    if (event.key === "Escape") setPanel(null);
                  }}
                >
                  <p className="yk-account-overline">{t("playerProfile")}</p>
                  <div className="yk-account-summary">
                    <Avatar
                      name={name || "Account"}
                      image={avatarUrl}
                      size={40}
                    />
                    <div>
                      <strong>{name || "Account"}</strong>
                      <span>
                        @{name || "account"} {t("collector")}
                      </span>
                      {karas != null && (
                        <small className="yk-account-karas">
                          {karas.toLocaleString("en-US")} Karas
                        </small>
                      )}
                    </div>
                    <LocaleSelector />
                  </div>
                  <nav
                    aria-label={t("profileActions")}
                    className="yk-account-actions"
                  >
                    <Link
                      href="/profile"
                      className="yk-account-action"
                      onClick={() => setPanel(null)}
                    >
                      <svg
                        aria-hidden="true"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <circle cx="12" cy="8" r="4" />
                        <path d="M4 21a8 8 0 0 1 16 0" />
                      </svg>
                      {t("viewMyProfile")}
                    </Link>
                    <Link
                      href="/settings"
                      className="yk-account-action"
                      onClick={() => setPanel(null)}
                    >
                      <svg
                        aria-hidden="true"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <circle cx="12" cy="12" r="3" />
                        <path
                          d={
                            "M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7" +
                            " 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3V9.6h.1A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-" +
                            ".06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1." +
                            "7 1.7 0 0 0 19.4 9c.14.38.35.72.6 1 .3.3.68.44 1.1.44h.1v4h-.1A1.7 1.7 0 0 0 19.4 15Z"
                          }
                        />
                      </svg>
                      {t("settings")}
                    </Link>
                    <Link
                      href="/achievements"
                      className="yk-account-action"
                      onClick={() => setPanel(null)}
                    >
                      <svg
                        aria-hidden="true"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <path d="M8 3h8v6a4 4 0 0 1-8 0V3ZM10 17h4M12 13v4M8 21h8M8 6H4v2a4 4 0 0 0 4 4M16 6h4v2a4 4 0 0 1-4 4" />
                      </svg>
                      {t("myAchievements")}
                    </Link>
                  </nav>
                  <div className="yk-account-separator" />
                  {account || (
                    <p className="yk-account-unavailable">
                      {t("sessionUnavailable")}
                    </p>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      </header>
      <ProPromotion
        enabled={secondaryReady && view === "home"}
        dismissible={false}
        page="home"
      />
    </>
  );
}
