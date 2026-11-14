"use client";
import { StyledPlayerAvatar } from "@/components/styled-player-avatar";
import { StyledPlayerName } from "@/components/styled-player-name";
import { PlayerTitle } from "@/components/player-title";

import { gameErrorKey } from "@/i18n/game-messages";
import { useFormatter, useTranslations } from "next-intl";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { PrivateMessages } from "@/components/private-messages";
import { useSocialUnread } from "@/hooks/use-social-unread";
import {
  invalidateSocialUnread,
  type SocialUnreadAdapter
} from "@/lib/data/social-unread";
import { UnreadBadge } from "@/components/unread-badge";
import type { PrivateMessagesAdapter } from "@/lib/data/private-messages";
import type { TradesPanelAdapter } from "@/components/trades";
import { Button, Modal, Skeleton, StatusPill, Tabs } from "@/components/ui";
import {
  getFriendships,
  getFriendshipsPage,
  groupFriendships,
  friendshipItems,
  removeFriend,
  respondFriendRequest,
  searchUsers,
  sendFriendRequest,
  type Friendships,
  type FriendUser,
  type FriendshipStatus
} from "@/lib/data/friends";

import {
  liveModeration,
  type BlockedUser,
  type ModerationAdapter
} from "@/lib/data/moderation";

export type FriendActionAdapter = {
  unblock?: (userId: string) => Promise<unknown>;
  send: (userId: string) => Promise<unknown>;
  friendships?: () => Promise<Friendships>;
  respond: (requestId: string, accept: boolean) => Promise<unknown>;
};
const liveFriendActions: FriendActionAdapter = {
  send: sendFriendRequest,
  friendships: getFriendships,
  respond: respondFriendRequest
};

export { FriendMessageButton } from "@/components/friend-message-button";

