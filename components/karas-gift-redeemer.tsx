"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Karas, Modal } from "@/components/ui";
import { invalidatePlayerSnapshots } from "@/lib/data/cards";
import { createClient } from "@/utils/supabase/client";

type Receipt = { amount: number; message: string; alreadyRedeemed: boolean };
type RedeemError =
  "codeUnavailable" | "balanceLimit" | "maintenance" | "redeemFailed";

export function KarasGiftRedeemer() {
  const t = useTranslations("giftCodes");
  const router = useRouter();
  const [code, setCode] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, submit, pending] = useActionState<RedeemError | null, FormData>(
    async (_, form) => {
      try {
        const { data, error } = await createClient().rpc(
          "redeem_karas_gift_code",
          {
            p_code: String(form.get("code") ?? "")
          }
        );
        switch (error?.message) {
          case "GIFT_CODE_UNAVAILABLE":
            return "codeUnavailable";
          case "GIFT_CODE_BALANCE_LIMIT":
            return "balanceLimit";
          case "ECONOMIC_MAINTENANCE":
            return "maintenance";
        }
        if (error || !data) return "redeemFailed";
        setReceipt(data as Receipt);
        setCode("");
        invalidatePlayerSnapshots(["balance"]);
        router.refresh();
        return null;
      } catch {
        return "redeemFailed";
      }
    },
    null
  );

  return (
    <section
      id="gift-code"
      className="mt-6 space-y-4 rounded-panel border border-veil bg-surface p-4 sm:p-6"
    >
      <h2 className="font-display text-xl">{t("redeemTitle")}</h2>
      <form action={submit} className="max-w-xl space-y-2">
        <label htmlFor="karas-gift-code" className="yk-field-label">
          {t("code")}
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="karas-gift-code"
            className="yk-field-control min-w-0 flex-1"
            name="code"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            required
            value={code}
            disabled={pending}
            onChange={event => setCode(event.target.value)}
          />
          <Button type="submit" disabled={pending}>
            {t(pending ? "redeeming" : "redeem")}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {t(error)}
          </p>
        )}
      </form>
      <Modal
        open={receipt !== null}
        title={t(receipt?.alreadyRedeemed ? "alreadyRedeemed" : "received")}
        onClose={() => setReceipt(null)}
        className="max-w-md"
      >
        {receipt && (
          <div className="space-y-5 text-center">
            <Karas amount={receipt.amount} />
            <p className="whitespace-pre-wrap wrap-anywhere text-ink-2">
              {receipt.message}
            </p>
          </div>
        )}
      </Modal>
    </section>
  );
}
