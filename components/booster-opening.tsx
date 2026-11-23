"use client";
import { useTranslations } from "next-intl";

import { useEffect, useRef, useState } from "react";
import {
  BLACKOUT_BOOSTER_IMAGE,
  SUNSET_BOOSTER_IMAGE,
  type BoosterKind
} from "@/lib/ui/booster-opening-document";
import "@/styles/booster-opening.css";

export function BoosterOpening({
  kind,
  openRequested,
  onReady,
  onComplete,
  onTear,
  onStarted,
  onHover,
  onStopSound,
  onFanReady
}: {
  kind: BoosterKind;
  /** Undefined keeps the legacy automatic playback contract. */
  openRequested?: boolean;
  onReady?: () => void;
  onComplete: () => void;
  onTear: () => void;
  onStarted?: () => void;
  onHover?: () => void;
  onStopSound?: () => void;
  onFanReady?: () => void;
}) {
  const tp = useTranslations("packs");
  const tSunset = useTranslations("gtaSunset");
  const tBlackout = useTranslations("blackout");
  const [html, setHtml] = useState("");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fan, setFan] = useState(false);
  const callbacks = useRef({
    onComplete,
    onTear,
    onReady,
    onStarted,
    onHover,
    onStopSound,
    onFanReady
  });
  const completed = useRef(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const requested = useRef(openRequested ?? true);
  const unavailable = useRef(false);
  const releasePending = useRef<(() => void) | null>(null);
  const fanReady = useRef(false);
  const openingTimeout = useRef<number | undefined>(undefined);
  const waitForClick = openRequested !== undefined;
  useEffect(() => {
    callbacks.current = {
      onComplete,
      onTear,
      onReady,
      onStarted,
      onHover,
      onStopSound,
      onFanReady
    };
  }, [
    onComplete,
    onTear,
    onReady,
    onStarted,
    onHover,
    onStopSound,
    onFanReady
  ]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const complete = () => {
      if (!active || completed.current || fanReady.current) return;
      if (!requested.current) {
        unavailable.current = true;
        setFailed(true);
        setReady(true);
        return;
      }
      callbacks.current.onStopSound?.();
      completed.current = true;
      callbacks.current.onComplete();
    };
    releasePending.current = complete;
    // If the decorative document or its images cannot load, show the actual draw.
    const timeout = window.setTimeout(() => {
      controller.abort();
      complete();
    }, 16000);
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null"
      )
        return;
      switch (event.data?.type) {
        case "YOKKAI_BOOSTER_READY":
          if (waitForClick) window.clearTimeout(timeout);
          setReady(true);
          callbacks.current.onReady?.();
          break;
        case "YOKKAI_BOOSTER_TEAR":
          if (requested.current) callbacks.current.onTear();
          break;
        case "YOKKAI_BOOSTER_STARTED":
          callbacks.current.onStarted?.();
          break;
        case "YOKKAI_BOOSTER_HOVER":
          if (fanReady.current) callbacks.current.onHover?.();
          break;
        case "YOKKAI_BOOSTER_COMPLETE":
          if (!requested.current || completed.current || fanReady.current)
            break;
          window.clearTimeout(timeout);
          window.clearTimeout(openingTimeout.current);
          fanReady.current = true;
          setFan(true);
          callbacks.current.onFanReady?.();
          callbacks.current.onStopSound?.();
          break;
        case "YOKKAI_BOOSTER_REVEAL":
          if (!fanReady.current) break;
          fanReady.current = false;
          callbacks.current.onStopSound?.();
          window.clearTimeout(timeout);
          complete();
          break;
        case "YOKKAI_BOOSTER_ERROR":
          fanReady.current = false;
          window.clearTimeout(timeout);
          complete();
          break;
      }
    };
    window.addEventListener("message", receive);
    void (async () => {
      try {
        const response = await fetch(
          `/api/booster-opening?kind=${kind}${waitForClick ? "&gesture=click" : ""}`,
          {
            cache: "no-store",
            signal: controller.signal
          }
        );
        if (!response.ok) throw new Error("Opening unavailable");
        const document = await response.text();
        if (active) setHtml(document);
      } catch {
        complete();
      }
    })();
    return () => {
      active = false;
      callbacks.current.onStopSound?.();
      releasePending.current = null;
      controller.abort();
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
  }, [kind, waitForClick]);
  useEffect(() => {
    requested.current = openRequested ?? true;
    if (!waitForClick || !requested.current) return;
    if (unavailable.current) {
      releasePending.current?.();
      return;
    }
    // READY also retries a gesture made before the iframe or its media loaded.
    frame.current?.contentWindow?.postMessage(
      { type: "yokkai-booster-open" },
      "*"
    );
    const timeout = window.setTimeout(() => releasePending.current?.(), 16000);
    openingTimeout.current = timeout;
    return () => window.clearTimeout(timeout);
  }, [openRequested, ready, waitForClick]);
  return (
    <div className="yk-booster-opening">
      {html && (
        <iframe
          ref={frame}
          data-ready={ready}
          title={tp("openingPack", {
            pack:
              kind === "sunset"
                ? tSunset("boosterTitle")
                : kind === "blackout"
                  ? tBlackout("boosterTitle")
                  : kind === "decision"
                    ? "Decision Pack"
                    : "Regular Pack"
          })}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          tabIndex={-1}
          aria-hidden="true"
          srcDoc={html}
          onLoad={() =>
            frame.current?.contentWindow?.postMessage(
              { type: "yokkai-booster-status" },
              "*"
            )
          }
        />
      )}
      {failed && (
        // The decorative document failed; keep an intact real pack until clicked.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          draggable={false}
          className="yk-booster-opening-fallback"
          data-pack-theme={kind}
          src={
            kind === "sunset"
              ? SUNSET_BOOSTER_IMAGE
              : kind === "blackout"
                ? BLACKOUT_BOOSTER_IMAGE
                : `/assets/chrome-${kind}-booster-v1.png`
          }
          alt=""
        />
      )}
      {!ready && (
        <p className="yk-booster-opening-loading" role="status">
          {tp("preparingYourPack")}
        </p>
      )}
      {fan && (
        <p className="yk-booster-opening-prompt" role="status">
          {tp("clickTheFanToRevealCards")}
        </p>
      )}
      {!fan && ready && waitForClick && !openRequested && (
        <p className="yk-booster-opening-prompt" role="status">
          {tp("clickThePackOrPressEnterToOpen")}
        </p>
      )}
    </div>
  );
}
