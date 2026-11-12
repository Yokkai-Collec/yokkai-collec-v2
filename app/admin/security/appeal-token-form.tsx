"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { issueAppealTokenAction } from "./actions";

export function AppealTokenForm() {
  const t = useTranslations("sanctionAppeals");
  const [state, action, pending] = useActionState<
    { token?: string; failed?: boolean },
    FormData
  >(issueAppealTokenAction, {});
  return (
    <details className="mt-3 rounded-lg border border-slate-800 p-3">
      <summary className="cursor-pointer">{t("issueToken")}</summary>
      <form action={action} className="mt-2 grid gap-2">
        <label className="grid gap-1">
          {t("receiptId")}
          <input name="receipt" required className="yk-field-control w-full" />
        </label>
        <label className="grid gap-1">
          {t("identityNote")}
          <textarea
            name="identity"
            required
            minLength={20}
            maxLength={500}
            className="yk-field-control w-full"
          />
        </label>
        <button disabled={pending} className="yk-button min-h-11">
          {t("issueToken")}
        </button>
      </form>
      {state.failed && (
        <p role="alert" className="mt-2 text-sm">
          {t("result.failed")}
        </p>
      )}
      {state.token && (
        <p role="status" className="mt-2 break-all text-sm">
          <strong>{t("token")}</strong> {state.token}
        </p>
      )}
    </details>
  );
}
