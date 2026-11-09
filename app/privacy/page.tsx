import { getTranslations, getFormatter } from "next-intl/server";
import type { Metadata } from "next";
import Link from "next/link";
import { InfoSection, PublicInfoPage } from "@/components/public-info-page";
import { getDiscordInviteUrl } from "@/lib/discord-invite";
import {
  AUTH_LOG_RETENTION,
  BACKUP_RETENTION_DAYS,
  BILLING_RECORD_RETENTION,
  DELETION_LOG_RETENTION,
  PRIVACY_CONTACT_EMAIL,
  PRIVACY_CONTROLLER,
  PRIVACY_LAST_UPDATED,
  PRIVACY_MINIMUM_AGE,
  SERVER_LOG_RETENTION_DAYS
} from "@/lib/legal/privacy";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legalUi");
  return {
    title: t("privacyPolicy"),
    description: t("howYokkaiCollecCollectsUsesSharesAnd"),
    robots: { index: true, follow: true }
  };
}

const linkClass = "underline underline-offset-4 hover:text-ink";

const browserStorage = [
  ["signInCookie", "sessionPurpose"],
  ["yokkai:collection-sort", "sortPurpose"],
  ["yokkai:filters-open:v1", "filtersPurpose"],
  ["yokkai-sound-enabled", "soundPurpose"],
  ["yokkai:pro-promotion:v1:dismissed-at", "proPurpose"],
  ["yokkai-discord-promo-dismissed:<account ID>", "discordPurpose"],
  ["yokkai-discord-reward-dismissed:<account ID>", "discordPurpose"],
  ["yokkai-referral-reminder-dismissed:<account ID>", "referralPurpose"],
  ["yokkai:social-unread-invalidation", "unreadPurpose"]
];

function Email() {
  return (
    <a
      href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
      className={`${linkClass} break-all`}
    >
      {PRIVACY_CONTACT_EMAIL}
    </a>
  );
}

