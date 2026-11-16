"use client";
import { useFormatter, useTranslations } from "next-intl";

import { useEffect, useRef, useState } from "react";
import {
  AchievementCard,
  AchievementsGallery
} from "@/components/achievements";
import { WishlistView } from "@/components/community-views";
import { MissionGauges } from "@/components/missions";
import { BoostersPreview } from "@/components/boosters-preview";
import type { Missions } from "@/lib/data/missions";
import { notificationItem, Topbar } from "@/components/topbar";
import type { Achievement } from "@/lib/data/achievements";
import type { WishlistCard } from "@/lib/data/wishlist";
import type { AppNotification } from "@/lib/data/notifications";

const now = new Date().toISOString();
const achievements: Achievement[] = [
  {
    id: "packs",
    title: "Ouvreur frénétique",
    description: "Ouvrir 10 boosters réguliers",
    conditionType: "regular_packs_opened",
    conditionValue: 10,
    conditionCategory: null,
    karasReward: 250,
    progressCurrent: 7,
    progressTarget: 10,
    progressLabel: null,
    completedAt: null,
    claimedAt: null
  },
  {
    id: "market",
    title: "Premier pas dans le marché",
    description: "Remporter votre première enchère",
    conditionType: "auctions_won",
    conditionValue: 1,
    conditionCategory: null,
    karasReward: 100,
    progressCurrent: 1,
    progressTarget: 1,
    progressLabel: null,
    completedAt: now,
    claimedAt: null
  },
  {
    id: "legend",
    title: "Légende du Tantō",
    description: "Obtenir votre première carte LR",
    conditionType: "first_lr_card",
    conditionValue: 1,
    conditionCategory: null,
    karasReward: 1000,
    progressCurrent: 1,
    progressTarget: 1,
    progressLabel: null,
    completedAt: now,
    claimedAt: now
  },
  {
    id: "trades",
    title: "Échangeur équitable",
    description: "Conclure 5 échanges entre amis",
    conditionType: "trades_completed",
    conditionValue: 5,
    conditionCategory: null,
    karasReward: 300,
    progressCurrent: 2,
    progressTarget: 5,
    progressLabel: null,
    completedAt: null,
    claimedAt: null
  },
  ...tiers("collector", "collection", [10, 50, 250, 1000], 62),
  ...tiers("pack-opener", "packs", [10, 100, 500], 100),
  ...tiers("completionist", "collection", [25, 50, 100], 31, "Anime"),
  ...tiers("merchant", "market", [5, 25], 0),
  {
    ...tiers("secret", "secret", [1], 0)[0],
    id: "secret-one",
    secret: true
  },
  {
    ...tiers("fan", "pro", [10], 4)[0],
    proRequired: true,
    locked: true
  }
];
function tiers(
  family: string,
  section: string,
  targets: number[],
  current: number,
  conditionCategory: string | null = null
): Achievement[] {
  return targets.map((target, index) => ({
    id: `${family}-${target}`,
    family,
    section,
    title: family,
    description: "",
    conditionType: family,
    conditionValue: target,
    conditionCategory,
    karasReward: 100 * (index + 1),
    progressCurrent: Math.min(current, target),
    progressTarget: target,
    progressLabel: null,
    completedAt: current >= target ? now : null,
    claimedAt: current >= target && index === 0 ? now : null
  }));
}
// Fixed clock: a live one would differ between server render and hydration.
const missions: Missions = {
  serverNow: "2026-11-10T10:00:00Z",
  launchAt: "2026-11-09T19:00:00Z",
  active: true,
  pro: true,
  periods: (["daily", "weekly"] as const).map(period => ({
    period,
    startAt: "2026-11-09T19:00:00Z",
    endsAt:
      period === "daily" ? "2026-11-10T15:00:00Z" : "2026-11-14T14:00:00Z",
    points: period === "daily" ? 50 : 20,
    missions: [
      {
        id: "packs",
        metric: "regular_packs_opened",
        target: 30,
        points: 30,
        category: "packs",
        current: 30
      },
      {
        id: "new",
        metric: "new_cards",
        target: 10,
        points: 20,
        category: "collection",
        current: 8
      },
      {
        id: "trade",
        metric: "trades_proposed",
        target: 1,
        points: 20,
        category: "social",
        current: 0
      }
    ],
    milestones: (period === "daily"
      ? [20, 50, 80, 100]
      : [20, 40, 60, 80, 100]
    ).map(points => ({
      points,
      reward: points * 3,
      claimedAt: points === 20 && period === "daily" ? now : null
    }))
  }))
};
const wishlistCards: WishlistCard[] = ["LR", "SSR", "SR", "R", "C"].map(
  (rarity, index) => ({
    id: `wish-${index}`,
    name: [
      "Kuro Kitsune",
      "Aoi Dragon",
      "Ken Flame",
      "Yuki Frost",
      "Ren Cyber"
    ][index],
    category: "Anime",
    anime: [
      "Spirit Realm",
      "Neo Tokyo",
      "Kendo Academy",
      "Winter Saga",
      "Neo Tokyo"
    ][index],
    rarity: rarity as WishlistCard["rarity"],
    image: "/assets/booster-pack.png",
    createdAt: now
  })
);
const rawNotifications: AppNotification[] = [
  {
    id: "n1",
    type: "wishlist_card_on_auction",
    referenceId: "auction-wishlist",
    readAt: null,
    createdAt: now,
    cardName: "Kuro Kitsune",
    actorPseudo: null,
    achievementName: null
  },
  {
    id: "n2",
    type: "outbid",
    referenceId: "auction-outbid",
    readAt: null,
    createdAt: now,
    cardName: "Aoi Dragon",
    actorPseudo: null,
    achievementName: null
  },
  {
    id: "n3",
    type: "auction_won",
    referenceId: "auction-won",
    readAt: null,
    createdAt: now,
    cardName: "Ren Cyber",
    actorPseudo: null,
    achievementName: null
  },
  {
    id: "n4",
    type: "friend_request",
    referenceId: "friend-request",
    readAt: now,
    createdAt: now,
    cardName: null,
    actorPseudo: "CyberSamurai",
    achievementName: null
  },
  {
    id: "n5",
    type: "trade_offer_received",
    referenceId: "trade-offer",
    readAt: now,
    createdAt: now,
    cardName: null,
    actorPseudo: "KpopFan99",
    achievementName: null
  },
  {
    id: "n6",
    type: "achievement_completed",
    referenceId: "market",
    readAt: now,
    createdAt: now,
    cardName: null,
    actorPseudo: null,
    achievementName: "Premier pas dans le marché"
  }
];
const progressNotifications: AppNotification[] = [
  {
    id: "mission",
    type: "mission_completed",
    referenceId: "daily-packs-5",
    readAt: null,
    createdAt: now,
    cardName: null,
    actorPseudo: null,
    achievementName: null,
    missionMetric: "regular_packs_opened",
    missionTarget: 5,
    missionPeriod: "daily"
  },
  {
    id: "achievement",
    type: "catalogue_achievement_completed",
    referenceId: "collector-50",
    readAt: null,
    createdAt: now,
    cardName: null,
    actorPseudo: null,
    achievementName: "Collector",
    achievementFamily: "collector",
    achievementTarget: 50
  }
];

