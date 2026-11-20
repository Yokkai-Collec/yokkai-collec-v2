"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button, Karas, Pagination } from "@/components/ui";
import { createClient } from "@/utils/supabase/client";

type Gift = {
  id: string;
  suffix: string | null;
  amount: number;
  message: string;
  shareable: boolean;
  createdAt: string;
  redemptionCount: number;
  creatorId: string | null;
  creatorName: string | null;
};
type Redemption = {
  recipientId: string;
  recipientName: string | null;
  redeemedAt: string;
};
type HistoryPage<T> = { page: number; total: number; items: T[] };
const pageSize = 20;

function useHistoryPage<T>(page: number, revision: number, giftId?: string) {
  const request = `${page}:${revision}:${giftId ?? ""}`;
  const [result, setResult] = useState<{
    request: string;
    data: HistoryPage<T> | null;
  }>();
  useEffect(() => {
    let active = true;
    void Promise.resolve(
      createClient().rpc("admin_get_karas_gift_history", {
        p_page: page,
        p_gift_id: giftId
      })
    )
      .then(({ data, error }) => {
        if (active)
          setResult({
            request,
            data: error ? null : (data as HistoryPage<T> | null)
          });
      })
      .catch(() => {
        if (active) setResult({ request, data: null });
      });
    return () => {
      active = false;
    };
  }, [page, giftId, request]);
  return result?.request === request ? result.data : undefined;
}

function Player({ id, name }: { id: string | null; name: string | null }) {
  const t = useTranslations("giftCodes");
  return id && name ? (
    <Link
      className="font-semibold text-ink hover:underline"
      href={`/admin/players?player=${id}`}
    >
      {name}
    </Link>
  ) : (
    <span>{t("historyPlayerUnavailable")}</span>
  );
}

function Redemptions({ gift, revision }: { gift: Gift; revision: number }) {
  const t = useTranslations("giftCodes");
  const format = useFormatter();
  const [page, setPage] = useState(1);
  const data = useHistoryPage<Redemption>(page, revision, gift.id);
  if (data === undefined) return <p role="status">{t("historyLoading")}</p>;
  if (data === null) return <p role="alert">{t("historyFailed")}</p>;
  const missing = Math.max(0, gift.redemptionCount - data.total);
  return (
    <div className="space-y-2 text-sm text-ink-2">
      {data.items.length > 0 && (
        <ul className="divide-y divide-veil">
          {data.items.map(item => (
            <li
              key={item.recipientId}
              className="flex flex-wrap items-center justify-between gap-2 py-2 wrap-anywhere"
            >
              <Player id={item.recipientId} name={item.recipientName} />
              <time dateTime={item.redeemedAt}>
                {format.dateTime(new Date(item.redeemedAt), {
                  dateStyle: "medium",
                  timeStyle: "short"
                })}
              </time>
            </li>
          ))}
        </ul>
      )}
      {missing > 0 && (
        <p>{t("historyMissingRecipients", { count: missing })}</p>
      )}
      <Pagination
        page={data.page}
        pageCount={Math.ceil(data.total / pageSize)}
        onPageChange={setPage}
        scrollTargetId={`gift-redemptions-${gift.id}`}
      />
    </div>
  );
}

export function GiftCodeHistory() {
  const t = useTranslations("giftCodes");
  const format = useFormatter();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState<string>();
  const data = useHistoryPage<Gift>(page, revision);
  return (
    <section
      id="gift-history-list"
      aria-labelledby="gift-history-title"
      className="min-w-0 space-y-4 rounded-panel border border-veil bg-surface p-4 sm:p-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="gift-history-title" className="font-display text-xl">
          {t("historyTitle")}
        </h2>
        <Button
          variant="secondary"
          disabled={data === undefined}
          onClick={() => setRevision(value => value + 1)}
        >
          {t("historyRefresh")}
        </Button>
      </header>
      {data === undefined && (
        <p role="status" className="text-sm text-ink-2">
          {t("historyLoading")}
        </p>
      )}
      {data === null && (
        <p role="alert" className="text-sm text-danger">
          {t("historyFailed")}
        </p>
      )}
      {data?.total === 0 && (
        <p className="text-sm text-ink-2">{t("historyEmpty")}</p>
      )}
      {!!data?.total && (
        <>
          <ul className="divide-y divide-veil border-y border-veil">
            {data.items.map(gift => (
              <li key={gift.id} className="space-y-2 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="font-mono">
                    {gift.suffix
                      ? t("historyMaskedCode", { suffix: gift.suffix })
                      : t("historyReference", {
                          ref: gift.id.slice(0, 8).toUpperCase()
                        })}
                  </strong>
                  <Karas amount={gift.amount} />
                  <span className="text-sm text-ink-2">
                    {t(gift.shareable ? "sharedMode" : "singleMode")}
                  </span>
                </div>
                <p className="text-sm text-ink-2">
                  {t.rich("historyCreated", {
                    date: format.dateTime(new Date(gift.createdAt), {
                      dateStyle: "medium",
                      timeStyle: "short"
                    }),
                    name: gift.creatorName ?? t("historyPlayerUnavailable"),
                    time: chunks => (
                      <time dateTime={gift.createdAt}>{chunks}</time>
                    ),
                    player: () => (
                      <Player id={gift.creatorId} name={gift.creatorName} />
                    )
                  })}
                </p>
                <p className="text-sm whitespace-pre-wrap wrap-anywhere text-ink-2">
                  {gift.message}
                </p>
                {gift.redemptionCount > 0 ? (
                  <Button
                    variant="secondary"
                    aria-expanded={expanded === gift.id}
                    aria-controls={`gift-redemptions-${gift.id}`}
                    onClick={() =>
                      setExpanded(expanded === gift.id ? undefined : gift.id)
                    }
                  >
                    {t("historyUses", { count: gift.redemptionCount })}
                  </Button>
                ) : (
                  <p className="text-sm text-ink-2">{t("historyUnused")}</p>
                )}
                {gift.redemptionCount > 0 && (
                  <div
                    id={`gift-redemptions-${gift.id}`}
                    hidden={expanded !== gift.id}
                    className="scroll-mt-24 rounded-panel bg-void px-3"
                  >
                    {expanded === gift.id && (
                      <Redemptions gift={gift} revision={revision} />
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
            scrollTargetId="gift-history-list"
          />
        </>
      )}
    </section>
  );
}
