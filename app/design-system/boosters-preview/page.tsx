import type { Metadata } from "next";
import { BoostersPreview } from "@/components/boosters-preview";
import { Topbar } from "@/components/topbar";

export const metadata: Metadata = {
  title: "Boosters preview",
  robots: { index: false, follow: false }
};

export default async function BoostersPreviewPage({
  searchParams
}: {
  searchParams: Promise<{ pity?: string | string[] }>;
}) {
  const { pity } = await searchParams;
  const pityOpened =
    typeof pity === "string" && /^\d{1,3}$/.test(pity) && Number(pity) < 500
      ? Number(pity)
      : undefined;
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <Topbar view="packs" name="Kitsune" karas={4920} notifications={[]} />
      <main className="yk-game-main mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <header className="yk-pack-page-heading">
          <h1 className="yk-title mt-3">Your next great pull.</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-ink-2">
            New Yokkai, new stories, always something to discover.
          </p>
        </header>
        <BoostersPreview pityOpened={pityOpened} />
      </main>
      <footer className="mx-auto mt-6 flex w-full max-w-6xl flex-wrap justify-between gap-3 border-t border-veil px-6 py-6 text-xs text-ink-3">
        <span>Yokkai Collec’ · v0.2</span>
        <span>Your collection is saved to your account</span>
      </footer>
    </div>
  );
}
