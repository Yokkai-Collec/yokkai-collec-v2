import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { InfoSection, PublicInfoPage } from "@/components/public-info-page";
import { getDiscordInviteUrl } from "@/lib/discord-invite";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legalUi");
  return {
    title: t("cardRarities"),
    description: t("learnHowYokkaiCardRaritiesAndPack")
  };
}

const regularRarities = [
  ["C", "Common", "69.4%"],
  ["R", "Rare", "20%"],
  ["SR", "Super Rare", "10%"],
  ["SSR", "Super Super Rare", "0.5%"],
  ["LR", "Legendary Rare", "0.1%"]
] as const;

export default async function RaritiesPage() {
  const t = await getTranslations("legalUi");
  return (
    <PublicInfoPage
      eyebrow={t("collectorGuide")}
      title={t("cardRarities")}
      intro={t("everyCardBelongsToOneOfFive")}
      discordEnabled={Boolean(getDiscordInviteUrl())}
    >
      <InfoSection number="01" title={t("theFiveTiers")}>
        <div className="yk-rarity-list">
          {regularRarities.map(([code, name, odds]) => (
            <div className="yk-rarity-row" data-rarity={code} key={code}>
              <strong>{code}</strong>
              <span>{name}</span>
              <b>{odds}</b>
            </div>
          ))}
          <div className="yk-rarity-row" data-rarity="LR-SHINY">
            <strong>LR SHINY</strong>
            <span>Legendary Rare · Shiny</span>
            <b>0.0005%</b>
          </div>
        </div>
        <p>{t("theFirstFivePercentagesAreTheCurrent")}</p>
      </InfoSection>
      <InfoSection number="02" title={t("decisionPacks")}>
        <p>{t("decisionPacksOnlyContainHighRarityChoices")}</p>
      </InfoSection>
      <InfoSection number="03" title={t("shinyAndEvolvedCards")}>
        <p>{t("directlyPulledShinyCardsAreLRCards")}</p>
      </InfoSection>
      <InfoSection number="04" title={t("liveOdds")}>
        <p>{t("packOddsMayBeRebalancedAsThe")}</p>
      </InfoSection>
    </PublicInfoPage>
  );
}
