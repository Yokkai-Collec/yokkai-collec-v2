import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/utils/supabase/server";
import { reviewSanctionAppealAction } from "./actions";

type Appeal = {
  id: string;
  userId: string;
  receiptId: string;
  receiptKind: "ACCOUNT" | "SMURF";
  reason: string;
  outcome: "UPHELD" | "CORRECTION_REQUIRED" | null;
  decisionReason: string | null;
  canVoidWarning?: boolean;
  warningVoided?: boolean;
};

export async function SanctionAppeals({ result }: { result?: string }) {
  const client = createClient(await cookies());
  const [{ data, error }, t] = await Promise.all([
    client.rpc("admin_list_anticheat_appeals"),
    getTranslations("sanctionAppeals")
  ]);
  if (error) throw new Error(error.message);
  const appeals = (data ?? []) as Appeal[];
  return (
    <section
      id="anticheat-appeals"
      className="rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-4 sm:p-5"
    >
      <h2 className="text-xl font-bold text-slate-100">{t("inbox")}</h2>
      {["invalid", "failed", "saved"].includes(result ?? "") && (
        <p role="status" className="mt-2 text-sm">
          {t(`result.${result}`)}
        </p>
      )}
      {appeals.length === 0 && (
        <p className="mt-3 text-sm text-slate-400">{t("empty")}</p>
      )}
      <div className="mt-3 grid gap-3">
        {appeals.map(appeal => (
          <article
            className="min-w-0 rounded-lg border border-slate-800 p-3 text-sm"
            key={appeal.id}
          >
            <p className="font-semibold">
              {t(`status.${appeal.outcome ?? "PENDING"}`)}
            </p>
            <p className="break-all text-slate-400">
              {t(`kind.${appeal.receiptKind}`)} · {appeal.receiptId} ·{" "}
              {appeal.userId}
            </p>
            <p className="mt-2 break-words whitespace-pre-wrap">
              {appeal.reason}
            </p>
            {appeal.decisionReason && (
              <p className="mt-2 break-words text-cyan-100">
                {appeal.decisionReason}
              </p>
            )}
            {appeal.warningVoided && (
              <p className="mt-2 text-cyan-100">{t("warningVoided")}</p>
            )}
            {(!appeal.outcome || appeal.canVoidWarning) && (
              <form
                action={reviewSanctionAppealAction}
                className="mt-3 grid gap-2"
              >
                <input type="hidden" name="appeal_id" value={appeal.id} />
                <textarea
                  className="yk-field-control w-full"
                  name="reason"
                  required
                  minLength={10}
                  maxLength={1000}
                  aria-label={t("decisionReason")}
                  placeholder={t("decisionReason")}
                />
                <div className="flex flex-wrap gap-2">
                  {appeal.canVoidWarning ? (
                    <button
                      name="outcome"
                      value="VOID_WARNING"
                      className="yk-button min-h-11"
                    >
                      {t("voidWarning")}
                    </button>
                  ) : (
                    <>
                      <button
                        name="outcome"
                        value="UPHELD"
                        className="yk-button min-h-11"
                      >
                        {t("uphold")}
                      </button>
                      <button
                        name="outcome"
                        value="CORRECTION_REQUIRED"
                        className="yk-button min-h-11"
                      >
                        {t("requestCorrection")}
                      </button>
                    </>
                  )}
                </div>
              </form>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
