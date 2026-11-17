"use client";
import { useTranslations } from "next-intl";

import { useEffect, useState, type ReactNode } from "react";
import { Topbar } from "@/components/topbar";
import { getGameInfo } from "@/lib/data/cards";
import { subscribePlayerSnapshotInvalidation } from "@/lib/data/player-state";

export function LeaderboardTopbar({
  account,
  view = "leaderboard"
}: {
  account?: ReactNode;
  view?: "leaderboard" | "events";
}) {
  const t = useTranslations("socialUi");
  const [karas, setKaras] = useState<number>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      try {
        const info = await getGameInfo();
        if (active && current === request) {
          setKaras(info.karasBalance);
          setError(undefined);
        }
      } catch {
        if (active && current === request) setError("balanceFailed");
      }
    };
    void refresh();
    const unsubscribe = subscribePlayerSnapshotInvalidation(scopes => {
      if (scopes.includes("balance")) void refresh();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [attempt]);

  return (
    <Topbar
      view={view}
      account={account}
      karas={karas}
      infoError={error ? t(error) : undefined}
      onRetryInfo={() => {
        setError(undefined);
        setAttempt(value => value + 1);
      }}
    />
  );
}
