"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";
import { createClient } from "@/utils/supabase/client";

type CreateState = {
  code?: string;
  shareable?: boolean;
  error?: "detailsInvalid" | "createFailed";
};

export function GiftCodeCreator() {
  const t = useTranslations("giftCodes");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [shareable, setShareable] = useState(false);
  const [copyState, setCopyState] = useState<"copied" | "copyFailed">();
  const [state, submit, pending] = useActionState<CreateState, FormData>(
    async (previous, form) => {
      setCopyState(undefined);
      const sharedCode = form.get("usage") === "shareable";
      try {
        const { data, error } = await createClient().rpc(
          "admin_create_karas_gift_code",
          {
            p_amount: Number(form.get("amount")),
            p_message: String(form.get("message") ?? ""),
            p_shareable: sharedCode
          }
        );
        if (error?.message === "GIFT_CODE_DETAILS_INVALID")
          return { ...previous, error: "detailsInvalid" };
        if (error || typeof data !== "string")
          return { ...previous, error: "createFailed" };
        setAmount("");
        setMessage("");
        setShareable(false);
        return { code: data, shareable: sharedCode };
      } catch {
        return { ...previous, error: "createFailed" };
      }
    },
    {}
  );

  async function copyCode() {
    if (!state.code) return;
    try {
      await navigator.clipboard.writeText(state.code);
      setCopyState("copied");
    } catch {
      setCopyState("copyFailed");
    }
  }

  return (
    <section className="max-w-2xl space-y-5 rounded-panel border border-veil bg-surface p-4 sm:p-6">
      <form action={submit} className="space-y-4">
        <fieldset disabled={pending}>
          <legend className="yk-field-label">{t("usage")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-panel border border-veil p-3 has-checked:border-accent-gold">
              <input
                type="radio"
                name="usage"
                value="single"
                checked={!shareable}
                onChange={() => setShareable(false)}
                className="mt-1 shrink-0"
              />
              <span className="min-w-0">
                <strong className="block text-sm">{t("singleMode")}</strong>
                <span className="block text-sm text-ink-2">
                  {t("singleUse")}
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-panel border border-veil p-3 has-checked:border-accent-gold">
              <input
                type="radio"
                name="usage"
                value="shareable"
                checked={shareable}
                onChange={() => setShareable(true)}
                className="mt-1 shrink-0"
              />
              <span className="min-w-0">
                <strong className="block text-sm">{t("sharedMode")}</strong>
                <span className="block text-sm text-ink-2">
                  {t("sharedUse")}
                </span>
              </span>
            </label>
          </div>
        </fieldset>
        <div>
          <label className="yk-field-label" htmlFor="gift-amount">
            {t("amount")}
          </label>
          <input
            id="gift-amount"
            className="yk-field-control"
            name="amount"
            type="number"
            min={1}
            max={2147483647}
            step={1}
            required
            value={amount}
            disabled={pending}
            onChange={event => setAmount(event.target.value)}
          />
        </div>
        <div>
          <label className="yk-field-label" htmlFor="gift-message">
            {t("message")}
          </label>
          <textarea
            id="gift-message"
            className="yk-field-control resize-y"
            name="message"
            rows={4}
            maxLength={500}
            required
            value={message}
            disabled={pending}
            onChange={event => setMessage(event.target.value)}
          />
        </div>
        {state.error && (
          <p role="alert" className="text-sm text-danger">
            {t(state.error)}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {t(pending ? "creating" : "create")}
        </Button>
      </form>
      {state.code && (
        <div className="space-y-3 rounded-panel border border-veil p-3 sm:p-4">
          <p role="status" className="text-sm text-ink-2">
            {t(state.shareable ? "sharedUse" : "singleUse")} {t("keepCode")}
          </p>
          <label htmlFor="generated-gift-code" className="yk-field-label">
            {t("code")}
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="generated-gift-code"
              className="yk-field-control min-w-0 flex-1 font-mono"
              readOnly
              value={state.code}
              onFocus={event => event.currentTarget.select()}
            />
            <Button onClick={() => void copyCode()}>{t("copyCode")}</Button>
          </div>
          {copyState && (
            <p role="status" className="text-sm text-ink-2">
              {t(copyState)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
