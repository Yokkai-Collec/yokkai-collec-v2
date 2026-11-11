"use client";
import { StyledPlayerAvatar } from "@/components/styled-player-avatar";
import { StyledPlayerName } from "@/components/styled-player-name";
import Link from "next/link";

import { MessengerFriends } from "@/components/messenger-friends";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { PrivateMessages } from "@/components/private-messages";
import { useSocialUnread } from "@/hooks/use-social-unread";
import {
  getPrivateConversations,
  type ConversationSummary,
  type ConversationPage
} from "@/lib/data/conversations";
import type { FriendUser } from "@/lib/data/friends";
import type { SocialUnread } from "@/lib/data/social-unread";
import type { MessageCursor } from "@/lib/data/private-messages";

function ChatIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M21 11a9 9 0 0 1-9 9H4l-3 2V11a10 10 0 0 1 20 0Z" />
      <path d="M7 9h9M7 13h6" />
    </svg>
  );
}
export function MessengerSession({
  unread,
  loadConversations = getPrivateConversations
}: {
  unread: SocialUnread;
  loadConversations?: typeof getPrivateConversations;
}) {
  const pathname = usePathname();
  const dock = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = dock.current;
    let footer = document.querySelector<HTMLElement>(".yk-site-footer");
    if (!element) return;
    let frame = 0;
    let previous = -1;
    const update = () => {
      frame = 0;
      const clearance = Math.max(
        0,
        Math.ceil(
          window.innerHeight -
            (footer?.getBoundingClientRect().top ?? window.innerHeight)
        )
      );
      if (clearance !== previous) {
        element.style.setProperty(
          "--yk-messenger-footer-clearance",
          String(clearance) + "px"
        );
        previous = clearance;
      }
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(schedule);
    if (footer) resize.observe(footer);
    resize.observe(document.body);
    // Streaming navigation can mount a new footer after this session's effect.
    const mutations = new MutationObserver(() => {
      if (footer?.isConnected) return;
      if (footer) resize.unobserve(footer);
      footer = document.querySelector<HTMLElement>(".yk-site-footer");
      if (footer) resize.observe(footer);
      schedule();
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    update();
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      resize.disconnect();
      mutations.disconnect();
      element.style.removeProperty("--yk-messenger-footer-clearance");
    };
  }, [pathname]);
  const t = useTranslations("messenger");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [friend, setFriend] = useState<FriendUser>();
  const [data, setData] = useState<ConversationPage>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [more, setMore] = useState(false);
  const mounted = useRef(true);
  const paging = useRef(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const active = open && !friend && !choosing;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    let current = true;
    loadConversations()
      .then(
        result => {
          if (current && result.viewerId === unread.viewerId) {
            setData(result);
            setError(false);
          }
        },
        () => {
          if (current) setError(true);
        }
      )
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [active, unread, retry, loadConversations]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);
  useEffect(() => {
    const clearBlocked = () => {
      setData(undefined);
      setFriend(undefined);
      setChoosing(false);
      setRetry(value => value + 1);
    };
    window.addEventListener("player-block-changed", clearBlocked);
    return () =>
      window.removeEventListener("player-block-changed", clearBlocked);
  }, []);
  async function loadMore(cursor: MessageCursor) {
    if (paging.current) return;
    paging.current = true;
    setMore(true);
    setError(false);
    try {
      const result = await loadConversations(cursor);
      if (mounted.current && result.viewerId === unread.viewerId) {
        setData(previous => ({
          ...result,
          items: [
            ...new Map(
              [...(previous?.items ?? []), ...result.items].map(item => [
                item.friend.id,
                item
              ])
            ).values()
          ]
        }));
      }
    } catch {
      if (mounted.current) setError(true);
    } finally {
      paging.current = false;
      if (mounted.current) setMore(false);
    }
  }
  function close() {
    setOpen(false);
    setFriend(undefined);
    setChoosing(false);
    launcher.current?.focus();
  }
  function preview(item: ConversationSummary) {
    const text =
      item.kind === "moderated"
        ? t("removed")
        : item.kind === "gif"
          ? t("gif")
          : item.preview;
    return item.own ? t("youPreview", { text }) : text;
  }
  const counts = new Map(
    unread.messages.map(item => [item.friendId, item.count])
  );
  return (
    <aside
      ref={dock}
      className="yk-messenger"
      data-open={open ? "true" : "false"}
    >
      {open && (
        <div
          id={panelId}
          ref={panel}
          className="yk-messenger-panel"
          role="dialog"
          aria-modal="false"
          aria-label={t("title")}
          onKeyDown={event => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
        >
          <header className="yk-messenger-heading">
            {(friend || choosing) && (
              <button
                type="button"
                onClick={() => {
                  if (friend) setFriend(undefined);
                  else setChoosing(false);
                  setLoading(true);
                }}
                aria-label={t(friend && choosing ? "backToFriends" : "back")}
              >
                ←
              </button>
            )}
            <h2>
              {friend ? (
                <Link
                  href={`/profile/${encodeURIComponent(friend.pseudo)}`}
                  className="yk-message-profile-link"
                  onNavigate={close}
                >
                  <StyledPlayerName
                    name={friend.pseudo}
                    cosmetics={friend.profileStyle}
                  />
                </Link>
              ) : (
                t(choosing ? "chooseFriend" : "title")
              )}
            </h2>
            <button type="button" onClick={close} aria-label={t("close")}>
              ×
            </button>
          </header>
          {friend ? (
            <PrivateMessages
              key={friend.id}
              friend={friend}
              docked
              onClose={close}
            />
          ) : choosing ? (
            <MessengerFriends onSelect={setFriend} />
          ) : (
            <>
              <div className="yk-messenger-inbox">
                <p className="yk-messenger-subtitle">{t("intro")}</p>
                {loading && !data && (
                  <p role="status" className="yk-messenger-state">
                    {t("loading")}
                  </p>
                )}
                {error && (
                  <div className="yk-messenger-state" role="alert">
                    <p>{t("error")}</p>
                    <button
                      type="button"
                      className="yk-button"
                      onClick={() => {
                        setLoading(true);
                        setRetry(value => value + 1);
                      }}
                    >
                      {t("retry")}
                    </button>
                  </div>
                )}
                {data && !data.items.length && !loading && !error && (
                  <div className="yk-messenger-state">
                    <ChatIcon />
                    <strong>{t("empty")}</strong>
                    <p>{t("emptyHint")}</p>
                  </div>
                )}
                <ul className="yk-messenger-list">
                  {data?.items.map(item => (
                    <li key={item.friend.id}>
                      <button
                        type="button"
                        className="yk-messenger-conversation"
                        onClick={() => setFriend(item.friend)}
                        aria-label={t("openConversation", {
                          name: item.friend.pseudo
                        })}
                      >
                        <StyledPlayerAvatar
                          cosmetics={item.friend.profileStyle}
                          name={item.friend.pseudo}
                          image={item.friend.avatarUrl ?? undefined}
                          size={38}
                        />
                        <span className="yk-messenger-contact">
                          <strong>
                            <StyledPlayerName
                              name={item.friend.pseudo}
                              cosmetics={item.friend.profileStyle}
                            />
                          </strong>
                          <span>{preview(item)}</span>
                        </span>
                        <span className="yk-messenger-meta">
                          <time dateTime={item.lastAt}>
                            {format.dateTime(new Date(item.lastAt), {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone
                            })}
                          </time>
                          {!!counts.get(item.friend.id) && (
                            <span
                              className="yk-messenger-unread"
                              aria-label={t("unread", {
                                count: counts.get(item.friend.id)!
                              })}
                            >
                              +{format.number(counts.get(item.friend.id)!)}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {data?.next && (
                  <button
                    type="button"
                    disabled={more}
                    className="yk-button yk-messenger-more"
                    onClick={() => void loadMore(data.next!)}
                  >
                    {more ? t("loading") : t("more")}
                  </button>
                )}
              </div>
              <button
                type="button"
                className="yk-messenger-friends"
                onClick={() => setChoosing(true)}
              >
                {t("friends")}
              </button>
            </>
          )}
        </div>
      )}
      <button
        ref={launcher}
        type="button"
        className="yk-messenger-launcher"
        aria-label={t("openMessages")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          if (open) close();
          else {
            setOpen(true);
            setLoading(true);
          }
        }}
      >
        <ChatIcon />
        <span>{t("title")}</span>
        {unread.messageCount > 0 && (
          <span
            className="yk-messenger-unread"
            aria-label={t("unread", { count: unread.messageCount })}
            aria-live="polite"
          >
            +{format.number(unread.messageCount)}
          </span>
        )}
      </button>
    </aside>
  );
}
export function FloatingMessenger() {
  const pathname = usePathname();
  const enabled =
    !/^\/(?:login|signup|forgot-password|reset-password|auth|account-deleted)(?:\/|$)/.test(
      pathname
    );
  const unread = useSocialUnread(undefined, enabled);
  if (!enabled || !unread?.viewerId) return null;
  return <MessengerSession key={unread.viewerId} unread={unread} />;
}
