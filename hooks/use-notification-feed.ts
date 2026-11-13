"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getNotifications,
  NotificationRequestError,
  subscribeNotifications,
  type AppNotification,
  type NotificationFeed
} from "@/lib/data/notifications";
import { invalidatePlayerSnapshots } from "@/lib/data/cards";
import type { PlayerSnapshotScope } from "@/lib/data/player-state";
import { startVisiblePolling } from "@/lib/ui/visible-polling";

// Realtime, panel opening, reads and tab visibility refresh immediately; this
// interval is only the fallback when the Realtime socket misses an event.
const POLL_INTERVAL_MS = 60_000;

// Polls list_notifications and refreshes on demand or when the tab becomes visible again.
// An event received during a request queues one follow-up to avoid a stale badge.
export function useNotificationFeed(
  enabled = true,
  load: () => Promise<NotificationFeed | AppNotification[]> = getNotifications
) {
  const [notifications, setNotifications] = useState<AppNotification[]>();
  const [progressUnread, setProgressUnread] = useState<number | null>(null);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const eventRefreshPending = useRef(false);
  const seen = useRef(new Set<string>());
  const refresh = useCallback(
    function refreshFeed() {
      if (!enabled || document.hidden || inFlight.current)
        return Promise.resolve();
      inFlight.current = true;
      return load()
        .then(
          result => {
            if (mounted.current) {
              const items = Array.isArray(result) ? result : result.items;
              const scopes = new Set<PlayerSnapshotScope>();
              for (const item of items) {
                if (seen.current.has(item.id)) continue;
                if (
                  [
                    "auction_won",
                    "auction_sold",
                    "trade_offer_accepted"
                  ].includes(item.type)
                ) {
                  scopes.add("collection");
                  scopes.add("balance");
                } else if (item.type === "outbid") scopes.add("balance");
              }
              seen.current = new Set(items.map(item => item.id));
              setNotifications(items);
              setProgressUnread(
                Array.isArray(result) ? null : result.progressUnread
              );
              setError("");
              if (scopes.size) invalidatePlayerSnapshots([...scopes]);
            }
          },
          failure => {
            if (process.env.NODE_ENV !== "production")
              console.error("[notifications] list_notifications failed", {
                message:
                  failure instanceof Error ? failure.message : String(failure),
                code:
                  failure instanceof NotificationRequestError
                    ? failure.code
                    : undefined,
                error: failure
              });
            if (mounted.current) setError("Couldn't load your notifications.");
          }
        )
        .finally(() => {
          inFlight.current = false;
          if (eventRefreshPending.current && mounted.current) {
            eventRefreshPending.current = false;
            void refreshFeed();
          }
        });
    },
    [enabled, load]
  );
  useEffect(() => {
    if (!enabled) return;
    mounted.current = true;
    const stop = startVisiblePolling(() => void refresh(), POLL_INTERVAL_MS);
    const onBlock = () => {
      void refresh();
    };
    const onNotificationChange = () => {
      if (inFlight.current) eventRefreshPending.current = true;
      else void refresh();
    };
    const stopRealtime =
      load === getNotifications
        ? subscribeNotifications(onNotificationChange)
        : () => {};
    const onStorage = (event: StorageEvent) => {
      if (event.key === "yokkai:social-unread-invalidation")
        onNotificationChange();
    };
    window.addEventListener("social-unread-changed", onNotificationChange);
    window.addEventListener("storage", onStorage);
    window.addEventListener("player-block-changed", onBlock);
    return () => {
      mounted.current = false;
      eventRefreshPending.current = false;
      stop();
      stopRealtime();
      window.removeEventListener("player-block-changed", onBlock);
      window.removeEventListener("social-unread-changed", onNotificationChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [enabled, refresh, load]);
  const retry = useCallback(() => {
    setError("");
    void refresh();
  }, [refresh]);
  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    setNotifications(current =>
      current?.map(item => ({ ...item, readAt: item.readAt ?? now }))
    );
    setProgressUnread(0);
    if (inFlight.current) eventRefreshPending.current = true;
    else void refresh();
  }, [refresh]);
  return { notifications, progressUnread, markAllRead, error, refresh, retry };
}