export function AchievementsPreview() {
  const [items, setItems] = useState(achievements);
  return (
    <>
      <MissionGauges data={missions} onClaim={() => {}} onRefresh={() => {}} />
      <AchievementsGallery
        items={items}
        onClaim={async item =>
          setItems(current =>
            current.map(entry =>
              entry.id === item.id ? { ...entry, claimedAt: now } : entry
            )
          )
        }
      />
    </>
  );
}
export function WishlistPreview({ empty = false }: { empty?: boolean }) {
  return (
    <WishlistView
      previewCards={empty ? [] : wishlistCards}
      onRemove={async () => {}}
    />
  );
}
export function NotificationsPreview({
  mode = "list"
}: {
  mode?: "list" | "empty" | "error" | "progress";
}) {
  const tNotifications = useTranslations("topbar");
  const tMissions = useTranslations("missionUi");
  const tCatalogue = useTranslations("achievementCatalog");
  const tPacks = useTranslations("gameUi");
  const format = useFormatter();
  const [read, setRead] = useState(false);
  const notifications = (
    mode === "progress" ? progressNotifications : rawNotifications
  ).map(item =>
    notificationItem(
      read ? { ...item, readAt: now } : item,
      tNotifications,
      mode === "progress"
        ? format.dateTime(new Date(item.createdAt), {
            dateStyle: "short",
            timeStyle: "short",
            timeZone: "Europe/Paris"
          })
        : undefined,
      undefined,
      tMissions,
      tCatalogue
    )
  );
  useEffect(() => {
    if (mode === "progress") return;
    const frame = window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="notifications-panel"]'
        )
        ?.click()
    );
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);
  return (
    <div
      className={mode === "progress" ? "yk-boosters-page w-full" : undefined}
    >
      <Topbar
        view={mode === "progress" ? "packs" : "wishlist"}
        name="Kitsune"
        karas={4920}
        account={mode === "progress" ? <></> : undefined}
        notifications={mode === "empty" ? [] : notifications}
        notificationError={
          mode === "error"
            ? "Impossible de charger tes notifications"
            : undefined
        }
        onRetryNotifications={() => {}}
        onReadAll={() => setRead(true)}
        onOpenNotification={async () => {}}
      />
      {mode === "progress" ? (
        <main
          id="main-content"
          className="yk-game-main mx-auto w-full max-w-6xl px-6 py-10"
        >
          <header className="yk-pack-page-heading">
            <h1 className="yk-title mt-3">{tPacks("yourNextGreatPull")}</h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-ink-2">
              {tPacks("newYokkaiNewStoriesAlwaysSomethingToDiscover")}
            </p>
          </header>
          <BoostersPreview />
        </main>
      ) : (
        <div className="min-h-96" />
      )}
    </div>
  );
}

