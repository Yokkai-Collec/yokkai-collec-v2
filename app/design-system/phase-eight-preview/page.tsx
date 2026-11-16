import type { Metadata } from "next";
import {
  AchievementsPreview,
  NotificationsPreview,
  PhaseEightActionProof,
  WishlistPreview
} from "@/components/phase-eight-preview";

export const metadata: Metadata = {
  title: "Phase 8 preview",
  robots: { index: false, follow: false }
};
export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ screen?: string; state?: string }>;
}) {
  const { screen, state } = await searchParams;
  if (screen === "notifications" && state === "progress")
    return <NotificationsPreview mode="progress" />;
  const title =
    screen === "wishlist"
      ? "Ma wishlist"
      : screen === "notifications"
        ? "Notifications"
        : screen === "proof"
          ? "Preuve des actions"
          : "Succès";
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <p className="eyebrow">Phase 8 · Preview locale</p>
      <h1 className="yk-title mt-3">{title}</h1>
      <div className="mt-8">
        {screen === "wishlist" ? (
          <WishlistPreview empty={state === "empty"} />
        ) : screen === "notifications" ? (
          <NotificationsPreview
            mode={
              state === "empty" ? "empty" : state === "error" ? "error" : "list"
            }
          />
        ) : screen === "proof" ? (
          <PhaseEightActionProof />
        ) : (
          <AchievementsPreview />
        )}
      </div>
    </main>
  );
}
