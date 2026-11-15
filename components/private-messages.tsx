"use client";
import { gameErrorKey } from "@/i18n/game-messages";
import Link from "next/link";

import { StyledPlayerAvatar } from "@/components/styled-player-avatar";
import { StyledPlayerName } from "@/components/styled-player-name";

/* eslint-disable @next/next/no-img-element -- GIPHY media must remain animated. */

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode
} from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button, Modal } from "@/components/ui";
import { GifPicker, type GifChoice } from "@/components/gif-picker";
import { EmojiReactionPicker } from "@/components/emoji-reaction-picker";
import { reactionEmoji } from "@/lib/ui/reaction-emojis";
import { insertMessageEmoji } from "@/lib/ui/message-emoji";
import { TradesPanel, type TradesPanelAdapter } from "@/components/trades";
import { ConversationTrade } from "@/components/conversation-trade";
import { useConversationTrades } from "@/hooks/use-conversation-trades";
import { conversationTimeline } from "@/lib/ui/conversation-trades";
import { PlayerModeration } from "@/components/player-moderation";
import type { ModerationAdapter } from "@/lib/data/moderation";
import type { FriendUser } from "@/lib/data/friends";
import {
  livePrivateMessages,
  PrivateMessagesError,
  isPrivateMessageGif,
  type PrivateMessage,
  type PrivateMessagePage,
  type PrivateMessagesAdapter
} from "@/lib/data/private-messages";
import { startVisiblePolling } from "@/lib/ui/visible-polling";
import {
  PrivateMessageMedia,
  MessageImageDraft,
  MessageImagePicker,
  useMessageImage
} from "@/components/private-message-media";

function mergeMessages(first: PrivateMessage[], second: PrivateMessage[]) {
  return [
    ...new Map(
      [...first, ...second].map(message => [message.id, message])
    ).values()
  ].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  );
}
function DockedMessageFrame({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
  open?: boolean;
  title: string;
  onClose: () => void;
}) {
  return (
    <div className={`yk-messenger-thread ${className ?? ""}`}>{children}</div>
  );
}