export function PhaseEightActionProof() {
  const tNotifications = useTranslations("topbar");
  const notifications = rawNotifications.map(item =>
    notificationItem(item, tNotifications)
  );
  const [events, setEvents] = useState<string[]>([]);
  const started = useRef(false);
  const [claimItem, setClaimItem] = useState(achievements[1]);
  const record = (event: string) =>
    setEvents(current =>
      current.includes(event) ? current : [...current, event]
    );
  const expected = [
    "claimAchievement:market",
    "toggleWishlist:wish-0",
    ...notifications.map(item => `notification:${item.id}:${item.href}`)
  ];
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const run = async () => {
      await new Promise(resolve => window.setTimeout(resolve, 100));
      document
        .querySelector<HTMLButtonElement>("[data-proof-claim] button")
        ?.click();
      document
        .querySelector<HTMLButtonElement>(
          "[data-proof-wishlist] .yk-wishlist-item button"
        )
        ?.click();
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="notifications-panel"]'
        )
        ?.click();
      await new Promise(resolve => window.setTimeout(resolve, 100));
      document
        .querySelectorAll<HTMLAnchorElement>(
          "#notifications-panel .yk-notification-list a"
        )
        .forEach(link => link.click());
    };
    void run();
  }, []);
  const passed = expected.every(event => events.includes(event));
  return (
    <div className="yk-social-stack">
      <div
        className={`yk-feedback ${passed ? "yk-feedback-success" : ""}`}
        data-proof-result={passed ? "passed" : "running"}
      >
        <strong>
          {passed ? "Preuve d’intégration réussie" : "Test des clics en cours…"}
        </strong>
        <span>
          {events.length}/{expected.length} appels vérifiés
        </span>
      </div>
      <section className="yk-social-panel" data-proof-claim>
        <h2 className="yk-section-title">Réclamation</h2>
        <div className="mt-5">
          <AchievementCard
            item={claimItem}
            onClaim={async item => {
              record(`claimAchievement:${item.id}`);
              setClaimItem({ ...item, claimedAt: now });
            }}
          />
        </div>
      </section>
      <section className="yk-social-panel" data-proof-wishlist>
        <h2 className="yk-section-title">Retrait Wishlist</h2>
        <WishlistView
          previewCards={[wishlistCards[0]]}
          onRemove={async id => record(`toggleWishlist:${id}`)}
        />
      </section>
      <Topbar
        view="wishlist"
        name="Kitsune"
        karas={4920}
        notifications={notifications}
        onReadAll={() => {}}
        onOpenNotification={async (id, href) =>
          record(`notification:${id}:${href}`)
        }
      />
      <pre id="phase-eight-proof-log">{events.join("\n")}</pre>
    </div>
  );
}
