import { cookies } from "next/headers";
import { getFormatter, getTranslations } from "next-intl/server";
import { createClient } from "@/utils/supabase/server";
import { submitSanctionAppealAction } from "./actions";

type Receipt = {
  id: string;
  kind: "ACCOUNT" | "SMURF";
  appliedAt: string;
  state: "APPLIED" | "ROLLED_BACK";
  appealStatus: "PENDING" | "UPHELD" | "CORRECTION_REQUIRED" | null;
  decisionReason: string | null;
};

export async function SanctionHistory({ result }: { result?: string }) {
  const client = createClient(await cookies());
  const { data, error } = await client.rpc("get_my_anticheat_sanction_history");
  const receipts = (data ?? []) as Receipt[];
  if (error || (receipts.length === 0 && !result)) return null;
  const [t, format] = await Promise.all([
    getTranslations("sanctionAppeals"),
    getFormatter()
  ]);
  return (
    <section id="sanction-history" className="yk-panel mt-6 p-4 sm:p-6">
      <h2 className="text-lg font-semibold">{t("history")}</h2>
      {["invalid", "failed", "saved"].includes(result ?? "") && (
        <p className="mt-2 text-sm" role="status">
          {t(`result.${result}`)}
        </p>
      )}
      <div className="mt-3 grid gap-3">
        {receipts.map(receipt => (
          <article
            className="min-w-0 rounded-lg border border-slate-800 p-3"
            key={receipt.id}
          >
            <p className="font-semibold">{t(`kind.${receipt.kind}`)}</p>
            <p className="text-sm">
              {format.dateTime(new Date(receipt.appliedAt), {
                dateStyle: "medium"
              })}{" "}
              · {t(`state.${receipt.state}`)}
            </p>
            {receipt.appealStatus && (
              <p className="text-sm">{t(`status.${receipt.appealStatus}`)}</p>
            )}
            {receipt.decisionReason && (
              <p className="break-words text-sm">{receipt.decisionReason}</p>
            )}
            {!receipt.appealStatus && receipt.state === "APPLIED" && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-cyan-200">
                  {t("submit")}
                </summary>
                <form
                  action={submitSanctionAppealAction}
                  className="mt-2 grid gap-2"
                >
                  <input type="hidden" name="kind" value={receipt.kind} />
                  <input type="hidden" name="receipt" value={receipt.id} />
                  <textarea
                    name="reason"
                    className="yk-field-control w-full"
                    required
                    minLength={10}
                    maxLength={1000}
                    aria-label={t("reason")}
                    placeholder={t("reason")}
                  />
                  <button className="yk-button min-h-11">{t("submit")}</button>
                </form>
              </details>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
