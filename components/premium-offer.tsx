import type { CSSProperties, ReactNode } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import type { BillingSettings } from "@/lib/billing/settings";
import { PremiumBannerPreview } from "@/components/premium-banner-preview";
import { PremiumCardArtworkPreview } from "@/components/premium-card-artwork-preview";
import { PremiumCheckout } from "@/components/premium-checkout";
import { PROPOSED_PLAN_RULES as rules } from "@/lib/premium/offer";

function PlanAvailability({ included }: { included: boolean }) {
  const tPr5 = useTranslations("premiumUi");
  return (
    <span
      className={`yk-pro-plan-availability${included ? " is-included" : ""}`}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d={included ? "m5 12 4 4L19 6" : "M7 12h10"}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="sr-only">
        {included ? tPr5("included") : tPr5("notIncluded")}
      </span>
    </span>
  );
}

export function PremiumOffer({
  signedIn,
  billing,
  profileMotion,
  profilePreview
}: {
  signedIn: boolean;
  billing: BillingSettings | null;
  profileMotion?: ReactNode;
  profilePreview?: ReactNode;
}) {
  const t = useTranslations("regularPackRules");
  const tPr5 = useTranslations("premiumUi");
  return (
    <div
      className="yk-pro-offer"
      style={{ "--plus-accent": "var(--color-accent-neon)" } as CSSProperties}
    >
      <section className="yk-premium-hero yk-pro-offer-hero">
        <div className="yk-premium-copy">
          <p className="eyebrow">Yokkai Pro</p>
          <h1>
            {tPr5.rich("moreStyleMoreCards", {
              br0: () => <br />,
              em1: chunks => <em>{chunks}</em>
            })}
          </h1>
          <p className="yk-premium-intro">{t("proIntro")}</p>
          <div className="yk-premium-hero-actions">
            <PremiumCheckout signedIn={signedIn} billing={billing} />
            <a href="#plan-comparison" className="yk-pro-compare-button">
              {tPr5("compareBasicAndPro")}
              <span aria-hidden="true">↓</span>
            </a>
          </div>
        </div>
        <div
          className="yk-pro-hero-showcase"
          aria-label={tPr5("previewOfProPackBenefits")}
        >
          <div className="yk-pro-showcase-heading">
            <p className="eyebrow">{tPr5("moreChancesMoreFavorites")}</p>
            <h2>{tPr5("yourNextGreatPull")}</h2>
          </div>
          <div
            className="yk-pro-card-gains"
            aria-label={tPr5("morePacksWithPro")}
          >
            <div data-pack-kind="regular">
              <div className="yk-pro-pack-stack">
                <Image
                  src="/assets/chrome-regular-booster-v1.png"
                  alt=""
                  aria-hidden="true"
                  width={160}
                  height={284}
                  sizes="(max-width: 600px) 96px, 160px"
                  className="yk-pro-pack-image yk-pro-pack-back"
                />
                <Image
                  src="/assets/chrome-regular-booster-v1.png"
                  alt="Regular Pack"
                  width={160}
                  height={284}
                  sizes="(max-width: 600px) 96px, 160px"
                  className="yk-pro-pack-image"
                />
              </div>
              <div className="yk-pro-pack-copy">
                <strong>
                  {rules.pro.regularPackReserve /
                    rules.basic.regularPackReserve}
                  ×
                </strong>
                <span>{t("reserveSize")}</span>
                <p>
                  {t("sharedInterval", {
                    minutes: rules.pro.regularPackMinutes
                  })}
                </p>
                <p>
                  {t.rich("hourly", {
                    count: 60 / rules.pro.regularPackMinutes,
                    strong: chunks => <b>{chunks}</b>
                  })}
                </p>
              </div>
            </div>
            <div data-pack-kind="decision">
              <div className="yk-pro-pack-stack">
                <Image
                  src="/assets/chrome-decision-booster-v1.png"
                  alt=""
                  aria-hidden="true"
                  width={160}
                  height={284}
                  sizes="(max-width: 600px) 96px, 160px"
                  className="yk-pro-pack-image yk-pro-pack-back"
                />
                <Image
                  src="/assets/chrome-decision-booster-v1.png"
                  alt="Decision Pack"
                  width={160}
                  height={284}
                  sizes="(max-width: 600px) 96px, 160px"
                  className="yk-pro-pack-image"
                />
              </div>
              <div className="yk-pro-pack-copy">
                <strong>{rules.pro.decisionPacksPerDay}</strong>
                <span>{tPr5("everyDay")}</span>
                <p>
                  {tPr5("decisionPacksInsteadOfPacksNumber", {
                    packs: rules.basic.decisionPacksPerDay
                  })}
                </p>
              </div>
            </div>
          </div>
          <p className="yk-pro-showcase-footnote">
            {tPr5("fiveCardsInEveryRegularPackMore")}
          </p>
        </div>
      </section>
      <div className="yk-pro-personalization-examples">
        <PremiumBannerPreview />
        <PremiumCardArtworkPreview />
      </div>
      <section
        className="yk-pro-profile-showcase"
        aria-labelledby="profile-customization-title"
      >
        <div className="yk-pro-profile-heading">
          <p className="eyebrow">{tPr5("profileCustomization")}</p>
          <h2 id="profile-customization-title">
            {tPr5.rich("yourProfileYourSignature", {
              br0: () => <br />,
              em1: chunks => <em>{chunks}</em>
            })}
          </h2>
          <p>{tPr5("giveYourCollectionAHomeThatFeels")}</p>
        </div>
        <ul className="yk-pro-profile-details">
          <li>
            <span aria-hidden="true">Aa</span>
            <div>
              <h3>{tPr5("aNameThatStandsOut")}</h3>
              <p>{tPr5("chooseYourNameFontColorsAndEffects")}</p>
            </div>
          </li>
          <li>
            <span aria-hidden="true">✦</span>
            <div>
              <h3>{tPr5("theFinishingTouches")}</h3>
              <p>{tPr5("pairYourAvatarFrameWithDecorativeBadges")}</p>
            </div>
          </li>
          <li>
            <span aria-hidden="true">◈</span>
            <div>
              <h3>{tPr5("setYourOwnMood")}</h3>
              <p>{tPr5("pickAProfileThemeToMatchYour")}</p>
            </div>
          </li>
          <li>
            <span aria-hidden="true">10</span>
            <div>
              <h3>{tPr5("moreRoomForYourFavorites")}</h3>
              <p>
                {tPr5("featureUpToCountNumberCardsAnd", {
                  count: rules.pro.showcaseSlots
                })}
              </p>
            </div>
          </li>
        </ul>
        {profilePreview ?? (
          <figure className="yk-pro-profile-photo">
            <div className="yk-pro-profile-photo-crop">
              <Image
                src="/assets/premium-examples/bbdou-profile.png"
                alt={tPr5("nameSCustomizedProfileWithAnAnime", {
                  name: "BBDOU"
                })}
                width={1920}
                height={1032}
                sizes="(max-width: 600px) 138vw, (max-width: 1340px) 128vw, 1738px"
              />
              {profileMotion}
            </div>
            <figcaption>{tPr5("yourStyleFromTheFirstImpressionTo")}</figcaption>
          </figure>
        )}
      </section>
      <section
        id="plan-comparison"
        className="yk-pro-comparison"
        aria-labelledby="comparison-title"
      >
        <div className="yk-pro-comparison-heading">
          <p className="eyebrow">{tPr5("basicVsPro")}</p>
          <h2 id="comparison-title">{tPr5("yourCollectionUpgraded")}</h2>
          <p>{tPr5("moreCardsToDiscoverMoreWaysTo")}</p>
        </div>
        <div className="yk-pro-comparison-frame">
          <table>
            <caption className="sr-only">
              {tPr5("basicAndProMembershipComparison")}
            </caption>
            <thead>
              <tr>
                <th scope="col">{tPr5("whatSIncluded")}</th>
                <th scope="col">
                  {tPr5.rich("basicFreeToCollect", {
                    span0: chunks => (
                      <span className="yk-pro-plan-name">{chunks}</span>
                    ),
                    span1: chunks => (
                      <span className="yk-pro-plan-description">{chunks}</span>
                    )
                  })}
                </th>
                <th scope="col">
                  {tPr5.rich("yokkaiProMoreCardsMoreYou", {
                    span0: chunks => (
                      <span className="yk-pro-plan-name">{chunks}</span>
                    ),
                    span1: chunks => <span aria-hidden="true">{chunks}</span>,
                    span2: chunks => (
                      <span className="yk-pro-plan-description">{chunks}</span>
                    )
                  })}
                </th>
              </tr>
            </thead>
            <tbody aria-label={tPr5("moreCards")}>
              <tr className="yk-pro-comparison-group">
                <th colSpan={3} scope="rowgroup">
                  {tPr5("moreCards")}
                </th>
              </tr>
              <tr>
                <th scope="row">Regular Pack</th>
                <td>
                  {t("interval", { minutes: rules.basic.regularPackMinutes })}
                </td>
                <td>
                  {t("interval", { minutes: rules.pro.regularPackMinutes })}
                </td>
              </tr>
              <tr>
                <th scope="row">{t("reserveLabel")}</th>
                <td>
                  {t("reserveCount", { count: rules.basic.regularPackReserve })}
                </td>
                <td>
                  {t("reserveCount", { count: rules.pro.regularPackReserve })}
                </td>
              </tr>
              <tr>
                <th scope="row">Decision Pack</th>
                <td>
                  {tPr5("packsNumberPerDay", {
                    packs: rules.basic.decisionPacksPerDay
                  })}
                </td>
                <td>
                  {tPr5("packsNumberPerDay", {
                    packs: rules.pro.decisionPacksPerDay
                  })}
                </td>
              </tr>
              <tr>
                <th scope="row">{tPr5("rarityOddsPerCard")}</th>
                <td>{tPr5("unchanged")}</td>
                <td>{tPr5("unchanged")}</td>
              </tr>
            </tbody>
            <tbody aria-label={tPr5("makeItYours")}>
              <tr className="yk-pro-comparison-group">
                <th colSpan={3} scope="rowgroup">
                  {tPr5("makeItYours")}
                </th>
              </tr>
              {[
                "customArtworkGifs",
                "customBanners",
                "animatedAvatars",
                "nameThemes",
                "framesBadges",
                "showcaseEffects",
                "proBadge"
              ].map(label => (
                <tr key={label}>
                  <th scope="row">{tPr5(label)}</th>
                  <td>
                    <PlanAvailability included={false} />
                  </td>
                  <td>
                    <PlanAvailability included />
                  </td>
                </tr>
              ))}
            </tbody>
            <tbody aria-label={tPr5("collectAndShare")}>
              <tr className="yk-pro-comparison-group">
                <th colSpan={3} scope="rowgroup">
                  {tPr5("collectShare")}
                </th>
              </tr>
              <tr>
                <th scope="row">{tPr5("activeAuctions")}</th>
                <td>{rules.basic.concurrentAuctions}</td>
                <td>{rules.pro.concurrentAuctions}</td>
              </tr>
              <tr>
                <th scope="row">{tPr5("showcaseCharacters")}</th>
                <td>{rules.basic.showcaseSlots}</td>
                <td>{rules.pro.showcaseSlots}</td>
              </tr>
              <tr>
                <th scope="row">{tPr5("bindersTradingWithFriends")}</th>
                <td>
                  <PlanAvailability included />
                </td>
                <td>
                  <PlanAvailability included />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="yk-pro-offer-footnote">
          {tPr5("decisionPacksResetTogetherAtTheSame")}
        </p>
      </section>
      <section className="yk-premium-faq">
        <h2>{tPr5("aFewThingsWorthKnowing")}</h2>
        <details>
          <summary>{tPr5("doRarityOddsChangeWithPro")}</summary>
          <p>{tPr5("noProGivesYouFasterRegularPacks")}</p>
        </details>
        <details>
          <summary>{tPr5("canICancelMySubscription")}</summary>
          <p>
            {tPr5(
              billing?.checkoutProvider === "whop" ||
                billing?.status?.provider === "whop"
                ? "manageSubscriptionInBillingPortal"
                : "yesUseManageSubscriptionToOpenThe"
            )}
          </p>
        </details>
        <details>
          <summary>{tPr5("whereDoIManageMyMembership")}</summary>
          <p>{tPr5("openYourAccountSettingsToViewYour")}</p>
        </details>
      </section>
      <div className="yk-pro-offer-bottom">
        <p>{tPr5("moreCardsToCollectACollectionThat")}</p>
        <a href="#membership" className="yk-button yk-button-primary">
          {tPr5("getYokkaiPro")}
        </a>
      </div>
    </div>
  );
}
