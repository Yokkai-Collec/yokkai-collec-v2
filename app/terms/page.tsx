import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Link from "next/link";
import { InfoSection, PublicInfoPage } from "@/components/public-info-page";
import { getDiscordInviteUrl } from "@/lib/discord-invite";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legalUi");
  return {
    title: t("termsOfUse"),
    description: t("termsOfUseForYokkaiCollecAccounts"),
    robots: { index: true, follow: true }
  };
}

const linkClass = "underline underline-offset-4 hover:text-ink";

export default async function TermsPage() {
  const t = await getTranslations("legalUi");
  return (
    <PublicInfoPage
      eyebrow={t("playingTogether")}
      title={t("termsOfUse")}
      intro={t("aGuideToUsingYokkaiResponsiblyYour")}
      discordEnabled={Boolean(getDiscordInviteUrl())}
      tone="navy"
    >
      <div
        aria-label={t("publisherAndEffectiveDate")}
        className="mb-8 text-sm leading-7 text-ink-2"
      >
        <p className="font-semibold text-ink">{t("publisherYokkaiCollec")}</p>
        <p>
          {t.rich("effectiveDateOctober202026", {
            time0: chunks => <time dateTime="2026-10-20">{chunks}</time>
          })}
        </p>
      </div>

      <InfoSection number="01" title={t("aboutYokkaiAndTheseTerms")}>
        <p>
          {t.rich("yokkaiCollecIsAnUnofficialFanProject", {
            link1: chunks => (
              <Link href="/rules" className={linkClass}>
                {chunks}
              </Link>
            ),
            link2: chunks => (
              <Link href="/info" className={linkClass}>
                {chunks}
              </Link>
            )
          })}
        </p>
      </InfoSection>

      <InfoSection number="02" title={t("accountsAndYoungerCollectors")}>
        <p>{t("yokkaiIsNotAnAdultsOnlyService")}</p>
        <p>{t("useAnEmailAddressYouControlComplete")}</p>
      </InfoSection>

      <InfoSection number="03" title={t("fairPlayAndCommunitySafety")}>
        <ul>
          <li>{t("doNotHarassThreatenDiscriminateAgainstScam")}</li>
          <li>{t("doNotUseBotsExploitBugsBypass")}</li>
          <li>{t("keepPrivateInformationPrivateDoNotShare")}</li>
        </ul>
      </InfoSection>

      <InfoSection number="04" title={t("packsCardsKarasAndExchanges")}>
        <p>
          {t.rich("regularPacksContainRandomVirtualCardsDecision", {
            link1: chunks => (
              <Link href="/rarities" className={linkClass}>
                {chunks}
              </Link>
            )
          })}
        </p>
        <p>
          {t("cardsPacksAndKarasAreInGame", {
            currency: "Karas",
            unit: "Kara"
          })}
        </p>
      </InfoSection>

      <InfoSection number="05" title={t("yourContentAndIntellectualProperty")}>
        <p>{t("charactersFranchisesArtworkNamesAndTrademarksBelong")}</p>
        <p>{t("youMustHaveTheNecessaryRightsOr")}</p>
      </InfoSection>

      <InfoSection number="06" title={t("optionalPaidFeatures")}>
        <p>
          {t(
            process.env.WHOP_LIVE_CHECKOUT_ENABLED === "true"
              ? "proPaymentsTerms"
              : "someFeaturesSuchAsProSubscriptionsMay"
          )}
        </p>
        <p>{t("useTheSubscriptionControlsProvidedInYour")}</p>
      </InfoSection>

      <InfoSection number="07" title={t("personalDataAndAccountControls")}>
        <p>
          {t.rich("useAccountSettingsToManageTheAvailable", {
            link1: chunks => (
              <Link href="/privacy" className={linkClass}>
                {chunks}
              </Link>
            )
          })}
        </p>
      </InfoSection>

      <InfoSection number="08" title={t("moderationAndClosingAnAccount")}>
        <p>{t("toProtectCollectorsAndTheServiceWe")}</p>
        <p>{t("youMayStopUsingYokkaiAtAny")}</p>
      </InfoSection>

      <InfoSection number="09" title={t("availabilityChangesAndYourRights")}>
        <p>{t("featuresMayChangeAndMaintenanceOrTechnical")}</p>
        <p>{t("ifTheseTermsChangeAnUpdatedVersion")}</p>
      </InfoSection>

      <InfoSection number="10" title={t("contact")}>
        <p>
          {t.rich("forAccountHelpSafetyReportsRightsConcerns", {
            link1: chunks => (
              <a
                href="mailto:yokkaicollec@gmail.com"
                className={`${linkClass} break-all`}
              >
                {chunks}
              </a>
            )
          })}
        </p>
      </InfoSection>
    </PublicInfoPage>
  );
}