export function PrivateMessages({
  friend,
  onClose,
  tradeAdapter,
  moderationAdapter,
  docked = false,
  adapter = livePrivateMessages
}: {
  friend: FriendUser;
  onClose: () => void;
  adapter?: PrivateMessagesAdapter;
  tradeAdapter?: TradesPanelAdapter;
  moderationAdapter?: ModerationAdapter;
  docked?: boolean;
}) {
  const MessageFrame = docked ? DockedMessageFrame : Modal;
  const t = useTranslations("privateMessages");
  const errorText = useTranslations();
  const format = useFormatter();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [page, setPage] = useState<PrivateMessagePage>();
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [gif, setGif] = useState<GifChoice | null>(null);
  const [trading, setTrading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [retry, setRetry] = useState(0);
  const [visibleTrades, setVisibleTrades] = useState(20);
  const trades = useConversationTrades(
    page?.viewerId,
    friend.id,
    !!page && !unavailable,
    tradeAdapter
  );
  const timeline = conversationTimeline(
    page?.items ?? [],
    trades.offers,
    visibleTrades
  );
  const scroll = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const pending = useRef<{
    text: string;
    gifUrl: string | null;
    image?: File;
    id: string;
  } | null>(null);
  const sendingRef = useRef(false);
  const mounted = useRef(true);
  const scrollRestore = useRef<{ height: number; top: number } | null>(null);
  const { image, attachImage, clearImage, onPaste } = useMessageImage(
    setSendError,
    () => sendingRef.current || loading || unavailable || !page,
    () => setGif(null)
  );
  function keepLatestVisible() {
    if (stickToBottom.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let reading = false;
    const refresh = async () => {
      if (!active || reading) return;
      reading = true;
      try {
        const fresh = await adapter.list(friend.id);
        if (!active) return;
        setPage(current => {
          // A long hidden-tab gap starts a fresh bounded window. Older messages
          // remain reachable through the server cursor instead of leaving a gap.
          if (
            !current ||
            current.viewerId !== fresh.viewerId ||
            (fresh.next &&
              current.items.length &&
              !fresh.items.some(message =>
                current.items.some(old => old.id === message.id)
              ))
          )
            return fresh;
          return {
            ...current,
            viewerId: fresh.viewerId,
            readThroughId: fresh.readThroughId ?? current.readThroughId,
            items: mergeMessages(current.items, fresh.items)
          };
        });
        setError("");
        setUnavailable(false);
      } catch (reason) {
        if (!active) return;
        setError(
          gameErrorKey(
            reason,
            gameErrorKey("Couldn't load messages. Please try again.")
          )
        );
        if (reason instanceof PrivateMessagesError && reason.unavailable) {
          setPage(undefined);
          setUnavailable(true);
        }
      } finally {
        reading = false;
        if (active) setLoading(false);
      }
    };
    const stop = startVisiblePolling(() => void refresh(), 5_000);
    const onFocus = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    window.addEventListener("private-message-received", onFocus);
    const blocked = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; blocked: boolean }>)
        .detail;
      if (detail?.id === friend.id && detail.blocked) {
        active = false;
        setPage(undefined);
        setUnavailable(true);
        setError("This conversation is no longer available.");
        setTrading(false);
      }
    };
    window.addEventListener("player-block-changed", blocked);
    return () => {
      active = false;
      stop();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
      window.removeEventListener("private-message-received", onFocus);
      window.removeEventListener("player-block-changed", blocked);
    };
  }, [adapter, friend.id, retry]);

  useEffect(() => {
    // Run after rendering a successfully fetched page, not when opening the
    // bell, loading older history, failing a fetch or switching to a hidden tab.
    if (!adapter.markRead || !page?.readThroughId || unavailable || trading)
      return;
    let active = true;
    let busy = false;
    let confirmed = false;
    const acknowledge = async () => {
      if (!active || document.hidden || busy || confirmed) return;
      busy = true;
      try {
        await adapter.markRead!(friend.id, page.readThroughId!);
        if (active) confirmed = true;
      } catch {
        /* Retry without clearing the last confirmed unread badge. */
      } finally {
        busy = false;
      }
    };
    const stop = startVisiblePolling(() => void acknowledge(), 5_000);
    return () => {
      active = false;
      stop();
    };
  }, [
    adapter,
    friend.id,
    page?.viewerId,
    page?.readThroughId,
    unavailable,
    trading
  ]);

  useEffect(() => {
    const viewport = scroll.current;
    if (!viewport) return;
    if (scrollRestore.current) {
      viewport.scrollTop =
        scrollRestore.current.top +
        viewport.scrollHeight -
        scrollRestore.current.height;
      scrollRestore.current = null;
    } else if (stickToBottom.current)
      viewport.scrollTop = viewport.scrollHeight;
  }, [page, trades.offers, visibleTrades]);

  async function older() {
    if (!page?.next || loadingOlder || unavailable) return;
    setLoadingOlder(true);
    try {
      const olderPage = await adapter.list(friend.id, page.next);
      if (!mounted.current) return;
      const viewport = scroll.current;
      if (viewport)
        scrollRestore.current = {
          height: viewport.scrollHeight,
          top: viewport.scrollTop
        };
      setPage(
        current =>
          current && {
            ...current,
            readThroughId: current.readThroughId ?? olderPage.readThroughId,
            items: mergeMessages(olderPage.items, current.items),
            next: olderPage.next
          }
      );
      setError("");
    } catch (reason) {
      if (!mounted.current) return;
      setError(
        gameErrorKey(reason, gameErrorKey("Couldn't load older messages."))
      );
      if (reason instanceof PrivateMessagesError && reason.unavailable) {
        setPage(undefined);
        setUnavailable(true);
      }
    } finally {
      if (mounted.current) setLoadingOlder(false);
    }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (
      (!text && !gif && !image) ||
      Array.from(text).length > 2000 ||
      !page ||
      unavailable ||
      sendingRef.current
    )
      return;
    sendingRef.current = true;
    setSending(true);
    setSendError("");
    const gifUrl = gif?.url ?? null;
    if (
      !pending.current ||
      pending.current.text !== text ||
      pending.current.gifUrl !== gifUrl ||
      pending.current.image !== image?.file
    )
      pending.current = {
        text,
        gifUrl,
        image: image?.file,
        id: crypto.randomUUID()
      };
    try {
      const message = await adapter.send(
        friend.id,
        text,
        pending.current.id,
        gifUrl,
        image?.file
      );
      if (!mounted.current) return;
      stickToBottom.current = true;
      setPage(
        current =>
          current && {
            ...current,
            items: mergeMessages(current.items, [message])
          }
      );
      setDraft("");
      setGif(null);
      clearImage();
      pending.current = null;
    } catch (reason) {
      if (!mounted.current) return;
      setSendError(
        gameErrorKey(
          reason,
          gameErrorKey("Couldn't send the message. Your draft has been kept.")
        )
      );
      if (reason instanceof PrivateMessagesError && reason.unavailable) {
        setPage(undefined);
        setUnavailable(true);
      }
    } finally {
      sendingRef.current = false;
      if (mounted.current) {
        setSending(false);
        requestAnimationFrame(() => {
          if (mounted.current) composer.current?.focus();
        });
      }
    }
  }
  function insertEmoji(id: string) {
    const emoji = reactionEmoji(id)?.emoji;
    const input = composer.current;
    if (!emoji || !input || sending || loading || unavailable || !page) return;
    const next = insertMessageEmoji(
      draft,
      emoji,
      input.selectionStart,
      input.selectionEnd
    );
    if (!next) return;
    setDraft(next.text);
    requestAnimationFrame(() => {
      if (!mounted.current) return;
      composer.current?.focus({ preventScroll: true });
      composer.current?.setSelectionRange(next.caret, next.caret);
    });
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <>
      <MessageFrame
        open
        onClose={onClose}
        title={t("title", { name: friend.pseudo })}
        className="yk-private-messages-modal"
      >
        <div className="yk-private-messages-contact">
          <Link
            href={`/profile/${encodeURIComponent(friend.pseudo)}`}
            className="yk-message-profile-link"
            aria-label={errorText("socialFriends.viewProfile")}
            onNavigate={onClose}
          >
            <StyledPlayerAvatar
              cosmetics={friend.profileStyle}
              name={friend.pseudo}
              size={docked ? 32 : 40}
              image={friend.avatarUrl ?? undefined}
              online={friend.isOnline}
            />
          </Link>
          <div>
            <strong>
              <Link
                href={`/profile/${encodeURIComponent(friend.pseudo)}`}
                className="yk-message-profile-link"
                title={errorText("socialFriends.viewProfile")}
                onNavigate={onClose}
              >
                <StyledPlayerName
                  name={friend.pseudo}
                  cosmetics={friend.profileStyle}
                />
              </Link>
            </strong>
            <p>{t("privacy")}</p>
          </div>
          <Button
            variant="secondary"
            disabled={loading || unavailable || !page}
            onClick={() => setTrading(true)}
          >
            {t("trade")}
          </Button>
          <PlayerModeration
            userId={friend.id}
            pseudo={friend.pseudo}
            adapter={moderationAdapter}
            onBlocked={onClose}
          />
        </div>
        <div
          className="yk-private-messages-log"
          ref={scroll}
          role="log"
          aria-label={t("conversation")}
          aria-live="polite"
          aria-relevant="additions text"
          aria-busy={loading}
          onScroll={() => {
            const viewport = scroll.current;
            if (viewport)
              stickToBottom.current =
                viewport.scrollHeight -
                  viewport.scrollTop -
                  viewport.clientHeight <
                60;
          }}
        >
          {page?.next && (
            <div className="yk-private-messages-older">
              <Button
                variant="secondary"
                disabled={loadingOlder}
                onClick={() => void older()}
              >
                {loadingOlder ? t("loading") : t("older")}
              </Button>
            </div>
          )}
          {trades.offers.length > visibleTrades && (
            <div className="yk-private-messages-older">
              <Button
                variant="secondary"
                onClick={() => {
                  const viewport = scroll.current;
                  if (viewport)
                    scrollRestore.current = {
                      height: viewport.scrollHeight,
                      top: viewport.scrollTop
                    };
                  setVisibleTrades(value => value + 20);
                }}
              >
                {t("olderTrades")}
              </Button>
            </div>
          )}
          {loading ? (
            <p className="yk-private-messages-empty" role="status">
              {t("loadingMessages")}
            </p>
          ) : page && !timeline.length ? (
            <div className="yk-private-messages-empty">
              <strong>{t("start")}</strong>
              <p>{t("sayHello", { name: friend.pseudo })}</p>
            </div>
          ) : null}
          {trades.loading && (
            <p className="yk-conversation-trades-status" role="status">
              {t("loadingTrades")}
            </p>
          )}
          {timeline.map(entry => {
            if (!page) return null;
            if (entry.kind === "trade")
              return (
                <ConversationTrade
                  key={entry.id}
                  offer={entry.offer}
                  viewerId={page.viewerId}
                  busy={!!trades.busyId || unavailable}
                  onRespond={(id, action) => {
                    void trades.respond(id, action);
                  }}
                />
              );
            const message = entry.message;
            const own = message.senderId === page.viewerId;
            return (
              <div
                className={`yk-private-message-row${own ? " is-own" : ""}`}
                key={entry.id}
              >
                {!own && (
                  <StyledPlayerAvatar
                    name={friend.pseudo}
                    image={friend.avatarUrl ?? undefined}
                    cosmetics={friend.profileStyle}
                    size={28}
                  />
                )}
                <div className={`yk-private-message${own ? " is-own" : ""}`}>
                  {message.moderated && (
                    <p className="yk-private-message-removed">
                      {t("removedByModeration")}
                    </p>
                  )}
                  {message.text && <p>{message.text}</p>}
                  <PrivateMessageMedia
                    message={message}
                    onLoad={keepLatestVisible}
                  />
                  <time
                    dateTime={message.createdAt}
                    title={format.dateTime(new Date(message.createdAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone
                    })}
                  >
                    <span className="sr-only">
                      {own ? t("you") : friend.pseudo},{" "}
                    </span>
                    {format.dateTime(new Date(message.createdAt), {
                      month: "short",
                      day: "numeric",
                      timeZone
                    })}{" "}
                    ·{" "}
                    {format.dateTime(new Date(message.createdAt), {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone
                    })}
                  </time>
                  {!own && !message.moderated && (
                    <PlayerModeration
                      userId={friend.id}
                      pseudo={friend.pseudo}
                      adapter={moderationAdapter}
                      contextType="private_message"
                      contextId={message.id}
                      onBlocked={onClose}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {trades.error && !unavailable && (
          <div className="yk-private-messages-error">
            <p role="alert">
              {errorText(
                gameErrorKey(trades.error, "privateMessages.errors.trades")
              )}
            </p>
            <button
              type="button"
              disabled={!!trades.busyId}
              onClick={() => void trades.retry()}
            >
              {t("retryTrades")}
            </button>
          </div>
        )}
        {(sendError || error) && (
          <div className="yk-private-messages-error">
            <p role="alert">
              {errorText(
                gameErrorKey(
                  sendError || error,
                  "privateMessages.errors.unavailable"
                )
              )}
            </p>
            {!unavailable && !sendError && (
              <button
                type="button"
                onClick={() => setRetry(value => value + 1)}
              >
                {t("retry")}
              </button>
            )}
          </div>
        )}
        <form
          className="yk-private-messages-compose"
          onSubmit={event => void send(event)}
          onPaste={onPaste}
        >
          {image && (
            <MessageImageDraft
              url={image.url}
              disabled={sending}
              onRemove={clearImage}
            />
          )}
          {gif && (
            <div className="yk-private-messages-gif-draft">
              <img
                src={gif.url}
                alt={t("selectedGif", { title: gif.title })}
                referrerPolicy="no-referrer"
              />
              <button
                type="button"
                disabled={sending}
                aria-label={t("removeGifLabel")}
                onClick={() => setGif(null)}
              >
                {t("removeGif")}
              </button>
            </div>
          )}
          <label className="sr-only" htmlFor="private-message-draft">
            {t("messageTo", { name: friend.pseudo })}
          </label>
          <textarea
            ref={composer}
            id="private-message-draft"
            placeholder={t("placeholder", { name: friend.pseudo })}
            value={draft}
            maxLength={2000}
            rows={3}
            disabled={sending || loading || unavailable || !page}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            aria-describedby="private-message-length"
          />
          <div className="yk-private-messages-toolbar">
            <div className="yk-private-messages-tools">
              <MessageImagePicker
                disabled={sending || loading || unavailable || !page}
                onSelect={attachImage}
              />
              <GifPicker
                disabled={sending || loading || unavailable || !page}
                onSelect={choice => {
                  if (!isPrivateMessageGif(choice.url)) {
                    setSendError("Choose a GIF from the GIPHY picker.");
                    return;
                  }
                  setGif(choice);
                  clearImage();
                  setSendError("");
                }}
              />
              <EmojiReactionPicker
                mode="message"
                disabled={sending || loading || unavailable || !page}
                selected={[]}
                onSelect={insertEmoji}
              />
            </div>
            <span id="private-message-length">
              {t("length", { count: draft.length, max: 2000 })}
            </span>
            <Button
              type="submit"
              disabled={
                sending ||
                loading ||
                unavailable ||
                !page ||
                (!draft.trim() && !gif && !image)
              }
            >
              {sending ? t("sending") : t("send")}
            </Button>
          </div>
        </form>
      </MessageFrame>
      {trading && (
        <Modal
          open
          title={t("tradeWith", { name: friend.pseudo })}
          onClose={() => setTrading(false)}
          className="yk-private-trade-modal"
        >
          {tradeAdapter && (
            <p className="yk-private-trade-preview-note">{t("localTrade")}</p>
          )}
          <TradesPanel
            adapter={tradeAdapter}
            fixedFriendId={friend.id}
            onOfferSent={() => {
              setTrading(false);
              stickToBottom.current = true;
              void trades.refresh();
            }}
          />
        </Modal>
      )}
    </>
  );
}