export default async function PrivacyPage() {
  const t = await getTranslations("legalUi");
  const fmt = await getFormatter();
  const lastUpdated = fmt.dateTime(
    new Date(`${PRIVACY_LAST_UPDATED}T00:00:00Z`),
    { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }
  );
  return (
    <PublicInfoPage
      eyebrow={t("yourData")}
      title={t("privacyPolicy")}
      intro={t("whatWeCollectWhenYouPlayYokkai")}
      discordEnabled={Boolean(getDiscordInviteUrl())}
      tone="navy"
    >
      <p className="mb-8 text-sm leading-7 text-ink-2">
        {t.rich("lastUpdatedDate", {
          date: lastUpdated,
          time0: chunks => <time dateTime={PRIVACY_LAST_UPDATED}>{chunks}</time>
        })}
      </p>

      <InfoSection number="01" title={t("whoWeAreAndHowToContact")}>
        <p>
          {t.rich("controllerIsTheDataControllerForThe", {
            controller: PRIVACY_CONTROLLER,
            email0: () => <Email />
          })}
        </p>
      </InfoSection>

      <InfoSection number="02" title={t("whatDataWeCollect")}>
        <ul>
          <li>
            {t.rich("accountYourEmailAddressPasswordAndUsername", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
          <li>
            {t.rich("securityChecksSignInSignUpAnd", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
          <li>
            {t.rich("antiCheatNetworkIdentity", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
          <li>{t("discordRewardData")}</li>
          <li>{t("twitterRewardData")}</li>
          <li>
            {t.rich("profileAvatarBannerBackgroundAndCardBack", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
          <li>
            {t.rich("gameDataCardsAndCollectionCustomCard", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
          <li>
            {t.rich("socialActivityFriendsAndFriendRequestsTrades", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
          <li>
            {t.rich("sharingTheCardShareLinksYouCreate", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
          <li>
            {t.rich("subscriptionYourStripeCustomerIDCheckoutSession", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
          <li>
            {t.rich("technicalDataServerAndDatabaseLogsNeeded", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
        </ul>
      </InfoSection>

      <InfoSection number="03" title={t("whyWeUseItAndLegalBasis")}>
        <ul>
          <li>
            {t.rich("toProvideTheGameAndYourSubscription", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
          <li>
            {t.rich("toMeetBillingAndAccountingRequirementsLegal", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
          <li>
            {t.rich("toKeepYokkaiSafeAndFairLegitimate", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
        </ul>
        <p>{t("weDoNotSellYourPersonalData")}</p>
      </InfoSection>

      <InfoSection number="04" title={t("whatOtherPlayersCanSee")}>
        <ul>
          <li>{t("signedInPlayersCanSeeYourUsername")}</li>
          <li>{t("yourCollectionIsVisibleToSignedIn")}</li>
          <li>{t("yourFriendsCanSeeWhetherYouAre")}</li>
          <li>{t("visitorsWhoAreNotSignedInCan")}</li>
          <li>{t("yokkaiAdministratorsCanAccessAccountDataIncluding")}</li>
        </ul>
      </InfoSection>

      <InfoSection number="05" title={t("payments")}>
        <p>{t("proSubscriptionsAreProcessedByStripeThrough")}</p>
        <p>
          {t.rich("weSendStripeOnlyYourYokkaiAccount", {
            link1: chunks => (
              <a
                href="https://stripe.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
              >
                {chunks}
              </a>
            )
          })}
        </p>
      </InfoSection>

      <InfoSection
        number="06"
        title={t("thirdPartyServicesAndInternationalTransfers")}
      >
        <ul>
          <li>
            {t.rich("hostingTheWebsiteDatabaseAndUploadedImages", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
          <li>
            {t.rich("cloudflareDomainNetworkProtectionAndTurnstileBot", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
          <li>
            {t.rich("stripePaymentsAndSubscriptions", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
          <li>
            {t.rich("gIPHYWhenYouOpenTheGIFPicker", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
          <li>
            {t.rich("imageHostsCustomCardImagesAreLoaded", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
          <li>
            {t.rich("discordTheDiscordLinkOnlyOpensOur", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
        </ul>
        <p>{t("whenYourBrowserLoadsContentFromThese")}</p>
      </InfoSection>

      <InfoSection number="07" title={t("cookiesAndLocalStorage")}>
        <p>{t("weUseOneCookieToKeepYou")}</p>
        <ul>
          {browserStorage.map(([name, purpose]) => (
            <li key={name}>
              <code className="break-all text-ink">
                {name === "signInCookie" ? t(name) : name}
              </code>
              : {t(purpose)}
            </li>
          ))}
        </ul>
      </InfoSection>

      <InfoSection number="08" title={t("howLongWeKeepData")}>
        <ul>
          <li>{t("accountAndGameDataUntilYouDelete")}</li>
          <li>
            {t("databaseBackupsUpToDaysDaysAfter", {
              days: BACKUP_RETENTION_DAYS
            })}
          </li>
          <li>
            {t("serverLogsAndScheduledJobHistoryAbout", {
              days: SERVER_LOG_RETENTION_DAYS
            })}
          </li>
          <li>
            {t("authenticationLogsDuration", {
              duration: AUTH_LOG_RETENTION ?? t("authRetention")
            })}
          </li>
          <li>
            {t("billingRecordsDuration", {
              duration: BILLING_RECORD_RETENTION ?? t("billingRetention")
            })}
          </li>
          <li>
            {t("deletionLogAccountIDAndDateOnly", {
              duration: DELETION_LOG_RETENTION ?? t("deletionRetention")
            })}
          </li>
          <li>{t("deletedSecurityIdentityRetention", { days: 90 })}</li>
          <li>{t("deletedEmailCooldownRetention", { days: 14 })}</li>
          <li>{t("discordRewardRetention")}</li>
          <li>{t("twitterRewardRetention")}</li>
        </ul>
      </InfoSection>

      <InfoSection number="09" title={t("accountDeletion")}>
        <p>{t("youCanDeleteYourAccountAtAny")}</p>
        <p>{t("emailReuseCooldownNotice", { days: 14 })}</p>
        <ul>
          <li>
            {t.rich("deletedYourSignInIdentityProfileUploaded", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
          <li>
            {t.rich("subscriptionAnActiveProSubscriptionIsCanceled", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
          <li>
            {t.rich("anonymizedPastAuctionsBidsTradesAndReports", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
          <li>
            {t.rich("keptALogContainingOnlyYourAccount", {
              strong0: chunks => <strong>{chunks}</strong>
            })}
          </li>
          <li>{t("deletedSecurityIdentityException", { days: 90 })}</li>
          <li>{t("discordRewardRetention")}</li>
          <li>{t("twitterRewardRetention")}</li>
        </ul>
      </InfoSection>

      <InfoSection number="10" title={t("yourRights")}>
        <p>
          {t.rich("youHaveTheRightToAccessCorrect", {
            email0: () => <Email />
          })}
        </p>
        <p>{t("youCanAlsoFileAComplaintWith")}</p>
      </InfoSection>

      <InfoSection number="11" title={t("children")}>
        <p>
          {t.rich("yokkaiIsNotIntendedForChildrenUnder", {
            minimumAge: PRIVACY_MINIMUM_AGE,
            email0: () => <Email />
          })}
        </p>
      </InfoSection>

      <InfoSection number="12" title={t("security")}>
        <p>{t("weUseEncryptedConnectionsHashedPasswordsBot")}</p>
      </InfoSection>

      <InfoSection number="13" title={t("changesToThisPolicy")}>
        <p>
          {t.rich("weMayUpdateThisPolicyWhenYokkai", {
            link1: chunks => (
              <Link href="/terms" className={linkClass}>
                {chunks}
              </Link>
            ),
            link2: chunks => (
              <Link href="/rules" className={linkClass}>
                {chunks}
              </Link>
            )
          })}
        </p>
      </InfoSection>
    </PublicInfoPage>
  );
}
