"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";
import {
  blackoutPreviewShop,
  buyBlackoutPreviewPack,
  getBlackoutPreviewWallet,
  getInitialBlackoutPreviewWallet,
  subscribeBlackoutPreviewWallet,
  type BlackoutPreviewWallet
} from "@/lib/data/blackout-preview";

function usePreviewWallet() {
  const state = useSyncExternalStore(
    subscribeBlackoutPreviewWallet,
    getBlackoutPreviewWallet,
    getInitialBlackoutPreviewWallet
  );
  return JSON.parse(state) as BlackoutPreviewWallet;
}

export function BlackoutPreviewShop() {
  const t = useTranslations("blackout");
  const { boughtToday, reserve, balance } = usePreviewWallet();
  const { price, dailyLimit } = blackoutPreviewShop;
  const atLimit = boughtToday >= dailyLimit;
  const insufficient = balance < price;

  return (
    <div className="yk-blackout-shop">
      <Button
        className="w-full sm:w-fit"
        disabled={atLimit || insufficient}
        onClick={buyBlackoutPreviewPack}
      >
        {t("buyPack", { price })}
      </Button>
      <div className="yk-blackout-shop-status" role="status">
        <p>
          {t("previewBalance", { balance })} ·{" "}
          {t("dailyPurchases", { boughtToday, dailyLimit })}
        </p>
        <p>{t("purchasedReserve", { reserve })}</p>
        {atLimit && <p>{t("dailyLimitReached")}</p>}
        {!atLimit && insufficient && <p>{t("notEnoughKaras")}</p>}
      </div>
    </div>
  );
}

export function BlackoutPreviewReserve() {
  const t = useTranslations("blackout");
  const { reserve } = usePreviewWallet();
  return reserve > 0 ? (
    <p className="mt-2 text-sm text-ink-2">
      {t("purchasedReserve", { reserve })}
    </p>
  ) : null;
}
