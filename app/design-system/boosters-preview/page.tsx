import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountMenu } from "@/components/account-menu";
import { SiteFooter } from "@/components/site-footer";
import { getDiscordInviteUrl } from "@/lib/discord-invite";
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
  const [tg, { pity }] = await Promise.all([
    getTranslations("gameUi"),
    searchParams
  ]);
  const pityOpened =
    typeof pity === "string" && /^\d{1,3}$/.test(pity) && Number(pity) < 500
      ? Number(pity)
      : undefined;
  return (
    <div className="yk-boosters-page">
      <div className="flex min-h-dvh w-full flex-col">
        <Topbar
          view="packs"
          account={<AccountMenu />}
          name="Kitsune"
          karas={4920}
        />
        <main
          id="main-content"
          className="yk-game-main mx-auto w-full max-w-6xl flex-1 px-6 py-10"
        >
          <header className="yk-pack-page-heading">
            <h1 className="yk-title mt-3">{tg("yourNextGreatPull")}</h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-ink-2">
              {tg("newYokkaiNewStoriesAlwaysSomethingToDiscover")}
            </p>
          </header>
          <BoostersPreview pityOpened={pityOpened} showPackChoices />
        </main>
        <SiteFooter
          note={tg("yourCollectionIsSavedToYourAccount")}
          discordEnabled={Boolean(getDiscordInviteUrl())}
        />
      </div>
    </div>
  );
}
