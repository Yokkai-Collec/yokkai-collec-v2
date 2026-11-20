import { getFormatter, getTranslations } from "next-intl/server";
import { UrlPagination } from "@/components/ui/url-pagination";
import { anticheatSanctionLabel } from "@/lib/anticheat-sanction-labels";

const referralSanctionLabels: Partial<Record<string, string>> = {
  AFFILIATE_ABUSE_SANCTION: "sanction",
  AFFILIATE_ABUSE_WARNING: "warning",
  AFFILIATE_ABUSE_WARNING_WITH_PENALTY: "penalty",
  AFFILIATE_ABUSE_NETWORK_WARNING: "networkWarning"
};

export type ModerationHistoryData = {
  page: number;
  pageCount: number;
  restriction: "permanent" | "temporary" | null;
  restrictionEndsAt: string | null;
  items: {
    id: string;
    kind: "warning" | "ban" | "unban" | "sanction" | "smurf";
    occurredAt: string;
    reason: string | null;
    actor: string | null;
    acknowledgedAt: string | null;
    receiptType: string | null;
    receiptState: "APPLIED" | "ROLLED_BACK" | null;
    endsAt: string | null;
    cardsRemoved: number;
    karasRemoved: number;
  }[];
};

export async function ModerationHistory({
  history
}: {
  history: ModerationHistoryData | null;
}) {
  const [t, sanctions, appeals, format] = await Promise.all([
    getTranslations("playerModerationHistory"),
    getTranslations("accountSanctions"),
    getTranslations("sanctionAppeals"),
    getFormatter()
  ]);
  const dateTime = (value: string) =>
    format.dateTime(new Date(value), {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Paris"
    });

  return (
    <section
      id="player-moderation-history"
      aria-labelledby="player-moderation-history-heading"
      className="min-w-0 scroll-mt-24 space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5"
    >
      <h2 id="player-moderation-history-heading" className="text-lg font-bold">
        {t("title")}
      </h2>
      {!history && (
        <p role="status" className="text-sm text-slate-300">
          {t("unavailable")}
        </p>
      )}
      {history?.restriction && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {history.restrictionEndsAt
            ? t("temporaryRestriction", {
                date: dateTime(history.restrictionEndsAt)
              })
            : t("permanentRestriction")}
        </p>
      )}
      {history?.items.length === 0 && (
        <p className="text-sm text-slate-400">{t("empty")}</p>
      )}
      {!!history?.items.length && (
        <ol className="grid gap-3">
          {history.items.map(item => {
            const type = item.receiptType ?? "";
            const label =
              anticheatSanctionLabel(type) ?? referralSanctionLabels[type];
            return (
              <li
                key={item.id}
                className="min-w-0 space-y-2 rounded-xl border border-white/10 bg-slate-950 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <h3 className="font-semibold">
                    {label
                      ? sanctions(`${label}.title`)
                      : t(`kind.${item.kind}`)}
                  </h3>
                  <time
                    dateTime={item.occurredAt}
                    className="text-xs leading-6 text-slate-400"
                  >
                    {dateTime(item.occurredAt)}
                  </time>
                </div>
                {item.reason && (
                  <p className="whitespace-pre-wrap wrap-anywhere text-sm text-slate-200">
                    {item.reason}
                  </p>
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                  {item.actor && (
                    <span className="wrap-anywhere">
                      {t("actor", { name: item.actor })}
                    </span>
                  )}
                  {item.kind === "warning" && (
                    <span
                      className={
                        item.acknowledgedAt
                          ? "text-emerald-200"
                          : "text-amber-200"
                      }
                    >
                      {item.acknowledgedAt
                        ? t("acknowledged", {
                            date: dateTime(item.acknowledgedAt)
                          })
                        : t("pending")}
                    </span>
                  )}
                  {item.receiptState && (
                    <span>{appeals(`state.${item.receiptState}`)}</span>
                  )}
                  {item.endsAt && (
                    <span>{t("endsAt", { date: dateTime(item.endsAt) })}</span>
                  )}
                  {item.cardsRemoved > 0 && (
                    <span>
                      {t("cardsRemoved", { count: item.cardsRemoved })}
                    </span>
                  )}
                  {item.karasRemoved > 0 && (
                    <span>
                      {t("karasRemoved", { amount: item.karasRemoved })}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {history && (
        <UrlPagination
          page={history.page}
          pageCount={history.pageCount}
          parameter="history"
          scrollTargetId="player-moderation-history"
        />
      )}
    </section>
  );
}