export function FriendAction({
  userId,
  status,
  requestId,
  onCancel,
  blockedByMe = false,
  onChanged,
  onUnblocked,
  adapter = liveFriendActions
}: {
  userId: string;
  status: FriendshipStatus;
  requestId?: string;
  onCancel?: () => Promise<unknown>;
  blockedByMe?: boolean;
  onChanged?: (status: FriendshipStatus) => void;
  onUnblocked?: () => void;
  adapter?: FriendActionAdapter;
}) {
  const t = useTranslations();
  const [state, setState] = useState(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmRefusal, setConfirmRefusal] = useState(false);
  async function send() {
    setBusy(true);
    setError("");
    try {
      await adapter.send(userId);
      setState("outgoing");
      onChanged?.("outgoing");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't complete this action."
      );
    } finally {
      setBusy(false);
    }
  }
  async function respond(accept: boolean) {
    setBusy(true);
    setError("");
    try {
      const id =
        requestId ??
        (await adapter.friendships?.())?.incoming.find(
          person => person.id === userId
        )?.requestId;
      if (!id) throw new Error("This request is no longer available.");
      await adapter.respond(id, accept);
      setState(accept ? "accepted" : "none");
      setConfirmRefusal(false);
      onChanged?.(accept ? "accepted" : "none");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't complete this action."
      );
    } finally {
      setBusy(false);
    }
  }
  async function unblock() {
    setBusy(true);
    setError("");
    try {
      await (adapter.unblock ?? liveModeration.unblock)(userId);
      setState("none");
      onUnblocked?.();
      onChanged?.("none");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't complete this action."
      );
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!onCancel || busy) return;
    setBusy(true);
    setError("");
    try {
      await onCancel();
      setState("none");
      onChanged?.("none");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't complete this action."
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="yk-friend-action">
      {blockedByMe && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void unblock()}
        >
          {t("profileUi.unblock")}{" "}
        </Button>
      )}
      {!blockedByMe && state === "none" && (
        <Button variant="secondary" disabled={busy} onClick={() => void send()}>
          <span aria-hidden="true">＋</span> {t("profileUi.addFriend")}{" "}
        </Button>
      )}
      {!blockedByMe && state === "incoming" && (
        <div className="yk-friend-action-buttons">
          <Button disabled={busy} onClick={() => void respond(true)}>
            {t("profileUi.accept")}{" "}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setConfirmRefusal(true)}
          >
            {t("profileUi.decline")}{" "}
          </Button>
        </div>
      )}
      {!blockedByMe &&
        (state === "outgoing" || state === "accepted" || state === "self") && (
          <StatusPill tone={state === "accepted" ? "success" : "gold"}>
            {t(`profileUi.friendStatus${state}`)}
          </StatusPill>
        )}
      {error && (
        <p role="alert" className="yk-inline-error">
          {t(gameErrorKey(error, "profileUi.profileUnavailable"))}
        </p>
      )}
      {!blockedByMe && state === "outgoing" && onCancel && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void cancel()}
        >
          {t("profileUi.cancelRequest")}{" "}
        </Button>
      )}
      <Modal
        open={confirmRefusal}
        onClose={() => setConfirmRefusal(false)}
        title={t("profileUi.declineThisRequest")}
        className="max-w-md"
      >
        <p className="text-sm leading-6 text-ink-2">
          {t("profileUi.declineRequestNotice")}{" "}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmRefusal(false)}>
            {t("packs.cancel")}{" "}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => void respond(false)}
          >
            {busy ? t("profileUi.declining") : t("profileUi.decline")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function friendPresenceLabel(
  person: Pick<FriendUser, "isOnline" | "lastSeenAt">,
  now = Date.now()
) {
  if (person.isOnline) return "Online";
  if (!person.lastSeenAt) return "Not seen online yet";
  const elapsed = Math.max(0, now - new Date(person.lastSeenAt).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Seen just now";
  if (minutes < 60)
    return `Last seen ${minutes.toLocaleString("en-US")} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return `Last seen ${hours.toLocaleString("en-US")} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7)
    return `Last seen ${days.toLocaleString("en-US")} ${days === 1 ? "day" : "days"} ago`;
  return `Last seen ${new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short" }).format(new Date(person.lastSeenAt))}`;
}

function localizedPresence(
  person: Pick<FriendUser, "isOnline" | "lastSeenAt">,
  t: ReturnType<typeof useTranslations<"socialFriends">>,
  format: ReturnType<typeof useFormatter>
) {
  if (person.isOnline) return t("online");
  if (!person.lastSeenAt) return t("neverSeen");
  const date = new Date(person.lastSeenAt);
  const minutes = Math.floor(Math.max(0, Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return t("justSeen");
  if (minutes < 60) return t("seenMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("seenHours", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("seenDays", { count: days });
  return t("seenDate", {
    date: format.dateTime(date, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    })
  });
}

function Person({
  person,
  actions,
  onMessage,
  onTrade,
  unreadCount = 0,
  showPresence = false
}: {
  person: FriendUser;
  actions?: ReactNode;
  onMessage?: () => void;
  onTrade?: () => void;
  unreadCount?: number;
  showPresence?: boolean;
}) {
  const tradeText = useTranslations("socialTrades");
  const f = useTranslations("socialFriends");
  const format = useFormatter();
  return (
    <li className="yk-social-person">
      <StyledPlayerAvatar
        cosmetics={person.profileStyle}
        name={person.pseudo}
        image={person.avatarUrl ?? undefined}
        online={showPresence ? person.isOnline : undefined}
      />
      <Link href={`/profile/${encodeURIComponent(person.pseudo)}`}>
        <strong>
          <StyledPlayerName
            name={person.pseudo}
            cosmetics={person.profileStyle}
          />
        </strong>
        <small className="yk-social-player-title">
          <PlayerTitle titleId={person.profileStyle?.titleId} />
        </small>
        <small
          className={
            showPresence && person.isOnline ? "yk-presence-online" : undefined
          }
        >
          {showPresence
            ? localizedPresence(person, f, format)
            : f("viewProfile")}
        </small>
      </Link>
      {actions && (
        <div
          className={`yk-friend-action-buttons${onTrade ? " has-trade" : ""}`}
        >
          {onMessage && (
            <Button
              variant="secondary"
              aria-label={f("messageTo", { name: person.pseudo })}
              onClick={onMessage}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 2V11.5a10 10 0 0 1 20 0Z" />
                <path d="M7 10h9M7 14h6" />
              </svg>
              {f("message")}
              <UnreadBadge
                count={unreadCount}
                accessibleLabel={f("unread", { count: unreadCount })}
                label="unread messages"
              />
            </Button>
          )}
          {onTrade && (
            <Button
              variant="secondary"
              onClick={onTrade}
              aria-label={tradeText("tradeWith", { name: person.pseudo })}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" />
              </svg>
              {tradeText("action")}
            </Button>
          )}
          {actions}
        </div>
      )}
    </li>
  );
}
type FriendsTab = "friends" | "incoming" | "outgoing" | "blocked";
function filterFriends(friends: FriendUser[], query: string) {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase();
  const search = normalize(query.trim());
  return search
    ? friends.filter(friend => normalize(friend.pseudo).includes(search))
    : friends;
}
export type FriendsPanelAdapter = {
  friendships: () => Promise<Friendships>;
  search: (query: string) => Promise<FriendUser[]>;
  respond: (requestId: string, accept: boolean) => Promise<unknown>;
  remove: (friendId: string) => Promise<unknown>;
  action?: FriendActionAdapter;
  moderation?: ModerationAdapter;
  messages?: PrivateMessagesAdapter;
  unread?: SocialUnreadAdapter;
  trades?: TradesPanelAdapter;
};
const liveFriendsPanel: FriendsPanelAdapter = {
  friendships: getFriendships,
  search: searchUsers,
  respond: respondFriendRequest,
  remove: removeFriend
};

export function FriendsPanel({
  adapter = liveFriendsPanel,
  initialConversationId,
  onConversationClose,
  onTrade,
  tradeSection
}: {
  adapter?: FriendsPanelAdapter;
  initialConversationId?: string;
  onConversationClose?: () => void;
  onTrade?: (friendId: string) => void;
  tradeSection?: {
    active: boolean;
    routeKey?: string;
    friendId?: string;
    content: ReactNode;
    compose?: (friendId: string) => ReactNode;
    open: (friendId?: string) => void;
    close: () => void;
  };
} = {}) {
  const tradeText = useTranslations("socialTrades");
  const [localTradeFriend, setLocalTradeFriend] = useState<string>();
  const [dismissedTradeKey, setDismissedTradeKey] = useState<string>();
  const tradeRouteKey =
    tradeSection?.routeKey ?? tradeSection?.friendId ?? "offer";
  const tradeOpen = Boolean(
    localTradeFriend ||
    (tradeSection?.active && dismissedTradeKey !== tradeRouteKey)
  );
  useEffect(() => {
    const reset = () => {
      setLocalTradeFriend(undefined);
      setDismissedTradeKey(undefined);
    };
    window.addEventListener("popstate", reset);
    return () => window.removeEventListener("popstate", reset);
  }, []);
  const f = useTranslations("socialFriends");
  const errorText = useTranslations();
  const pager = useMemo(
    () =>
      import("@/lib/data/demand-pages").then(({ createDemandPager }) =>
        createDemandPager(
          adapter === liveFriendsPanel
            ? getFriendshipsPage
            : async () => ({
                items: friendshipItems(await adapter.friendships()),
                nextCursor: null
              }),
          item => item.friend.requestId ?? item.friend.id
        )
      ),
    [adapter]
  );
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  async function readFriends(more = false) {
    const current = await pager;
    const page = await (more ? current.more() : current.refresh());
    setHasMore(!!page.nextCursor);
    return groupFriendships(page.items);
  }
  async function loadMore() {
    setLoadingMore(true);
    setError("");
    try {
      setData(await readFriends(true));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Couldn't load more friends. Please try again."
      );
    } finally {
      setLoadingMore(false);
    }
  }
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const social = useSocialUnread(
    adapter.unread,
    adapter === liveFriendsPanel || !!adapter.unread
  );
  const moderation = adapter.moderation ?? liveModeration;
  const [data, setData] = useState<Friendships>();
  const [tab, setTab] = useState<FriendsTab>("friends");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FriendUser[]>([]);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [refusal, setRefusal] = useState<FriendUser>();
  const [removal, setRemoval] = useState<FriendUser>();
  const [removing, setRemoving] = useState(false);
  const [conversation, setConversation] = useState<FriendUser>();
  const openedFromNotification = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!initialConversationId) {
      openedFromNotification.current = undefined;
      return;
    }
    if (!data || openedFromNotification.current === initialConversationId)
      return;
    const frame = window.requestAnimationFrame(() => {
      openedFromNotification.current = initialConversationId;
      const friend = data.friends.find(
        person => person.id === initialConversationId
      );
      if (friend) {
        setTab("friends");
        setConversation(friend);
      } else setError("This conversation is no longer available.");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [data, initialConversationId]);
  useEffect(() => {
    let active = true;
    void moderation.list().then(
      value => {
        if (active) setBlocked(value);
      },
      e => {
        if (active)
          setError(e instanceof Error ? e.message : "Couldn't load friends.");
      }
    );
    return () => {
      active = false;
    };
  }, [moderation]);
  async function unblock(id: string) {
    setError("");
    try {
      await moderation.unblock(id);
      setBlocked(current => current.filter(person => person.id !== id));
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't complete this action."
      );
    }
  }
  async function load() {
    try {
      setData(await readFriends());
      invalidateSocialUnread();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load friends.");
    }
  }
  useEffect(() => {
    let active = true;
    let loading = false;
    const refresh = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const page = await (await pager).refresh();
        const value = groupFriendships(page.items);
        if (active) {
          setData(value);
          setHasMore(!!page.nextCursor);
        }
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : "Couldn't load friends.");
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [adapter, pager]);
  useEffect(() => {
    if (query.trim().length < 2) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setResults([]);
      setSearching(true);
      void adapter
        .search(query)
        .then(
          value => {
            if (active) setResults(value);
          },
          e => {
            if (active)
              setError(e instanceof Error ? e.message : "Couldn't search.");
          }
        )
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, adapter]);
  useEffect(() => {
    if (tab !== "friends" || !query.trim() || !hasMore || loadingMore || error)
      return;
    // Read remaining relationship pages only while searching. Reuse the pager
    // so loaded friends stay available and concurrent reads are deduplicated.
    const timer = window.setTimeout(() => void loadMore(), 250);
    return () => window.clearTimeout(timer);
  }, [query, tab, hasMore, loadingMore, error, pager]);
  async function respond(id: string, accept: boolean) {
    setError("");
    try {
      await adapter.respond(id, accept);
      setRefusal(undefined);
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't complete this action."
      );
    }
  }
  async function remove() {
    if (!removal || removing) return;
    setRemoving(true);
    setError("");
    try {
      await adapter.remove(removal.id);
      setRemoval(undefined);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove this friend.");
    } finally {
      setRemoving(false);
    }
  }
  const lists = {
    blocked,
    friends: data?.friends ?? [],
    incoming: data?.incoming ?? [],
    outgoing: data?.outgoing ?? []
  };
  const current: FriendUser[] =
    tab === "friends" ? filterFriends(lists.friends, query) : lists[tab];
  const suggestions = results.filter(
    person =>
      person.status !== "accepted" &&
      person.status !== "self" &&
      !lists.friends.some(friend => friend.id === person.id)
  );
  const tradeFriend = data?.friends.find(
    person => person.id === (localTradeFriend ?? tradeSection?.friendId)
  );
  return (
    <div className="yk-social-stack">
      <section className="yk-social-panel">
        <div className="yk-friends-toolbar">
          <Tabs
            label={f("relationships")}
            value={tab}
            onChange={value => setTab(value as FriendsTab)}
            items={[
              {
                id: "friends",
                label: f("myFriends", {
                  count: lists.friends.length,
                  more: hasMore ? "+" : ""
                })
              },
              {
                id: "incoming",
                badge: lists.incoming.length ? (
                  <span className="ml-2 inline-flex">
                    <UnreadBadge
                      count={lists.incoming.length}
                      accessibleLabel={f("pendingRequests", {
                        count: lists.incoming.length
                      })}
                      label="pending friend requests"
                    />
                  </span>
                ) : undefined,
                label: f("incoming", { count: lists.incoming.length })
              },
              {
                id: "outgoing",
                label: f("outgoing", { count: lists.outgoing.length })
              },
              {
                id: "blocked",
                label: f("blocked", { count: blocked.length })
              }
            ]}
          />
          {tab === "friends" && (
            <div className="yk-friends-list-search">
              <label className="yk-social-search-field">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  width="16"
                  height="16"
                >
                  <circle
                    cx="8.5"
                    cy="8.5"
                    r="5.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="m13 13 4 4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                <input
                  type="search"
                  aria-label={f("searchMyFriends")}
                  placeholder={f("searchMyFriends")}
                  value={query}
                  onChange={event => {
                    setQuery(event.target.value);
                    setResults([]);
                    setSearching(event.target.value.trim().length >= 2);
                  }}
                />
              </label>
              {!!query.trim() && hasMore && (
                <p className="yk-search-hint" role="status">
                  {f("searchRemainingFriends")}
                </p>
              )}
            </div>
          )}
        </div>
        {!data && tab !== "blocked" ? (
          !error && (
            <Skeleton
              label={f("loadingRelationships")}
              className="mt-4 h-48 w-full rounded-panel"
            />
          )
        ) : current.length ? (
          <ul className="yk-social-list">
            {current.map(person => (
              <Person
                key={person.requestId ?? person.id}
                person={person}
                showPresence={tab === "friends"}
                unreadCount={
                  social?.messages.find(item => item.friendId === person.id)
                    ?.count ?? 0
                }
                onMessage={
                  tab === "friends" ? () => setConversation(person) : undefined
                }
                onTrade={
                  tab === "friends" && (onTrade || tradeSection)
                    ? () => {
                        if (onTrade) {
                          onTrade(person.id);
                          return;
                        }
                        setDismissedTradeKey(undefined);
                        setLocalTradeFriend(person.id);
                        tradeSection?.open(person.id);
                      }
                    : undefined
                }
                actions={
                  tab === "blocked" ? (
                    <Button
                      variant="secondary"
                      onClick={() => void unblock(person.id)}
                    >
                      {f("unblock")}
                    </Button>
                  ) : tab === "incoming" ? (
                    <div className="yk-friend-action-buttons">
                      <Button
                        onClick={() => void respond(person.requestId!, true)}
                      >
                        {f("accept")}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setRefusal(person)}
                      >
                        {f("decline")}
                      </Button>
                    </div>
                  ) : tab === "friends" ? (
                    <Button variant="danger" onClick={() => setRemoval(person)}>
                      {f("remove")}
                    </Button>
                  ) : (
                    <StatusPill tone="gold">{f("pending")}</StatusPill>
                  )
                }
              />
            ))}
          </ul>
        ) : tab === "friends" && query.trim().length >= 2 ? null : (
          <div className="yk-social-empty">
            <span className="yk-social-empty-icon" aria-hidden="true">
              ◇
            </span>
            <strong>
              {tab === "friends" && query.trim()
                ? f(hasMore ? "searchRemainingFriends" : "noMatchingFriends")
                : hasMore && tab !== "blocked"
                  ? f("notLoaded")
                  : f(`empty.${tab}.title`)}
            </strong>
            <p>
              {tab === "friends" && query.trim()
                ? f("tryFriendName")
                : hasMore && tab !== "blocked"
                  ? f("loadHint")
                  : f(`empty.${tab}.text`)}
            </p>
          </div>
        )}
        {tab === "friends" && (
          <>
            {query.trim().length > 0 && query.trim().length < 2 && (
              <p className="yk-search-hint">{f("searchHint")}</p>
            )}
            {searching && (
              <p className="yk-search-hint" role="status">
                {f("searching")}
              </p>
            )}
            {query.trim().length >= 2 &&
              !searching &&
              !suggestions.length &&
              !current.length && (
                <div className="yk-social-empty is-compact">
                  <strong>{f("noResults")}</strong>
                  <span>{f("tryUsername")}</span>
                </div>
              )}
            {!!suggestions.length && (
              <ul className="yk-social-list is-search">
                {suggestions.map(person => (
                  <Person
                    key={person.id}
                    person={person}
                    actions={
                      <FriendAction
                        key={`${person.id}:${person.status}:${blocked.some(item => item.id === person.id)}`}
                        userId={person.id}
                        status={person.status ?? "none"}
                        blockedByMe={blocked.some(
                          item => item.id === person.id
                        )}
                        onUnblocked={() =>
                          setBlocked(current =>
                            current.filter(item => item.id !== person.id)
                          )
                        }
                        onChanged={() => void load()}
                        adapter={
                          adapter.action
                            ? { ...adapter.action, unblock: moderation.unblock }
                            : {
                                ...liveFriendActions,
                                unblock: moderation.unblock
                              }
                        }
                      />
                    }
                  />
                ))}
              </ul>
            )}
          </>
        )}
        {tab !== "blocked" && hasMore && (
          <Button
            variant="secondary"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? f("loading") : f("loadMore")}
          </Button>
        )}
        {data && !hasMore && tab !== "blocked" && (
          <p role="status" className="sr-only">
            {f("allLoaded")}
          </p>
        )}
      </section>
      {error && (
        <p role="alert" className="yk-social-alert">
          {errorText(gameErrorKey(error, "socialFriends.unavailable"))}
        </p>
      )}
      {tradeOpen && (
        <Modal
          open={tradeOpen}
          onClose={() => {
            setLocalTradeFriend(undefined);
            setDismissedTradeKey(tradeRouteKey);
            tradeSection?.close();
          }}
          title={
            tradeFriend
              ? tradeText("tradeWith", { name: tradeFriend.pseudo })
              : tradeText("offer")
          }
          className="yk-private-trade-modal"
        >
          {tradeOpen && (
            <div className="yk-friends-trades">
              {localTradeFriend && tradeSection?.compose
                ? tradeSection.compose(localTradeFriend)
                : tradeSection?.content}
            </div>
          )}
        </Modal>
      )}
      {conversation && (
        <PrivateMessages
          key={conversation.id}
          friend={conversation}
          adapter={adapter.messages}
          tradeAdapter={adapter.trades}
          onClose={() => {
            setConversation(undefined);
            onConversationClose?.();
          }}
          moderationAdapter={adapter.moderation}
        />
      )}
      <Modal
        open={!!refusal}
        onClose={() => setRefusal(undefined)}
        title={f("declineTitle")}
        className="max-w-md"
      >
        <p className="text-sm leading-6 text-ink-2">
          {f("declineBody", { name: refusal?.pseudo ?? "" })}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setRefusal(undefined)}>
            {f("cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              refusal?.requestId && void respond(refusal.requestId, false)
            }
          >
            {f("decline")}
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!removal}
        onClose={() => {
          if (!removing) setRemoval(undefined);
        }}
        title={f("removeTitle")}
        className="max-w-md"
      >
        <p className="text-sm leading-6 text-ink-2">
          {f("removeBody", { name: removal?.pseudo ?? "" })}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            disabled={removing}
            onClick={() => setRemoval(undefined)}
          >
            {f("cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={removing}
            onClick={() => void remove()}
          >
            {removing ? f("removing") : f("remove")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
