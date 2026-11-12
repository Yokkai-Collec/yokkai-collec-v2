import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { applyDeletedAccountSanctionAction } from "./actions";
import { AccountStatus, type AccountState } from "./event-detail";
import {
  SanctionQuarantineConflicts,
  type SanctionQuarantineConflict
} from "./sanction-quarantine-conflicts";

export type DeletedAccountHistoryData = {
  accounts: {
    userId: string;
    pseudo: string | null;
    email: string | null;
    deletedAt: string;
    identityExpiresAt: string;
    identitySource: string;
    transfers: number;
    availableTransfers: number;
    accountState?: AccountState;
  }[];
  total: number;
  deletedTotal: number;
  pageSize: number;
};
type Transfer = {
  kind: string;
  asset_id: string;
  from_user_id: string;
  to_user_id: string;
  offered_karas: number;
  requested_karas: number;
  offered_names: (string | null)[];
  requested_names: (string | null)[];
  occurred_at: string;
};
export type DeletedAccountPreview = {
  primary: { userId: string; pseudo: string; karasBalance: number };
  selectedAccountIds: string[];
  eligible: boolean;
  selectionValid: boolean;
  previewToken: string;
  accounts: { userId: string; pseudo: string | null; email: string | null }[];
  recovery: {
    cards: number;
    cardIds: string[];
    transferKaras: number;
    saleKaras: number;
    karas: number;
    lockedCards: number;
    unavailableCards: number;
    transfers: number;
    quarantineConflicts?: SanctionQuarantineConflict[];
  };
  history: {
    transfers: Transfer[];
    cardLabels: Record<string, { name: string | null }>;
    sales: { id: string; cardInstanceId: string; karas: number }[];
  };
};

