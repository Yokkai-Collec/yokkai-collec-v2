"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import {
  getMysteryAuctionHistory,
  type MysteryHistoryPage
} from "@/lib/data/market";
import { YokaiCard } from "@/components/yokai-card";
import { CardShell } from "@/components/card-shell";
import { Button } from "@/components/ui";

export default function MysteryAuctionHistory() {
  const t = useTranslations("mysteryAuction");
  const format = useFormatter();
  const [page, setPage] = useState<MysteryHistoryPage>();
  const [pending, setPending] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void getMysteryAuctionHistory()
      .then(
        data => {
          if (active) setPage(data);
        },
        () => {
          if (active) setFailed(true);
        }
      )
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function loadMore() {
    setPending(true);
    setFailed(false);
    try {
      const next = await getMysteryAuctionHistory(
        page?.nextBefore ?? undefined
      );
      setPage(previous => ({
        ...next,
        items: [...(previous?.items ?? []), ...next.items]
      }));
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className="yk-mystery-archive"
      aria-labelledby="mystery-history-title"
      aria-busy={pending}
    >
      <h2 id="mystery-history-title" className="yk-section-title">
        {t("historyTitle")}
      </h2>
      <p className="mt-2 text-sm text-ink-3">{t("historyDescription")}</p>
      {!!page?.items.length && (
        <ul className="yk-mystery-archive-grid">
          {page.items.map(item => {
            const date = format.dateTime(
              new Date(item.editionAt ?? `${item.day}T12:00:00Z`),
              {
                day: "numeric",
                month: "short",
                year: "numeric",
                ...(item.editionAt
                  ? { hour: "2-digit" as const, minute: "2-digit" as const }
                  : { timeZone: "UTC" })
              }
            );
            return (
              <li key={item.id}>
                <Link
                  href={`/market/${item.id}`}
                  aria-label={t("historyResult", {
                    name: item.card.name,
                    date
                  })}
                >
                  <CardShell>
                    <YokaiCard {...item.card} />
                  </CardShell>
                  <time dateTime={item.editionAt ?? item.day}>{date}</time>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p role="status" className="mt-4 text-sm text-ink-3">
        {failed
          ? t("historyError")
          : pending
            ? t("historyLoading")
            : page?.items.length
              ? null
              : t("historyEmpty")}
      </p>
      {(failed || page?.nextBefore) && (
        <Button
          className="mt-4"
          variant="secondary"
          disabled={pending}
          onClick={() => void loadMore()}
        >
          {t(failed ? "historyRetry" : "historyMore")}
        </Button>
      )}
    </section>
  );
}
