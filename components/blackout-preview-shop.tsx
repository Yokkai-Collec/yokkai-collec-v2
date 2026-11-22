"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Button, Karas } from "@/components/ui";
import {
  BLACKOUT_SLUG,
  blackoutPreviewShop,
  buyBlackoutPreviewPacks,
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
  const format = useFormatter();
  const { boughtToday, reserve, balance } = usePreviewWallet();
  const { price, dailyLimit } = blackoutPreviewShop;
  const [selection, setSelection] = useState(1);
  const maxQuantity = Math.max(
    0,
    Math.min(dailyLimit - boughtToday, Math.floor(balance / price))
  );
  const quantity = Math.min(selection, maxQuantity);
  const action =
    boughtToday >= dailyLimit
      ? t("dailyLimitReached")
      : quantity === 0
        ? t("notEnoughKaras")
        : t("buyPacks", { quantity, total: quantity * price });

  return (
    <div className="yk-blackout-shop">
      <div className="yk-blackout-price">
        <Karas amount={price} /> <span>{t("perPack")}</span>
      </div>
      <dl className="yk-blackout-shop-status" aria-live="polite">
        <div>
          <dt>{t("previewBalance")}</dt>
          <dd>
            <Karas amount={balance} />
          </dd>
        </div>
        <div>
          <dt>{t("dailyPurchases")}</dt>
          <dd>
            {format.number(boughtToday)} / {format.number(dailyLimit)}
          </dd>
        </div>
        <div>
          <dt>{t("inReserve")}</dt>
          <dd>{format.number(reserve)}</dd>
        </div>
      </dl>
      <div className="yk-blackout-purchase-row">
        <div
          className="yk-blackout-quantity"
          role="group"
          aria-label={t("quantity")}
        >
          <button
            type="button"
            aria-label={t("decreaseQuantity")}
            disabled={quantity <= 1}
            onClick={() => setSelection(quantity - 1)}
          >
            −
          </button>
          <output aria-label={t("quantity")}>{format.number(quantity)}</output>
          <button
            type="button"
            aria-label={t("increaseQuantity")}
            disabled={quantity >= maxQuantity}
            onClick={() => setSelection(quantity + 1)}
          >
            +
          </button>
        </div>
        <Button
          className="yk-blackout-buy"
          disabled={quantity === 0}
          onClick={() => {
            buyBlackoutPreviewPacks(quantity);
            setSelection(1);
          }}
        >
          {action}
        </Button>
      </div>
      <Link
        className="yk-blackout-open-link"
        href={`/boosters#${BLACKOUT_SLUG}`}
      >
        {t("openMyPacks")} <span aria-hidden="true">↗</span>
      </Link>
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
