"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Button, Karas, Toast } from "@/components/ui";
import {
  getMissions,
  claimMissionMilestone,
  type Missions,
  type MissionGauge
} from "@/lib/data/missions";
import { gameErrorKey } from "@/i18n/game-messages";

function ResetCountdown({
  end,
  serverNow,
  onReset
}: {
  end: string;
  serverNow: string;
  onReset: () => void;
}) {
  const t = useTranslations("missionUi");
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil((Date.parse(end) - Date.parse(serverNow)) / 1000))
  );
  const reset = useRef(onReset);
  useEffect(() => {
    reset.current = onReset;
  }, [onReset]);
  useEffect(() => {
    const started = performance.now();
    const duration = Date.parse(end) - Date.parse(serverNow);
    let expired = false;
    const tick = () => {
      const seconds = Math.max(
        0,
        Math.ceil((duration - performance.now() + started) / 1000)
      );
      setRemaining(seconds);
      if (seconds === 0 && !expired) {
        expired = true;
        reset.current();
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [end, serverNow]);
  return (
    <span className="yk-mission-countdown">
      {t("resetsIn", {
        days: Math.floor(remaining / 86400),
        hours: Math.floor(remaining / 3600) % 24,
        minutes: Math.floor(remaining / 60) % 60,
        seconds: remaining % 60
      })}
    </span>
  );
}
export function MissionGauges({
  data,
  compact = false,
  busy,
  onClaim,
  onRefresh
}: {
  data: Missions;
  compact?: boolean;
  busy?: string | null;
  onClaim: (g: MissionGauge, p: number) => void;
  onRefresh: () => void;
}) {
  const t = useTranslations("missionUi");
  const fmt = useFormatter();
  return (
    <section className="yk-missions" aria-label={t("title")}>
      <header className="yk-mission-heading">
        <h2>{t("title")}</h2>
        {data.pro && <span className="yk-mission-pro">{t("proBonus")}</span>}
      </header>
      {!data.active ? (
        <div role="status" className="yk-mission-launch">
          <p>{t("launch")}</p>
          <ResetCountdown
            end={data.launchAt}
            serverNow={data.serverNow}
            onReset={onRefresh}
          />
        </div>
      ) : (
        <div className="yk-mission-gauges">
          {data.periods.map(g => {
            const visible = compact
              ? [...g.missions]
                  .filter(m => m.current < m.target)
                  .sort((a, b) => b.current / b.target - a.current / a.target)
                  .slice(0, 2)
              : g.missions;
            return (
              <article className="yk-mission-gauge" key={g.period}>
                <header>
                  <h3>{t(g.period)}</h3>
                  <strong className="yk-mission-score">
                    {fmt.number(g.points)}
                    <span>/100</span>
                  </strong>
                  <ResetCountdown
                    end={g.endsAt}
                    serverNow={data.serverNow}
                    onReset={onRefresh}
                  />
                </header>
                {g.points === 100 && (
                  <p className="yk-mission-done">{t("complete")}</p>
                )}
                <progress
                  max={100}
                  value={g.points}
                  aria-label={t("gaugeLabel", { period: t(g.period) })}
                />
                <ul
                  className="yk-mission-milestones"
                  aria-label={t("milestones")}
                >
                  {g.milestones.map(m => (
                    <li
                      key={m.points}
                      className={
                        m.claimedAt
                          ? "is-claimed"
                          : g.points >= m.points
                            ? "is-ready"
                            : ""
                      }
                    >
                      <span>
                        {t(m.claimedAt ? "donePoints" : "points", {
                          count: m.points
                        })}
                      </span>
                      <Karas amount={m.reward} />
                      {m.claimedAt || g.points < m.points ? (
                        <span className="sr-only">
                          {m.claimedAt ? t("claimed") : t("lockedLabel")}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="yk-claim-area"
                          disabled={Boolean(busy)}
                          aria-label={
                            busy === `${g.period}-${m.points}`
                              ? t("claiming")
                              : t("claim")
                          }
                          onClick={() => onClaim(g, m.points)}
                        />
                      )}
                    </li>
                  ))}
                </ul>
                <ul className="yk-mission-list">
                  {visible.map(m => (
                    <li
                      key={m.id}
                      className={m.current >= m.target ? "is-complete" : ""}
                    >
                      <div>
                        <p>
                          {t(`objectives.${m.metric}`, { count: m.target })}
                        </p>
                        <span>
                          {t("missionProgress", {
                            current: Math.min(m.current, m.target),
                            target: m.target
                          })}
                        </span>
                      </div>
                      <strong>
                        {m.current >= m.target
                          ? t("donePoints", { count: m.points })
                          : t("missionPoints", { count: m.points })}
                      </strong>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      )}
      {compact && (
        <Link
          className="yk-button yk-button-secondary"
          href="/achievements#missions"
        >
          {t("viewAll")}
        </Link>
      )}
    </section>
  );
}
export function MissionsPanel({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("missionUi");
  const rootT = useTranslations();
  const [data, setData] = useState<Missions | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await getMissions();
      if (mounted.current) {
        setData(next);
        setError("");
      }
    } catch (reason) {
      if (mounted.current)
        setError(gameErrorKey(reason, "missionUi.unavailable"));
    } finally {
      inFlight.current = false;
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(refresh);
    const focus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [refresh]);
  async function claim(g: MissionGauge, p: number) {
    if (busy) return;
    setBusy(`${g.period}-${p}`);
    try {
      const result = await claimMissionMilestone(g, p);
      setToast(t("rewardClaimed", { amount: result.reward }));
      await refresh();
    } catch (reason) {
      setError(gameErrorKey(reason, "missionUi.unavailable"));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div id="missions">
      {error && (
        <p role="alert" className="yk-social-alert">
          {rootT(error)}{" "}
          <Button onClick={() => void refresh()}>{t("retry")}</Button>
        </p>
      )}
      {data ? (
        <MissionGauges
          data={data}
          compact={compact}
          busy={busy}
          onClaim={(g, p) => void claim(g, p)}
          onRefresh={() => void refresh()}
        />
      ) : (
        !error && <p role="status">{t("loading")}</p>
      )}
      <Toast message={toast} onDismiss={() => setToast("")} />
    </div>
  );
}
