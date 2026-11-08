import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { getLocalePreference } from "@/i18n/server";
import { i18nEnabled } from "@/i18n/locale";
import { LocalePreferenceProvider } from "@/components/locale-provider";
import { LocaleBanner } from "@/components/locale-controls";
import "@/styles/locale.css";
import { Cinzel, Noto_Serif_JP } from "next/font/google";
import localFont from "next/font/local";
import { BoostersLoadPriority } from "@/components/boosters-load-priority";
import { PresenceHeartbeat } from "@/components/presence-heartbeat";
import { ProAccessProvider } from "@/components/pro-access";
import { PushInvitation } from "@/components/push-settings";
import { ReferralReminder } from "@/components/referral-reminder";
import { DiscordPromo } from "@/components/discord-promo";
import { FloatingMessenger } from "@/components/floating-messenger";
import { LinkedAccountNotice } from "@/components/linked-account-notice";
import { AccountSanctionNotice } from "@/components/account-sanction-notice";
import { NetworkSecurityObserver } from "@/components/network-security-observer";
import { getDiscordInviteUrl } from "@/lib/discord-invite";
import "./globals.css";
import "../styles/ui.css";
import "../styles/referrals.css";
import "../styles/community.css";
import "../styles/private-messages.css";
import "../styles/messenger.css";
import "../styles/profile.css";
import "../styles/profile-style.css";
import "../styles/collection.css";
import "../styles/boosters.css";
import "../styles/boosters-showcase.css";
import "../styles/market.css";
import "../styles/site-footer.css";
import "../styles/info-pages.css";
import "../styles/trades.css";

const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-cinzel",
  display: "swap"
});
// Sora, self-hosted (#391): the exact Google Fonts subsets next/font/google
// used to download, same family name and unicode ranges, no network at build.
const sora = localFont({
  src: "./fonts/sora/Sora-latin.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-sora",
  display: "swap",
  // Same metrics as the "Sora Fallback" face next/font/google generated.
  adjustFontFallback: false,
  fallback: ["Sora Fallback"],
  declarations: [
    { prop: "font-family", value: "Sora" },
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"
    }
  ]
});
// Loaded only when a latin-ext glyph is rendered, as before. Its variable is
// unused; applying it keeps this @font-face in the root stylesheet.
const soraLatinExt = localFont({
  src: "./fonts/sora/Sora-latin-ext.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-sora-latin-ext",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "Sora" },
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF"
    }
  ]
});
const noto = Noto_Serif_JP({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-noto-jp",
  display: "swap",
  preload: false
});
const inter = localFont({
  src: "./fonts/inter/InterVariable.ttf",
  weight: "100 900",
  style: "normal",
  variable: "--font-inter",
  display: "swap"
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell");
  const locale = await getLocale();
  return {
    metadataBase: new URL(
      process.env.NEXT_PUBLIC_SITE_URL || "https://yokkai-collec.com"
    ),
    openGraph: { locale: locale === "fr" ? "fr_FR" : "en_US" },
    icons: {
      apple: [
        { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }
      ]
    },
    title: { default: "Yokkai", template: "%s - Yokkai" },
    description: t("description")
  };
}

export default async function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const discordEnabled = Boolean(getDiscordInviteUrl());
  const locale = await getLocale();
  const preference = await getLocalePreference();
  const messages = await getMessages();
  const clientMessages = Object.fromEntries(
    [
      "locale",
      "common",
      "authErrors",
      "authForm",
      "passwordResetForms",
      "confirmationResendForm",
      "authTurnstile",
      "signOutButton",
      "topbar",
      "authCardCustomization",
      "authCardCarousel",
      "authBinderShowcase",
      "authMarketShowcase",
      "homeLive",
      "homeContent",
      "homeDashboard",
      "binderDiscovery",
      "communityRanking",
      "homeLeaderboard",
      "homeRankingCarousel",
      "rankingProgress",
      "productUpdates",
      "maintenanceCompensation",
      "accountSanctions",
      "boosters",
      "packs",
      "collectionUi",
      "gameUi",
      "catalogueUi",
      "collectionShared",
      "cardErrors",
      "homeFriendFeed",
      "proPromotion",
      "discordPromo",
      "referralReminder",
      "socialTrades",
      "tradeDesign",
      "messenger",
      "socialFriends",
      "conversationTrade",
      "privateMessages",
      "playerPreview",
      "market",
      "siteFooter",
      "error",
      "adminReportedCard",
      "adminNavigation",
      "profileUi",
      "socialUi",
      "premiumUi",
      "shareUi",
      "achievementUi",
      "settingsUi",
      "gifPicker"
    ].map(namespace => [namespace, messages[namespace]])
  );

  return (
    <html
      lang={locale}
      className={`h-full antialiased ${cinzel.variable} ${sora.variable} ${soraLatinExt.variable} ${noto.variable} ${inter.variable}`}
    >
      <head>
        {process.env.NEXT_PUBLIC_SUPABASE_URL && (
          <link
            rel="preconnect"
            href={new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin}
            crossOrigin="anonymous"
          />
        )}
      </head>
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        <NextIntlClientProvider messages={clientMessages}>
          <LocalePreferenceProvider
            value={{
              enabled: i18nEnabled(),
              mode: preference.mode,
              dismissed: preference.dismissed
            }}
          >
            <LocaleBanner />
            <NetworkSecurityObserver />
            <BoostersLoadPriority>
              <PresenceHeartbeat />
              <ProAccessProvider>
                {children}
                <PushInvitation />
                <LinkedAccountNotice />
                <AccountSanctionNotice />
                <ReferralReminder />
                <DiscordPromo enabled={discordEnabled} />
              </ProAccessProvider>
            </BoostersLoadPriority>
            <FloatingMessenger />
          </LocalePreferenceProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
