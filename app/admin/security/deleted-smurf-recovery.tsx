import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { applyDeletedSmurfRecoveryAction } from "./actions";
import {
  SanctionQuarantineConflicts,
  type SanctionQuarantineConflict
} from "./sanction-quarantine-conflicts";

type Recovery = {
  cardIds?: string[];
  cards: number;
  blockedCards: number;
  cardsNoLongerOnPrimary: number;
  tradeKaras: number;
  saleKaras: number;
  saleCount: number;
  karas: number;
  quarantineConflicts?: SanctionQuarantineConflict[];
};

export type DeletedSmurfRecoveryPreview = {
  primary: { userId: string; pseudo: string; karasBalance: number };
  candidates: {
    id: string;
    acceptedAt: string;
    incomingCards: number;
    outgoingCards: number;
    incomingKaras: number;
    outgoingKaras: number;
    incomingNames?: string[];
    outgoingNames?: string[];
  }[];
  candidateCount: number;
  selectedTradeIds: string[];
  selectionValid: boolean;
  eligible: boolean;
  previewToken?: string;
  recovery: Recovery;
  cardLabels?: Record<string, { name: string }>;
  receipts: {
    id: string;
    appliedAt: string;
    note: string;
    evidenceReference: string;
    recovery: Recovery;
    history: {
      cardLabels?: Record<string, { name: string }>;
      trades: {
        id: string;
        incomingCardIds?: string[];
        outgoingCardIds?: string[];
      }[];
      sales: { id: string; cardInstanceId: string; karas: number }[];
    };
  }[];
};

