export type BlackoutPreviewWallet = {
  balance: number;
  boughtToday: number;
  reserve: number;
  price: number;
  dailyLimit: number;
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
