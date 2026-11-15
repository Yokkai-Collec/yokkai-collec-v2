"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { StyledPlayerAvatar } from "@/components/styled-player-avatar";
import { StyledPlayerName } from "@/components/styled-player-name";
import { getFriendshipsPage, type FriendUser } from "@/lib/data/friends";
import type { PageCursor } from "@/lib/data/demand-pages";

export function MessengerFriends({
  onSelect
}: {
  onSelect: (friend: FriendUser) => void;
}) {
  const t = useTranslations("messenger");
  const [friends, setFriends] = useState<FriendUser[]>([]),
    [cursor, setCursor] = useState<PageCursor>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [query, setQuery] = useState("");
  const mounted = useRef(false),
    pending = useRef(false),
    search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    search.current?.focus();
    getFriendshipsPage()
      .then(
        page => {
          if (active) {
            setFriends(
              page.items.filter(i => i.bucket === "friends").map(i => i.friend)
            );
            setCursor(page.nextCursor);
          }
        },
        () => {
          if (active) setError(true);
        }
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, []);
  async function loadMore() {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    setError(false);
    try {
      const page = await getFriendshipsPage(cursor);
      if (mounted.current) {
        setFriends(old => [
          ...new Map(
            [
              ...old,
              ...page.items
                .filter(i => i.bucket === "friends")
                .map(i => i.friend)
            ].map(friend => [friend.id, friend])
          ).values()
        ]);
        setCursor(page.nextCursor);
      }
    } catch {
      if (mounted.current) setError(true);
    } finally {
      pending.current = false;
      if (mounted.current) setLoading(false);
    }
  }
  const normalize = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase();
  const visible = friends.filter(friend =>
    normalize(friend.pseudo).includes(normalize(query.trim()))
  );
  return (
    <div className="yk-messenger-inbox yk-messenger-picker">
      <p className="yk-messenger-subtitle">{t("chooseFriendHint")}</p>
      <label className="yk-messenger-search">
        <span className="sr-only">{t("searchFriends")}</span>
        <input
          ref={search}
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={t("searchFriends")}
        />
      </label>
      {loading && (
        <p className="yk-messenger-state" role="status">
          {t("loading")}
        </p>
      )}
      {error && (
        <div className="yk-messenger-state" role="alert">
          <p>{t("friendsError")}</p>
          <button
            type="button"
            className="yk-button"
            disabled={loading}
            onClick={() => void loadMore()}
          >
            {t("retry")}
          </button>
        </div>
      )}
      {!loading && !error && !visible.length && (
        <div className="yk-messenger-state">
          <strong>
            {query.trim() ? t("noMatchingFriends") : t("noFriends")}
          </strong>
          {!query.trim() && <p>{t("noFriendsHint")}</p>}
        </div>
      )}
      <ul className="yk-messenger-list">
        {visible.map(friend => (
          <li key={friend.id}>
            <button
              type="button"
              className="yk-messenger-conversation"
              aria-label={t("openConversation", { name: friend.pseudo })}
              onClick={() => onSelect(friend)}
            >
              <StyledPlayerAvatar
                name={friend.pseudo}
                image={friend.avatarUrl ?? undefined}
                cosmetics={friend.profileStyle}
                online={friend.isOnline}
                size={38}
              />
              <span className="yk-messenger-contact">
                <strong>
                  <StyledPlayerName
                    name={friend.pseudo}
                    playerId={friend.id}
                    cosmetics={friend.profileStyle}
                  />
                </strong>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {cursor && (
        <div className="yk-messenger-state">
          <p>{t("moreFriendsHint")}</p>
          <button
            type="button"
            disabled={loading}
            className="yk-button"
            onClick={() => void loadMore()}
          >
            {t("moreFriends")}
          </button>
        </div>
      )}
    </div>
  );
}