export async function DeletedSmurfRecovery({
  data,
  applied,
  embedded = false
}: {
  data: DeletedSmurfRecoveryPreview;
  applied: boolean;
  embedded?: boolean;
}) {
  const t = await getTranslations("adminSecurity.deletedRecovery");
  const locale = await getLocale();
  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short"
  });
  return (
    <section
      className={`min-w-0 space-y-4 [overflow-wrap:anywhere] ${embedded ? "" : "rounded-2xl border border-red-300/30 bg-red-950/15 p-4 sm:p-5"}`}
      aria-labelledby="deleted-recovery-title"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2
            id="deleted-recovery-title"
            className="text-xl font-black [overflow-wrap:anywhere]"
          >
            {t("title", { player: data.primary.pseudo })}
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">
            {t("description")}
          </p>
        </div>
        {!embedded && (
          <Link
            className="yk-button yk-button-secondary text-center"
            href="/admin/security"
          >
            {t("close")}
          </Link>
        )}
      </div>
      {applied && (
        <p
          role="status"
          className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 p-3 text-sm text-emerald-100"
        >
          {t("applied")}
        </p>
      )}
      <p className="rounded-xl border border-amber-300/25 bg-amber-500/10 p-3 text-sm text-amber-100">
        {t("evidenceWarning")}
      </p>
      <form method="get" className="space-y-3">
        <input type="hidden" name="sanction" value={data.primary.userId} />
        <input type="hidden" name="mode" value="deleted" />
        <h3 className="font-bold">{t("chooseTrades")}</h3>
        <p className="text-sm text-slate-400">
          {t("candidateCount", {
            shown: data.candidates.length,
            total: data.candidateCount
          })}
        </p>
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {data.candidates.length === 0 && (
            <p className="rounded-lg bg-slate-950/60 p-4 text-sm text-slate-300">
              {t("empty")}
            </p>
          )}
          {data.candidates.map(trade => (
            <label
              key={trade.id}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-slate-700 bg-slate-950/60 p-3"
            >
              <input
                type="checkbox"
                name="source"
                value={trade.id}
                defaultChecked={data.selectedTradeIds.includes(trade.id)}
                className="mt-1 size-5 shrink-0"
              />
              <span className="min-w-0 text-sm [overflow-wrap:anywhere]">
                <span className="block font-bold">
                  {formatter.format(new Date(trade.acceptedAt))}
                </span>
                <span className="block text-slate-200">
                  {t("incoming", {
                    cards: trade.incomingCards,
                    karas: trade.incomingKaras
                  })}
                </span>
                {!!trade.incomingNames?.length && (
                  <span className="block text-slate-200">
                    {trade.incomingNames.join(", ")}
                  </span>
                )}
                <span className="block text-slate-400">
                  {t("outgoing", {
                    cards: trade.outgoingCards,
                    karas: trade.outgoingKaras
                  })}
                </span>
                {!!trade.outgoingNames?.length && (
                  <span className="block text-slate-400">
                    {trade.outgoingNames.join(", ")}
                  </span>
                )}
                <span className="mt-1 block font-mono text-xs text-slate-500">
                  {trade.id}
                </span>
              </span>
            </label>
          ))}
        </div>
        <button
          className="yk-button min-h-11 w-full whitespace-normal sm:w-auto"
          type="submit"
        >
          {t("preview")}
        </button>
      </form>
      {data.selectedTradeIds.length > 0 && (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
            <h3 className="font-bold">{t("consequences")}</h3>
            {!!data.recovery.cardIds?.length && (
              <ul className="mt-3 space-y-1 text-sm text-slate-200">
                {data.recovery.cardIds.map(id => (
                  <li key={id}>
                    {data.cardLabels?.[id]?.name ?? t("unknownCardName")}
                  </li>
                ))}
              </ul>
            )}
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-slate-400">{t("cards")}</dt>
                <dd className="font-bold">{data.recovery.cards}</dd>
              </div>
              <div>
                <dt className="text-slate-400">{t("tradeKaras")}</dt>
                <dd className="font-bold">
                  {data.recovery.tradeKaras.toLocaleString(locale)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">
                  {t("saleKaras", { count: data.recovery.saleCount })}
                </dt>
                <dd className="font-bold">
                  {data.recovery.saleKaras.toLocaleString(locale)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">{t("totalKaras")}</dt>
                <dd className="font-bold">
                  {data.recovery.karas.toLocaleString(locale)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">{t("balance")}</dt>
                <dd>{data.primary.karasBalance.toLocaleString(locale)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-sm text-slate-300">{t("noResurrection")}</p>
            <p className="mt-3 text-sm text-amber-200">
              {t("unavailable", {
                blocked: data.recovery.blockedCards,
                moved: data.recovery.cardsNoLongerOnPrimary
              })}
            </p>
          </div>
          <form
            action={applyDeletedSmurfRecoveryAction}
            className="min-w-0 space-y-3 rounded-xl border border-red-300/30 bg-slate-950/70 p-4"
          >
            <input
              type="hidden"
              name="primary_user_id"
              value={data.primary.userId}
            />
            <input
              type="hidden"
              name="preview_token"
              value={data.previewToken ?? ""}
            />
            {data.selectedTradeIds.map(id => (
              <input type="hidden" name="source" value={id} key={id} />
            ))}
            <label className="grid min-w-0 gap-1 text-sm font-semibold">
              {t("evidenceReference")}
              <textarea
                name="evidence_reference"
                className="yk-field-control min-h-20 min-w-0 resize-y"
                minLength={10}
                maxLength={2000}
                placeholder={t("evidencePlaceholder")}
              />
            </label>
            <label className="grid min-w-0 gap-1 text-sm font-semibold">
              {t("note")}
              <textarea
                name="note"
                className="yk-field-control min-h-24 min-w-0 resize-y"
                minLength={10}
                maxLength={2000}
                required
                placeholder={t("notePlaceholder")}
              />
            </label>
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                name="confirmation"
                type="checkbox"
                className="mt-1 size-5 shrink-0"
                value={data.primary.userId}
                required
              />
              <span className="min-w-0">{t("confirmation")}</span>
            </label>
            <SanctionQuarantineConflicts
              conflicts={data.recovery.quarantineConflicts}
            />
            {!data.eligible && (
              <p className="text-sm font-semibold text-amber-200">
                {t("ineligible")}
              </p>
            )}
            <button
              type="submit"
              disabled={!data.eligible}
              className="min-h-11 w-full rounded-xl border border-red-300/50 bg-red-500/20 px-4 py-2 font-black text-red-100 hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("apply")}
            </button>
          </form>
        </div>
      )}
      {data.receipts.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-bold">{t("receipts")}</h3>
          {data.receipts.map(receipt => (
            <details
              key={receipt.id}
              className="min-w-0 rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-sm [overflow-wrap:anywhere]"
            >
              <summary className="cursor-pointer font-semibold">
                {t("receiptSummary", {
                  date: formatter.format(new Date(receipt.appliedAt)),
                  cards: receipt.recovery.cards,
                  karas: receipt.recovery.karas
                })}
              </summary>
              <p className="mt-3 text-slate-300">{receipt.note}</p>
              <p className="mt-2 text-slate-400">{receipt.evidenceReference}</p>
              <p className="mt-2 font-mono text-xs text-slate-500">
                {receipt.id}
              </p>
              {receipt.history.trades.map(trade => (
                <div key={trade.id} className="mt-2 text-sm text-slate-200">
                  {[
                    ...(trade.incomingCardIds ?? []),
                    ...(trade.outgoingCardIds ?? [])
                  ].map((id, index) => (
                    <p key={`${id}-${index}`}>
                      {receipt.history.cardLabels?.[id]?.name ??
                        data.cardLabels?.[id]?.name ??
                        t("unknownCardName")}
                    </p>
                  ))}
                  <p className="font-mono text-xs text-slate-500">{trade.id}</p>
                </div>
              ))}
              {receipt.history.sales.map(sale => (
                <p key={sale.id} className="mt-1 text-xs text-slate-400">
                  {t("receiptSale", {
                    id: sale.id,
                    card:
                      receipt.history.cardLabels?.[sale.cardInstanceId]?.name ??
                      data.cardLabels?.[sale.cardInstanceId]?.name ??
                      t("unknownCardName"),
                    karas: sale.karas
                  })}
                </p>
              ))}
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
