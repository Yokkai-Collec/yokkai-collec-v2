"use client";
import { useTranslations } from "next-intl";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getPackStatus,
  getDecisionPackStatus,
  type PackStatus
} from "@/lib/data/cards";
import { browseHomeAuctions, type AuctionData } from "@/lib/data/market";
import { subscribePlayerSnapshotInvalidation } from "@/lib/data/player-state";
import { packCountdown, auctionCountdown } from "@/lib/ui/pack-countdown";
import {
  decisionPackSummary,
  type BigPull,
  type HomeCard,
  type HomePackStatus
} from "@/lib/data/home";
import { StyledPlayerName } from "@/components/styled-player-name";
import { GRID_CARD_IMAGE_SIZES, YokaiCard } from "@/components/yokai-card";
import { CardShell } from "@/components/card-shell";
import { CatalogueCardModal } from "@/components/catalogue-card-modal";
import { Avatar, Button, Karas } from "@/components/ui";

import {
  enableHorizontalWheel,
  enableAutomaticScroll
} from "@/lib/ui/horizontal-wheel";

function useHorizontalWheel(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (enabled && ref.current) return enableHorizontalWheel(ref.current);
  }, [enabled]);
  return ref;
}

function useClock(interval = 1000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

// Router snapshots can survive a trip to boosters. Refresh on return and on
// the same invalidation event that pack mutations already publish.
export function HomeRefresh() {
  const router = useRouter();
  useEffect(() => {
    let lastRefresh = 0;
    const refresh = () => {
      if (
        document.visibilityState === "hidden" ||
        Date.now() - lastRefresh < 1000
      )
        return;
      lastRefresh = Date.now();
      router.refresh();
    };
    refresh();
    const unsubscribe = subscribePlayerSnapshotInvalidation(refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  return null;
}

export function HomePackTimer({
  initial,
  preview = false,
  kind = "regular"
}: {
  initial: HomePackStatus;
  kind?: "regular" | "decision";
  preview?: boolean;
}) {
  const t = useTranslations("homeLive");
  const [loadedStatus, setStatus] = useState<
    (PackStatus & { canResume?: boolean }) | null
  >(null);
  const status = loadedStatus ?? initial;
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const now = useClock();
  useEffect(() => {
    let active = true;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const value =
          kind === "decision"
            ? decisionPackSummary(await getDecisionPackStatus(false))
            : await getPackStatus();
        if (!active) return;
        setStatus(value);
        setError(false);
        if (deadline) clearTimeout(deadline);
        if (value.nextPackAt !== null)
          deadline = setTimeout(
            () => void load(),
            Math.max(1000, value.nextPackAt - Date.now() + 100)
          );
      } catch {
        if (active) setError(true);
      }
    };

    if (!preview) void load();
    const refresh = () => {
      if (!preview && document.visibilityState !== "hidden") void load();
    };
    const unsubscribe = preview
      ? () => {}
      : subscribePlayerSnapshotInvalidation(refresh);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      if (deadline) clearTimeout(deadline);
      unsubscribe();
      window.removeEventListener("focus", refresh);
    };
  }, [initial, preview, retry, kind]);
  const full = status.nextPackAt === null && status.available >= status.maximum;
  return (
    <div className={`yk-home-pack-content yk-home-pack-${kind}`}>
      <Image
        src={
          kind === "decision"
            ? "/assets/chrome-decision-booster-v1.png"
            : "/assets/chrome-regular-booster-v1.png"
        }
        alt=""
        width={68}
        height={116}
        className="yk-home-pack-art"
      />
      <div>
        <h3>{kind === "decision" ? "Decision Pack" : "Regular Pack"}</h3>
        <p className="yk-home-pack-state" aria-live="polite">
          {status.canResume
            ? t("finishYourPack")
            : t("packsReady", {
                available: status.available,
                maximum: status.maximum
              })}
        </p>
        {full ? (
          <p className="yk-home-clock">
            {t("reserve")}
            <span>{t("full")}</span>
          </p>
        ) : (
          status.nextPackAt !== null && (
            <p className="yk-home-clock">
              {kind === "decision" ? t("resetsIn") : t("nextPackIn")}
              <span role="timer" aria-live="off">
                {now === null || (!loadedStatus && !preview)
                  ? "—:—"
                  : packCountdown(status.nextPackAt, now, kind === "decision")}
              </span>
            </p>
          )
        )}
        {error && (
          <p role="status">
            {t("couldnTRefreshYourPacks")}{" "}
            <Button
              variant="secondary"
              onClick={() => setRetry(value => value + 1)}
            >
              {t("tryAgain")}
            </Button>
          </p>
        )}
      </div>
    </div>
  );
}

export function LatestPulls({ cards }: { cards: HomeCard[] }) {
  const t = useTranslations("homeLive");
  const scrollRef = useHorizontalWheel(cards.length > 0);
  const [selected, setSelected] = useState<HomeCard | null>(null);
  return (
    <>
      {cards.length ? (
        <div className="yk-home-card-grid" ref={scrollRef}>
          {[0, 1, 2].map(copy => (
            <div
              className="yk-home-latest-set"
              key={copy}
              data-scroll-period={copy === 1 ? "" : undefined}
              data-scroll-clone={copy !== 1 ? "" : undefined}
              aria-hidden={copy !== 1 ? true : undefined}
            >
              {cards.map((card, index) => (
                <button
                  type="button"
                  className="yk-home-card-button"
                  key={card.instanceId}
                  tabIndex={copy === 1 ? undefined : -1}
                  aria-label={t("viewCard", {
                    cardName: card.name,
                    shiny: card.shiny ? "yes" : "no"
                  })}
                  onClick={() => {
                    if (copy !== 1)
                      scrollRef.current
                        ?.querySelectorAll<HTMLButtonElement>(
                          "[data-scroll-period] button"
                        )
                        [index]?.focus({ preventScroll: true });
                    setSelected(card);
                  }}
                >
                  <YokaiCard
                    {...card}
                    animated={false}
                    imageSizes={GRID_CARD_IMAGE_SIZES}
                  />
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <p className="yk-home-empty">
          {t("noCardsYet")}
          <Link href="/boosters">{t("openYourFirstBooster")}</Link>
        </p>
      )}
      <CatalogueCardModal
        selected={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

export function BigPulls({ pulls }: { pulls: BigPull[] }) {
  const t = useTranslations("homeLive");
  const scrollRef = useHorizontalWheel(pulls.length > 0);
  const [selected, setSelected] = useState<
    (BigPull["card"] & { instanceId: string }) | null
  >(null);
  useEffect(() => {
    if (scrollRef.current && !selected)
      return enableAutomaticScroll(scrollRef.current);
  }, [pulls.length, selected, scrollRef]);
  return (
    <>
      {pulls.length ? (
        <div
          className="yk-home-big-window"
          ref={scrollRef}
          tabIndex={0}
          role="region"
          aria-label={t("recentBigDropsScrollToExplore")}
        >
          <div className="yk-home-big-track">
            {[0, 1, 2].map(copy => (
              <div
                className="yk-home-big-set"
                key={copy}
                data-scroll-period={copy === 1 ? "" : undefined}
                data-scroll-clone={copy !== 1 ? "" : undefined}
                aria-hidden={copy !== 1 ? true : undefined}
              >
                {pulls.map((pull, index) => (
                  <article className="yk-home-big-pull" key={pull.instanceId}>
                    <button
                      type="button"
                      className="yk-home-card-button"
                      aria-label={t("viewCard", {
                        cardName: pull.card.name,
                        shiny: pull.card.shiny ? "yes" : "no"
                      })}
                      tabIndex={copy === 1 ? undefined : -1}
                      onClick={() => {
                        if (copy !== 1)
                          scrollRef.current
                            ?.querySelectorAll<HTMLButtonElement>(
                              "[data-scroll-period] button"
                            )
                            [index]?.focus({ preventScroll: true });
                        setSelected({
                          ...pull.card,
                          instanceId: pull.instanceId
                        });
                      }}
                    >
                      <YokaiCard
                        {...pull.card}
                        instanceId={pull.instanceId}
                        animated={false}
                        imageSizes={GRID_CARD_IMAGE_SIZES}
                      />
                    </button>
                    {pull.playerId && pull.playerName ? (
                      <Link
                        className="yk-home-pull-player"
                        href={`/profile/${pull.playerId}`}
                        tabIndex={copy === 1 ? undefined : -1}
                      >
                        <Avatar
                          name={pull.playerName}
                          image={pull.avatarUrl ?? undefined}
                          size={22}
                        />
                        <span className="yk-home-pull-name">
                          <StyledPlayerName
                            name={pull.playerName}
                            cosmetics={pull.profileStyle ?? undefined}
                          />
                        </span>
                      </Link>
                    ) : (
                      <span className="yk-home-pull-player">
                        <span
                          className="yk-home-private-avatar"
                          aria-hidden="true"
                        >
                          ?
                        </span>
                        <span>{t("privatePlayer")}</span>
                      </span>
                    )}
                  </article>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="yk-home-empty">{t("theNextBigDropCouldBeYours")}</p>
      )}
      <CatalogueCardModal
        selected={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

export function HomeMarket({
  initial,
  preview = false
}: {
  initial: AuctionData[];
  preview?: boolean;
}) {
  const t = useTranslations("homeLive");
  const [loaded, setAuctions] = useState<{
    source: AuctionData[];
    items: AuctionData[];
  } | null>(null);
  const auctions = loaded?.source === initial ? loaded.items : initial;
  const [error, setError] = useState(false);
  const now = useClock();

  useEffect(() => {
    if (preview) return;
    let active = true;
    const nextEnd = Math.min(...auctions.map(item => Date.parse(item.endsAt)));
    if (!Number.isFinite(nextEnd)) return;
    const timer = setTimeout(
      () => {
        void browseHomeAuctions().then(
          page => {
            if (active) {
              setAuctions({ source: initial, items: page.items });
              setError(false);
            }
          },
          () => {
            if (active) setError(true);
          }
        );
      },
      Math.max(1000, nextEnd - Date.now() + 100)
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [auctions, initial, preview]);
  return (
    <>
      {error && (
        <p role="status">
          {t("couldnTRefreshAuctions")}{" "}
          <Link href="/market">{t("browseTheMarket")}</Link>
        </p>
      )}
      {auctions.length ? (
        <div className="yk-home-market-grid">
          {auctions.map(auction => (
            <Link
              href={`/market/${auction.id}`}
              className="yk-home-auction"
              key={auction.id}
            >
              <CardShell>
                <YokaiCard
                  {...auction.card}
                  animated={false}
                  imageSizes={GRID_CARD_IMAGE_SIZES}
                />
              </CardShell>
              <div className="yk-home-auction-meta">
                <Karas amount={auction.amount} />
                <span
                  role="timer"
                  aria-live="off"
                  aria-label={t("timeRemaining")}
                >
                  {now === null
                    ? t("endingSoon")
                    : Date.parse(auction.endsAt) <= now
                      ? t("ended")
                      : auctionCountdown(Date.parse(auction.endsAt), now)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="yk-home-empty">
          {t("noActiveAuctionsYetCheckBackForYourNextGreat")}
        </p>
      )}
    </>
  );
}
