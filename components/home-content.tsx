import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import Link from "next/link";
import { YokaiCard } from "@/components/yokai-card";
import { HOME_HERO_CARDS } from "@/lib/home-hero-cards";
import { DISCORD_MARK_PATH } from "@/components/site-footer";
import { ReferralReminder } from "@/components/referral-reminder";
import "@/styles/home.css";

export function HomeHero() {
  const t = useTranslations("homeContent");
  return (
    <section className="yk-home-hero" aria-labelledby="home-title">
      <div className="yk-home-hero-copy">
        <p className="eyebrow">{t("aNewDiscoveryInEveryCard")}</p>
        <h1 id="home-title">
          {t("yourFavorites")}
          <br />
          {t("yourCollection")}
          <br />
          <em>{t("yourNextObsession")}</em>
        </h1>
        <p>
          {t("openPacksAndDiscoverYourNextFavorite")}
          <br />
          {t("collectCardsAndCompleteYourBinders")}
          <br />
          {t("tradeWithFriendsAndSellAtAuction")}
        </p>
      </div>
      <div className="yk-home-ribbon-window" aria-hidden="true">
        <div className="yk-home-ribbon">
          {[0, 1].map(copy => (
            <div className="yk-home-ribbon-set" key={copy}>
              {HOME_HERO_CARDS.map(card => (
                <div className="yk-home-display-card" key={card.id}>
                  <YokaiCard {...card} animated={false} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HomeLinks({ discordEnabled }: { discordEnabled: boolean }) {
  const t = useTranslations("homeContent");
  return (
    <>
      <div className="yk-home-community-grid">
        {discordEnabled && (
          <section aria-labelledby="home-discord" className="yk-home-discord">
            <div>
              <h2 id="home-discord">{t("joinTheYokkaiCommunity")}</h2>
              <p>{t("discordReward", { count: 5 })}</p>
            </div>
            <Link
              href="/?discord-reward=claim"
              className="yk-button yk-button-primary yk-home-panel-action min-h-11 whitespace-normal"
            >
              {t("joinDiscord")}
            </Link>
            <svg
              className="yk-home-discord-logo"
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="96"
              height="96"
              fill="currentColor"
            >
              <path d={DISCORD_MARK_PATH} />
            </svg>
          </section>
        )}
        <ReferralReminder packChoices homeCard />
      </div>
      <section aria-labelledby="home-learn" className="yk-home-panel">
        <h2 id="home-learn">{t("learnMore")}</h2>
        <div className="yk-home-guides">
          {[
            ["/rules", t("theRules"), t("startCollecting")],
            ["/rarities", t("raritiesAndShiny"), t("chaseCards")],
            ["/info", t("aboutYokkai"), t("exploreCollection")]
          ].map(([href, title, description]) => (
            <Link key={href} href={href}>
              <h3>
                {title} <span aria-hidden="true">↗</span>
              </h3>
              <p>{description}</p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

export function HomeSkeleton() {
  const t = useTranslations("homeContent");
  return (
    <div className="yk-home-skeleton" role="status">
      <span className="sr-only">{t("loadingPanel")}</span>
      <div />
      <div />
      <div />
    </div>
  );
}

export function HomePacks({ children }: { children: ReactNode }) {
  const t = useTranslations("homeContent");
  return (
    <section className="yk-home-panel" aria-labelledby="home-packs">
      <header className="yk-home-panel-heading">
        <h2 id="home-packs">{t("yourPacks")}</h2>
        <Link
          href="/boosters"
          className="yk-button yk-button-primary yk-home-panel-action"
        >
          {t("openABooster")}
          <span aria-hidden="true">↗</span>
        </Link>
      </header>
      <div className="yk-home-packs-grid">{children}</div>
    </section>
  );
}
