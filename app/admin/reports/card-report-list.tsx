"use client";

import { formatLicenseName } from "@/lib/ui/license-name";
import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { setCardReportStatusAction, type ReportActionState } from "./actions";

export type AdminCardReport = {
  id: string;
  reporterId: string;
  reporterPseudo: string;
  reporterEmail: string;
  cardId: string;
  cardName: string;
  franchise: string;
  imageUrl: string;
  rarity: string;
  reason: "image_issue" | "wrong_license" | "duplicate_card";
  status: "pending" | "reviewed" | "dismissed";
  createdAt: string;
};
const reasonLabels: Record<AdminCardReport["reason"], string> = {
  image_issue: "Image issue",
  wrong_license: "Wrong license",
  duplicate_card: "Duplicate card"
};
const statusLabels = {
  pending: "Pending",
  reviewed: "Reviewed",
  dismissed: "Dismissed"
} as const;
const initialState: ReportActionState = { ok: false, message: "" };

function Actions({ report }: { report: AdminCardReport }) {
  const [state, action, pending] = useActionState(
    setCardReportStatusAction,
    initialState
  );
  return (
    <div>
      <form action={action} className="flex flex-wrap gap-2">
        <input name="report_id" type="hidden" value={report.id} />
        {report.status !== "reviewed" && (
          <button
            className="yk-button"
            disabled={pending}
            name="status"
            value="reviewed"
          >
            Mark as reviewed
          </button>
        )}
        {report.status !== "dismissed" && (
          <button
            className="yk-button yk-button-secondary"
            disabled={pending}
            name="status"
            value="dismissed"
          >
            Dismiss
          </button>
        )}
        {report.status !== "pending" && (
          <button
            className="yk-button yk-button-secondary"
            disabled={pending}
            name="status"
            value="pending"
          >
            Move back to pending
          </button>
        )}
      </form>
      {state.message && (
        <p
          className={`mt-2 text-xs ${state.ok ? "text-emerald-300" : "text-red-300"}`}
          role="status"
        >
          {state.message}
        </p>
      )}
    </div>
  );
}

export function CardReportList({
  reports,
  playerHrefBase
}: {
  reports: AdminCardReport[];
  playerHrefBase: string;
}) {
  const t = useTranslations("adminReportedCard");
  if (!reports.length)
    return (
      <p className="rounded-2xl border border-white/10 bg-slate-900/70 p-8 text-center text-slate-400">
        No reported cards.
      </p>
    );
  return (
    <section className="space-y-4">
      {reports.map(report => (
        <article
          className="rounded-2xl border border-red-300/15 bg-slate-900/70 p-5"
          key={report.id}
        >
          <div className="grid gap-5 sm:grid-cols-[6rem_minmax(0,1fr)]">
            <div
              aria-label={`Artwork for ${report.cardName}`}
              className="aspect-[5/7] w-24 rounded-lg bg-slate-950 bg-cover bg-center"
              role="img"
              style={
                report.imageUrl
                  ? {
                      backgroundImage: `url(${JSON.stringify(report.imageUrl).slice(1, -1)})`
                    }
                  : undefined
              }
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2.5 py-1 text-xs font-bold text-amber-200">
                  {statusLabels[report.status]}
                </span>
                <span className="rounded-full border border-red-300/30 bg-red-400/10 px-2.5 py-1 text-xs font-bold text-red-200">
                  {reasonLabels[report.reason]}
                </span>
              </div>
              <h3 className="mt-3 truncate text-lg font-black">
                {report.cardName}
              </h3>
              <p className="text-sm text-slate-400">
                {formatLicenseName(report.franchise) || "No license provided"}
                {report.rarity ? ` · ${report.rarity}` : ""}
              </p>
              <p className="mt-3 text-sm text-slate-400">
                Reported by{" "}
                <strong className="text-white">{report.reporterPseudo}</strong>{" "}
                · {report.reporterEmail}
              </p>
              {report.reporterId && (
                <Link
                  className="mt-2 inline-block text-sm font-semibold text-cyan-300"
                  href={`${playerHrefBase}${report.reporterId}`}
                >
                  Open player details →
                </Link>
              )}
              <div className="mt-4">
                {report.cardId && (
                  <Link
                    className="yk-button mb-3 inline-flex min-h-11 max-w-full whitespace-normal text-center"
                    href={`/admin/cards/${encodeURIComponent(report.cardId)}`}
                    aria-label={t("manageNamed", { name: report.cardName })}
                  >
                    {t("manage")}
                  </Link>
                )}
                <Actions report={report} />
              </div>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
