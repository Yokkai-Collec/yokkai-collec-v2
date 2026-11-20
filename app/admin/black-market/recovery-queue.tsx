"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button, Pagination } from "@/components/ui";
import { createClient } from "@/utils/supabase/client";

type PendingAccount = {
  userId: string;
  pseudo: string | null;
  eligibleAt: string;
  eligible: boolean;
  pendingLR: number;
  pendingSSR: number;
  blockedCount: number;
};

type BlockedCard = {
  id: string;
  name: string;
  rarity: "LR" | "SSR";
  reasons: ("auction" | "trade" | "investigation")[];
};

type RecoveryPage<T> = { page: number; total: number; items: T[] };
const pageSize = 20;

function useRecoveryPage<T>(page: number, revision: number, userId?: string) {
  const requestKey = `${page}:${revision}:${userId ?? ""}`;
  const [result, setResult] = useState<{
    requestKey: string;
    data: RecoveryPage<T> | null;
  }>();

  useEffect(() => {
    let active = true;
    void Promise.resolve(
      createClient().rpc("admin_get_black_market_recovery_queue", {
        p_page: page,
        p_user_id: userId
      })
    )
      .then(({ data, error }) => {
        if (error) throw error;
        if (active) setResult({ requestKey, data: data as RecoveryPage<T> });
      })
      .catch(() => {
        if (active) setResult({ requestKey, data: null });
      });
    return () => {
      active = false;
    };
  }, [page, requestKey, userId]);

  return result?.requestKey === requestKey ? result.data : undefined;
}

function BlockedCards({
  userId,
  revision
}: {
  userId: string;
  revision: number;
}) {
  const t = useTranslations("blackMarket");
  const format = useFormatter();
  const [page, setPage] = useState(1);
  const data = useRecoveryPage<BlockedCard>(page, revision, userId);
  if (data === undefined) return <p role="status">{t("loading")}</p>;
  if (data === null) return <p role="alert">{t("recoveryQueueUnavailable")}</p>;
  if (!data.total) return <p>{t("recoveryNoBlockedCards")}</p>;
  return (
    <>
      <ul className="yk-black-market-blocked-cards">
        {data.items.map(card => (
          <li key={card.id}>
            <strong>
              {card.name} <span>{card.rarity}</span>
            </strong>
            <span>
              {format.list(
                card.reasons.map(reason => t(`recoveryBlockReasons.${reason}`))
              )}
            </span>
          </li>
        ))}
      </ul>
      <Pagination
        page={data.page}
        pageCount={Math.ceil(data.total / pageSize)}
        onPageChange={setPage}
        scrollTargetId={`black-market-blocks-${userId}`}
      />
    </>
  );
}

export function RecoveryQueue({ enabled }: { enabled: boolean }) {
  const t = useTranslations("blackMarket");
  const format = useFormatter();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState<string>();
  const data = useRecoveryPage<PendingAccount>(page, revision);

  return (
    <section
      className="yk-black-market-recovery-queue"
      id="black-market-recovery-queue"
      aria-labelledby="black-market-recovery-queue-heading"
    >
      <header>
        <h2 id="black-market-recovery-queue-heading">{t("recoveryQueue")}</h2>
        <Button
          variant="secondary"
          disabled={data === undefined}
          onClick={() => setRevision(value => value + 1)}
        >
          {t("refreshRecoveryQueue")}
        </Button>
      </header>
      {!enabled && <p>{t("recoveryPaused")}</p>}
      {data === undefined && <p role="status">{t("loading")}</p>}
      {data === null && <p role="alert">{t("recoveryQueueUnavailable")}</p>}
      {data?.total === 0 && <p>{t("recoveryQueueEmpty")}</p>}
      {!!data?.total && (
        <>
          <p>{t("recoveryPendingAccounts", { count: data.total })}</p>
          <ul className="yk-black-market-recovery-accounts">
            {data.items.map(account => (
              <li key={account.userId}>
                <div className="yk-black-market-recovery-account">
                  <div>
                    <Link href={`/admin/players?player=${account.userId}`}>
                      {account.pseudo ?? account.userId}
                    </Link>
                    <p>
                      {t.rich("recoveryEligibility", {
                        status: account.eligible ? "eligible" : "waiting",
                        date: format.dateTime(new Date(account.eligibleAt), {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: "Europe/Paris"
                        }),
                        time: chunks => (
                          <time dateTime={account.eligibleAt}>{chunks}</time>
                        )
                      })}
                    </p>
                  </div>
                  <span>
                    {t("recoveryPendingCards", {
                      lr: account.pendingLR,
                      ssr: account.pendingSSR
                    })}
                  </span>
                  {account.blockedCount > 0 && (
                    <Button
                      variant="secondary"
                      aria-expanded={expanded === account.userId}
                      aria-controls={`black-market-blocks-${account.userId}`}
                      onClick={() =>
                        setExpanded(
                          expanded === account.userId
                            ? undefined
                            : account.userId
                        )
                      }
                    >
                      {t("recoveryBlockedCount", {
                        count: account.blockedCount
                      })}
                    </Button>
                  )}
                </div>
                {account.blockedCount > 0 && (
                  <div
                    className="yk-black-market-recovery-blocks"
                    id={`black-market-blocks-${account.userId}`}
                    hidden={expanded !== account.userId}
                  >
                    {expanded === account.userId && (
                      <BlockedCards
                        userId={account.userId}
                        revision={revision}
                      />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Pagination
            page={data.page}
            pageCount={Math.ceil(data.total / pageSize)}
            onPageChange={setPage}
            scrollTargetId="black-market-recovery-queue"
          />
        </>
      )}
    </section>
  );
}
