import { createClient } from "@/utils/supabase/client";
import { blackoutPreviewEnabled } from "@/lib/data/blackout-preview";

export type BlackoutPreviewWallet = {
  balance: number;
  boughtToday: number;
  reserve: number;
  price: number;
  dailyLimit: number;
  purchasesOpen?: boolean;
};

type WalletAction = { action: "buy"; quantity: number } | { action: "open" };

export async function requestBlackoutPreviewWallet(
  action?: WalletAction,
  signal?: AbortSignal
): Promise<BlackoutPreviewWallet> {
  const response = await fetch("/api/blackout-preview/wallet", {
    signal,
    ...(action && {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action)
    })
  });
  if (response.ok) return response.json();
  const result = await response.json().catch(() => null);
  throw new Error(result?.error ?? "walletUnavailable");
}

export async function requestBlackoutWallet(
  action?: Extract<WalletAction, { action: "buy" }>,
  signal?: AbortSignal
): Promise<BlackoutPreviewWallet> {
  if (blackoutPreviewEnabled) return requestBlackoutPreviewWallet(action, signal);
  const db = createClient();
  if (!action) {
    const request = db.rpc("get_blackout_event");
    const { data, error } = await (signal ? request.abortSignal(signal) : request);
    if (error || !data?.wallet) throw new Error("walletUnavailable");
    return data.wallet;
  }
  const { data, error } = await db.rpc("buy_blackout_packs", {
    p_quantity: action.quantity,
    p_request: crypto.randomUUID()
  });
  if (error?.message === "INSUFFICIENT_KARAS") throw new Error("notEnoughKaras");
  if (error?.message === "BLACKOUT_DAILY_LIMIT") throw new Error("dailyLimitReached");
  if (error) throw new Error("purchaseUnavailable");
  return data;
}
