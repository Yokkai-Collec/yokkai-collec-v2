"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Button, Karas } from "@/components/ui";
import { BLACKOUT_SLUG } from "@/lib/data/blackout-preview";
import {
  requestBlackoutWallet,
  type BlackoutPreviewWallet
} from "@/lib/data/blackout-preview-wallet";
import { invalidatePlayerSnapshots } from "@/lib/data/cards";
import { subscribePlayerSnapshotInvalidation } from "@/lib/data/player-state";

function useBlackoutWallet() {
  const [wallet, setWallet] = useState<BlackoutPreviewWallet>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let request: AbortController | undefined;
    const refresh = async () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      try {
        const current = await requestBlackoutWallet(
          undefined,
          controller.signal
        );
        if (!controller.signal.aborted) {
          setWallet(current);
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    };
    void refresh();
    const unsubscribe = subscribePlayerSnapshotInvalidation(scopes => {
      if (scopes.includes("balance")) void refresh();
    });
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      request?.abort();
      unsubscribe();
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, []);

  return { wallet, setWallet, failed };
}

export function BlackoutPreviewShop() {
  const t = useTranslations("blackout");
  const format = useFormatter();
  const { wallet, setWallet, failed } = useBlackoutWallet();
  const [purchasing, setPurchasing] = useState(false);
  const purchaseInProgress = useRef(false);
  const [purchaseError, setPurchaseError] = useState<
    "notEnoughKaras" | "dailyLimitReached" | "purchaseUnavailable"
  >();
  const [selection, setSelection] = useState(1);
  if (!wallet)
    return (
      <p className="mt-3 text-sm text-ink-2" role="status">
        {t(failed ? "walletUnavailable" : "walletLoading")}
      </p>
    );
  const {
    boughtToday,
    reserve,
    balance,
    price,
    dailyLimit,
    purchasesOpen = true
  } = wallet;
  const maxQuantity = purchasesOpen
    ? Math.max(
        0,
        Math.min(dailyLimit - boughtToday, Math.floor(balance / price))
      )
    : 0;
  const quantity = Math.min(selection, maxQuantity);
  const action = !purchasesOpen
    ? t("shopClosed")
    : purchasing
      ? t("purchasing")
      : boughtToday >= dailyLimit
        ? t("dailyLimitReached")
        : quantity === 0
          ? t("notEnoughKaras")
          : t("buyPacks", { quantity, total: quantity * price });
  const errorMessage = failed ? "walletUnavailable" : purchaseError;

  async function buyPacks() {
    if (quantity === 0 || failed || purchaseInProgress.current) return;
    purchaseInProgress.current = true;
    setPurchasing(true);
    setPurchaseError(undefined);
    try {
      setWallet(await requestBlackoutWallet({ action: "buy", quantity }));
      setSelection(1);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setPurchaseError(
        code === "notEnoughKaras" || code === "dailyLimitReached"
          ? code
          : "purchaseUnavailable"
      );
    } finally {
      invalidatePlayerSnapshots(["balance"]);
      purchaseInProgress.current = false;
      setPurchasing(false);
    }
  }

  return (
    <div className="yk-blackout-shop">
      <div className="yk-blackout-price">
        <Karas amount={price} /> <span>{t("perPack")}</span>
      </div>
      <dl className="yk-blackout-shop-status" aria-live="polite">
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
            disabled={quantity <= 1 || purchasing || failed}
            onClick={() => setSelection(quantity - 1)}
          >
            −
          </button>
          <output aria-label={t("quantity")}>{format.number(quantity)}</output>
          <button
            type="button"
            aria-label={t("increaseQuantity")}
            disabled={quantity >= maxQuantity || purchasing || failed}
            onClick={() => setSelection(quantity + 1)}
          >
            +
          </button>
        </div>
        <Button
          className="yk-blackout-buy"
          disabled={quantity === 0 || purchasing || failed}
          onClick={buyPacks}
        >
          {action}
        </Button>
      </div>
      {errorMessage && (
        <p className="text-sm text-ink-2" role="alert">
          {t(errorMessage)}
        </p>
      )}
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
  const { wallet } = useBlackoutWallet();
  return wallet ? (
    <p className="yk-pack-reserve yk-sunset-pack-reserve" role="status">
      {t("purchasedReserve", { reserve: wallet.reserve })}
    </p>
  ) : null;
}
