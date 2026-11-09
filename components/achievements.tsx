"use client";

import { useTranslations, useFormatter } from "next-intl";
import { gameErrorKey } from "@/i18n/game-messages";
import { useEffect, useState, type ReactNode } from "react";
import {
  claimCatalogueAchievement,
  claimAchievementUpgrade,
  getAchievementCatalogue
} from "@/lib/data/achievement-catalogue";
import { MissionsPanel } from "@/components/missions";
import { Topbar } from "@/components/topbar";
import { Button, Karas, StatusPill, Toast } from "@/components/ui";
import { getGameInfo } from "@/lib/data/cards";
import type { Achievement } from "@/lib/data/achievements";
import { subscribePlayerSnapshotInvalidation } from "@/lib/data/player-state";

export function AchievementCard({
  item,
  busy = false,
  onClaim
}: {
  item: Achievement;
  busy?: boolean;
  onClaim: (item: Achievement) => Promise<void> | void;
}) {
  const t = useTranslations("achievementUi");
  const fmt = useFormatter();
  const catalog = useTranslations("achievementCatalog");
  const hidden = item.secret && !item.completedAt;
  const familyTitle =
    item.family && catalog.has(`${item.family}.title`)
      ? catalog(`${item.family}.title`)
      : null;
  const familyDescription =
    item.family && catalog.has(`${item.family}.description`)
      ? catalog(`${item.family}.description`, { target: item.conditionValue })
      : null;
  const titleKey = `title${item.id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`;
  const descriptionKey = `description${item.id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`;
  const title = hidden
    ? t("secretTitle")
    : (familyTitle ?? (t.has(titleKey) ? t(titleKey) : item.title));
  const description = hidden
    ? t("secretDescription")
    : (familyDescription ??
      (t.has(descriptionKey) ? t(descriptionKey) : item.description));
  const state = item.claimedAt
    ? "claimed"
    : item.completedAt
      ? "completed"
      : "progress";
  const percent = Math.min(
    100,
    item.progressTarget ? (item.progressCurrent / item.progressTarget) * 100 : 0
  );
  return (
    <article id={item.id} className={`yk-achievement-card is-${state}`}>
      <header>
        <span className="yk-achievement-icon" aria-hidden="true">
          {state === "claimed" ? "✓" : state === "completed" ? "✦" : "◇"}
        </span>
        <div>
          <div className="yk-achievement-title">
            <h2>{title}</h2>
            <StatusPill
              tone={
                state === "claimed"
                  ? "success"
                  : state === "completed"
                    ? "gold"
                    : "info"
              }
            >
              {state === "claimed"
                ? t("claimed")
                : state === "completed"
                  ? t("ready")
                  : t("progress")}
            </StatusPill>
          </div>
          <p>{description}</p>
        </div>
      </header>
      <div className="yk-achievement-progress">
        <div>
          <span>
            {item.family
              ? t("numericProgress", {
                  current: item.progressCurrent,
                  target: item.progressTarget
                })
              : t("progressText", {
                  current: fmt.number(item.progressCurrent),
                  target: fmt.number(item.progressTarget),
                  count: item.progressTarget,
                  kind: item.conditionType,
                  label: item.progressLabel ?? "",
                  hasLabel: item.progressLabel ? "yes" : "no"
                })}
          </span>
          <strong>{fmt.number(Math.round(percent))}%</strong>
        </div>
        <div
          className="yk-achievement-track"
          role="progressbar"
          aria-label={t("progressFor", { title })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
        >
          <i
            style={
              { "--achievement-progress": `${percent}%` } as React.CSSProperties
            }
          />
        </div>
      </div>
      <footer>
        <span>
          {t("reward")} <Karas amount={item.karasReward} />
        </span>
        {item.upgradeReward ? (
          <Button disabled={busy} onClick={() => void onClaim(item)}>
            {t("upgrade", { amount: item.upgradeReward })}
          </Button>
        ) : item.locked ? (
          <StatusPill tone="info">{t("proLocked")}</StatusPill>
        ) : state === "completed" ? (
          <Button disabled={busy} onClick={() => void onClaim(item)}>
            {busy
              ? t("claiming")
              : t("claim", { amount: fmt.number(item.karasReward) })}
          </Button>
        ) : state === "claimed" ? (
          <StatusPill tone="success">{t("claimed")}</StatusPill>
        ) : (
          <span className="yk-achievement-pending">
            {t("remaining", {
              amount: fmt.number(
                Math.max(0, item.progressTarget - item.progressCurrent)
              )
            })}
          </span>
        )}
      </footer>
    </article>
  );
}

export function AchievementsGallery({
  items,
  busyId,
  onClaim
}: {
  items: Achievement[];
  busyId?: string | null;
  onClaim: (item: Achievement) => Promise<void> | void;
}) {
  const t = useTranslations("achievementUi");
  const fmt = useFormatter();
  const [section, setSection] = useState("all");
  const sections = [
    ...new Set(
      items
        .map(item => item.section)
        .filter((value): value is string => Boolean(value))
    )
  ];
  const groups = new Map<string, Achievement[]>();
  for (const item of items) {
    if (section !== "all" && item.section !== section) continue;
    const key =
      item.family && item.family !== "secret"
        ? `${item.family}:${item.conditionCategory ?? ""}`
        : item.id;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const unlocked = items.filter(item => item.completedAt).length;
  const percent = items.length ? (unlocked / items.length) * 100 : 0;
  return (
    <>
      <section className="yk-achievement-summary">
        <div>
          <p className="eyebrow">{t("overall")}</p>
          <p>
            <strong>
              {fmt.number(unlocked)}/{fmt.number(items.length)}
            </strong>{" "}
            {t("unlocked")}
          </p>
        </div>
        <div className="yk-achievement-global-track">
          <i
            style={
              { "--achievement-progress": `${percent}%` } as React.CSSProperties
            }
          />
        </div>
        <span>{Math.round(percent)}%</span>
      </section>
      <div className="yk-achievement-filters" aria-label={t("achievements")}>
        {["all", ...sections].map(value => (
          <Button
            key={value}
            variant="secondary"
            aria-pressed={section === value}
            onClick={() => setSection(value)}
          >
            {t(value === "all" ? "allSections" : `section${value}`)}
          </Button>
        ))}
      </div>
      <section aria-label={t("achievements")} className="yk-achievement-grid">
        {[...groups.entries()].map(([key, tiers]) => {
          const ordered = [...tiers].sort(
            (a, b) => a.conditionValue - b.conditionValue
          );
          const next =
            ordered.find(
              item =>
                item.upgradeReward || (item.completedAt && !item.claimedAt)
            ) ??
            ordered.find(item => !item.completedAt) ??
            ordered[ordered.length - 1];
          const others = ordered.filter(item => item.id !== next.id);
          return (
            <div key={key} className="yk-achievement-family">
              {next.conditionCategory && (
                <p className="eyebrow">{next.conditionCategory}</p>
              )}
              <AchievementCard
                item={next}
                busy={busyId === next.id}
                onClaim={onClaim}
              />
              {others.length > 0 && (
                <details>
                  <summary>{t("tiers", { count: others.length })}</summary>
                  {others.map(item => (
                    <AchievementCard
                      key={item.id}
                      item={item}
                      busy={busyId === item.id}
                      onClaim={onClaim}
                    />
                  ))}
                </details>
              )}
            </div>
          );
        })}
      </section>
    </>
  );
}

export function AchievementsPage({ account }: { account?: ReactNode }) {
  const t = useTranslations("achievementUi");
  const fmt = useFormatter();
  const rootT = useTranslations();
  const [items, setItems] = useState<Achievement[]>([]);
  const [name, setName] = useState<string>();
  const [balance, setBalance] = useState<number>();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribePlayerSnapshotInvalidation(scopes => {
      if (scopes.includes("balance")) {
        void getAchievementCatalogue().then(
          next => {
            if (active) setItems(next);
          },
          () => undefined
        );
        void getGameInfo().then(
          game => {
            if (active) setBalance(game.karasBalance);
          },
          () => undefined
        );
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([getAchievementCatalogue(), getGameInfo()]).then(
      ([achievements, game]) => {
        if (!active) return;
        setItems(achievements);
        setName(game.user.name);
        setBalance(game.karasBalance);
        setError("");
      },
      reason => {
        if (active) setError(gameErrorKey(reason, "achievementUi.loadError"));
      }
    );
    return () => {
      active = false;
    };
  }, []);
  async function claim(item: Achievement) {
    if (busy) return;
    setBusy(item.id);
    setError("");
    try {
      const result = await (item.upgradeReward
        ? claimAchievementUpgrade(item.id)
        : claimCatalogueAchievement(item.id));
      setBalance(result.balance);
      setItems(current =>
        current.map(entry =>
          entry.id === item.id
            ? {
                ...entry,
                claimedAt: entry.claimedAt ?? result.claimedAt,
                upgradeReward: 0
              }
            : entry
        )
      );
      setToast(t("rewardClaimed", { amount: fmt.number(result.reward) }));
    } catch (reason) {
      setError(gameErrorKey(reason, "achievementUi.claimError"));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="w-full">
      <Topbar
        view="achievements"
        account={account}
        name={name}
        karas={balance}
      />
      <main id="main-content" className="mx-auto w-full max-w-6xl px-6 py-10">
        <p className="eyebrow">{t("journey")}</p>
        <h1 className="yk-title mt-3">{t("pageTitle")}</h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-ink-2">
          {t("intro")}
        </p>
        <MissionsPanel />
        <h2 id="achievements" className="yk-title mt-10">
          {t("achievements")}
        </h2>
        {error && (
          <p role="alert" className="yk-social-alert mt-6">
            {rootT(error)}
          </p>
        )}
        {!items.length && !error ? (
          <p role="status" className="mt-10 text-sm text-ink-2">
            {t("loading")}
          </p>
        ) : (
          <AchievementsGallery items={items} busyId={busy} onClaim={claim} />
        )}
      </main>
      <Toast message={toast} onDismiss={() => setToast("")} />
    </div>
  );
}
