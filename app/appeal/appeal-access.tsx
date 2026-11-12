"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { anticheatSanctionLabel } from "@/lib/anticheat-sanction-labels";
import { useAppealTokenAction } from "./actions";

export function AppealAccess() {
  const t = useTranslations("sanctionAppeals");
  const sanctions = useTranslations("accountSanctions");
  const [state, action, pending] = useActionState(useAppealTokenAction, {});
  const sanctionKind = anticheatSanctionLabel(state.type);
  return (
    <section className="yk-panel p-4 sm:p-6">
      <h1 className="text-xl font-bold">{t("tokenAccess")}</h1>
      <p className="mt-2 text-sm">{t("tokenHelp")}</p>
      <form action={action} className="mt-4 grid gap-3">
        <label className="grid gap-1">
          {t("token")}
          <input
            name="token"
            type="password"
            className="yk-field-control w-full"
            required
            minLength={64}
            maxLength={64}
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1">
          {t("tokenReason")}
          <textarea
            name="reason"
            className="yk-field-control w-full"
            maxLength={1000}
          />
        </label>
        <button disabled={pending} className="yk-button min-h-11">
          {t("tokenContinue")}
        </button>
      </form>
      {state.failed && (
        <p className="mt-3 text-sm" role="alert">
          {t("tokenInvalid")}
        </p>
      )}
      {state.state && (
        <div className="mt-3 grid gap-1 text-sm" role="status">
          <p>
            {sanctionKind
              ? sanctions(`${sanctionKind}.title`)
              : t("kind.ACCOUNT")}{" "}
            · {t(`state.${state.state}`)}
          </p>
          {sanctionKind && <p>{sanctions(`${sanctionKind}.intro`)}</p>}
          {state.status && <p>{t(`status.${state.status}`)}</p>}
          {state.decisionReason && (
            <p className="break-words">{state.decisionReason}</p>
          )}
        </div>
      )}
    </section>
  );
}