export async function DeletedAccountHistory({
  primaryId,
  data = { accounts: [], total: 0, deletedTotal: 0, pageSize: 30 },
  preview,
  selected,
  query,
  relatedOnly,
  page,
  applied,
  showPicker = true
}: {
  primaryId: string;
  data?: DeletedAccountHistoryData;
  preview: DeletedAccountPreview | null;
  selected: string[];
  query: string;
  relatedOnly: boolean;
  page: number;
  applied: boolean;
  showPicker?: boolean;
}) {
  const t = await getTranslations("adminSecurity.deletedAccounts");
  const locale = await getLocale();
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short"
  });
  const params = new URLSearchParams({
    sanction: primaryId,
    mode: "deleted",
    ...(query ? { deleted_q: query } : {}),
    ...(!relatedOnly ? { deleted_all: "1" } : {})
  });
  selected.forEach(id => params.append("source_account", id));
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <section
      className="min-w-0 space-y-4 [overflow-wrap:anywhere]"
      aria-labelledby={showPicker ? "deleted-accounts-title" : undefined}
      aria-label={showPicker ? undefined : t("title")}
    >
      {!showPicker && applied && (
        <p
          role="status"
          className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 p-3 text-sm text-emerald-100"
        >
          {t("applied")}
        </p>
      )}
      {showPicker && (
        <>
          <div>
            <h3 id="deleted-accounts-title" className="text-xl font-black">
              {t("title")}
            </h3>
            <p className="mt-2 text-sm text-slate-300">
              {t("help", { days: 90 })}
            </p>
          </div>
          {applied && (
            <p
              role="status"
              className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 p-3 text-sm text-emerald-100"
            >
              {t("applied")}
            </p>
          )}
          <form
            method="get"
            className="grid min-w-0 gap-3 rounded-xl border border-slate-700 bg-slate-950/60 p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <input type="hidden" name="sanction" value={primaryId} />
            <input type="hidden" name="mode" value="deleted" />
            {selected.map(id => (
              <input key={id} type="hidden" name="source_account" value={id} />
            ))}
            <label className="grid min-w-0 gap-1 text-sm font-semibold">
              {t("searchLabel")}
              <input
                className="yk-field-control min-w-0"
                name="deleted_q"
                maxLength={100}
                defaultValue={query}
                placeholder={t("searchPlaceholder")}
              />
            </label>
            <button
              type="submit"
              className="yk-button self-end whitespace-normal"
            >
              {t("search")}
            </button>
            <label className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2">
              <input
                type="checkbox"
                name="deleted_all"
                value="1"
                defaultChecked={!relatedOnly}
                className="size-5 shrink-0"
              />
              {t("showAll")}
            </label>
          </form>
          <p className="text-sm text-slate-400">
            {t("count", { count: data.total, total: data.deletedTotal })}
          </p>
          <form method="get" className="space-y-3">
            <input type="hidden" name="sanction" value={primaryId} />
            <input type="hidden" name="mode" value="deleted" />
            <input type="hidden" name="deleted_q" value={query} />
            {!relatedOnly && (
              <input type="hidden" name="deleted_all" value="1" />
            )}
            <input type="hidden" name="deleted_page" value={page} />
            {selected
              .filter(id => !data.accounts.some(a => a.userId === id))
              .map(id => (
                <input
                  key={id}
                  type="hidden"
                  name="source_account"
                  value={id}
                />
              ))}
            <div className="max-h-[34rem] space-y-3 overflow-y-auto">
              {!data.accounts.length && (
                <p className="rounded-xl border border-slate-700 p-4 text-sm text-slate-300">
                  {t("empty")}
                </p>
              )}
              {data.accounts.map(account => (
                <label
                  key={account.userId}
                  className="flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border border-slate-700 bg-slate-950/60 p-3"
                >
                  <input
                    type="checkbox"
                    name="source_account"
                    value={account.userId}
                    defaultChecked={selected.includes(account.userId)}
                    disabled={account.availableTransfers === 0}
                    className="mt-1 size-5 shrink-0"
                  />
                  <span className="min-w-0 text-sm">
                    <span className="block font-bold text-slate-100">
                      {account.pseudo ?? t("unknownIdentity")}
                    </span>
                    <AccountStatus state={account.accountState} />
                    <span className="mt-1 block text-slate-300">
                      {account.email ?? t("unknownEmail")}
                    </span>
                    <span className="mt-1 block text-xs text-slate-400">
                      {t("deletedAt", {
                        date: date.format(new Date(account.deletedAt))
                      })}
                    </span>
                    {account.pseudo || account.email ? (
                      <span className="mt-1 block text-xs text-slate-500">
                        {t("expiresAt", {
                          date: date.format(new Date(account.identityExpiresAt))
                        })}
                      </span>
                    ) : (
                      <span className="mt-1 block text-xs text-slate-500">
                        {t("identityUnavailable")}
                      </span>
                    )}
                    <span className="mt-2 block text-xs text-cyan-100">
                      {t("transferCount", {
                        count: account.transfers,
                        available: account.availableTransfers
                      })}
                    </span>
                    {!account.transfers && (
                      <span className="mt-1 block text-xs text-amber-100">
                        {t("noLink")}
                      </span>
                    )}
                    {account.transfers > 0 &&
                      account.availableTransfers === 0 && (
                        <span className="mt-2 block text-xs text-red-200">
                          {t("alreadyProcessed")}
                        </span>
                      )}
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              {t("selectionLimit", { count: selected.length })}
            </p>
            {selected.length > 20 && (
              <p role="alert" className="text-sm text-amber-100">
                {t("selectionError")}
              </p>
            )}
            <button
              type="submit"
              className="yk-button min-h-11 w-full whitespace-normal sm:w-auto"
            >
              {t("preview")}
            </button>
          </form>
          {pages > 1 && (
            <nav
              aria-label={t("pagination")}
              className="flex flex-wrap items-center justify-between gap-3 text-sm"
            >
              {page > 1 ? (
                <Link
                  className="yk-button yk-button-secondary"
                  href={`/admin/security?${new URLSearchParams([...params, ["deleted_page", String(page - 1)]])}`}
                >
                  {t("previous")}
                </Link>
              ) : (
                <span />
              )}
              <span>{t("page", { page, pages })}</span>
              {page < pages && (
                <Link
                  className="yk-button yk-button-secondary"
                  href={`/admin/security?${new URLSearchParams([...params, ["deleted_page", String(page + 1)]])}`}
                >
                  {t("next")}
                </Link>
              )}
            </nav>
          )}
        </>
      )}
      {preview && (
        <div
          id={showPicker ? undefined : "sanction-preview"}
          className="grid min-w-0 scroll-mt-28 gap-4 lg:grid-cols-2"
        >
          <section className="min-w-0 space-y-3 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
            <h4 className="font-bold">
              {t("consequences", { player: preview.primary.pseudo })}
            </h4>
            <ul className="space-y-2 text-sm text-slate-300">
              {preview.accounts.map(account => (
                <li key={account.userId}>
                  <span className="block font-bold">
                    {account.pseudo ?? t("unknownIdentity")}
                  </span>
                  <span className="block text-xs text-slate-400">
                    {account.email ?? t("unknownEmail")}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-sm font-bold text-cyan-100">
              {t("totals", {
                accounts: selected.length,
                cards: preview.recovery.cards,
                karas: preview.recovery.karas
              })}
            </p>
            <p className="text-sm text-slate-300">
              {t("breakdown", {
                transfers: preview.recovery.transferKaras,
                sales: preview.recovery.saleKaras,
                balance: preview.primary.karasBalance
              })}
            </p>
            <p className="text-xs text-amber-100">
              {t("assetWarning", {
                locked: preview.recovery.lockedCards,
                missing: preview.recovery.unavailableCards
              })}
            </p>
            <details className="rounded-lg border border-slate-700 p-3">
              <summary className="min-h-11 cursor-pointer text-sm font-bold">
                {t("history", { count: preview.history.transfers.length })}
              </summary>
              <div className="max-h-96 space-y-3 overflow-y-auto">
                {preview.history.transfers.map(transfer => (
                  <article
                    key={`${transfer.kind}-${transfer.asset_id}`}
                    className="rounded-lg bg-slate-900 p-3 text-sm"
                  >
                    <h5 className="font-bold">
                      {t(transfer.kind === "auction" ? "auction" : "trade")} ·{" "}
                      {date.format(new Date(transfer.occurred_at))}
                    </h5>
                    <p className="mt-2 text-cyan-100">
                      {t("incoming", {
                        karas:
                          transfer.to_user_id === primaryId
                            ? transfer.offered_karas
                            : transfer.requested_karas
                      })}
                    </p>
                    {(transfer.to_user_id === primaryId
                      ? transfer.offered_names
                      : transfer.requested_names
                    ).map((name, index) => (
                      <p key={`in-${index}`}>{name ?? t("unknownCard")}</p>
                    ))}
                    <p className="mt-2 text-slate-400">
                      {t("outgoing", {
                        karas:
                          transfer.to_user_id === primaryId
                            ? transfer.requested_karas
                            : transfer.offered_karas
                      })}
                    </p>
                    {(transfer.to_user_id === primaryId
                      ? transfer.requested_names
                      : transfer.offered_names
                    ).map((name, index) => (
                      <p key={`out-${index}`} className="text-slate-400">
                        {name ?? t("unknownCard")}
                      </p>
                    ))}
                  </article>
                ))}
              </div>
            </details>
          </section>
          <form
            action={applyDeletedAccountSanctionAction}
            className="min-w-0 space-y-3 rounded-xl border border-red-300/30 bg-slate-950/70 p-4"
          >
            <input type="hidden" name="primary_user_id" value={primaryId} />
            <input
              type="hidden"
              name="preview_token"
              value={preview.previewToken}
            />
            {selected.map(id => (
              <input key={id} type="hidden" name="source_account" value={id} />
            ))}
            <label className="grid min-w-0 gap-1 text-sm font-semibold">
              {t("note")}
              <textarea
                className="yk-field-control min-h-24 min-w-0 resize-y"
                name="note"
                minLength={10}
                maxLength={2000}
                required
              />
            </label>
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="confirmation"
                value={primaryId}
                required
                className="mt-1 size-5 shrink-0"
              />
              <span className="min-w-0">
                {t("confirmation", { player: preview.primary.pseudo })}
              </span>
            </label>
            <SanctionQuarantineConflicts
              conflicts={preview.recovery.quarantineConflicts}
            />
            {!preview.eligible && (
              <p className="text-sm text-amber-100">{t("blocked")}</p>
            )}
            <button
              type="submit"
              disabled={!preview.eligible}
              className="min-h-11 w-full rounded-xl border border-red-300/50 bg-red-500/20 px-4 py-3 text-sm font-bold text-red-100 hover:bg-red-500/30 disabled:opacity-40"
            >
              {t("apply")}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
