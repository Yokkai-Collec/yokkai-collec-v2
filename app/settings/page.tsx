import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Link from "next/link";
import { LocaleSelector } from "@/components/locale-controls";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { AccountMenu } from "@/components/account-menu";
import { SettingsPanel } from "@/components/settings";
import { PushSettings } from "@/components/push-settings";
import { DataExportForm } from "@/components/data-export-form";
import { AccountDeletionForm } from "@/components/account-deletion-form";
import { SubscriptionSettings } from "@/components/subscription-settings";
import { ReferralPanel } from "@/components/referral-panel";
import { SiteFooter } from "@/components/site-footer";
import { SanctionHistory } from "./sanction-history";
import { getBillingSettings } from "@/lib/billing/settings";
import { getDiscordInviteUrl } from "@/lib/discord-invite";
import { getReferralStatus } from "@/lib/referrals/server";
import {
  getCurrentKarasBalance,
  getCurrentPseudo,
  getCurrentUser
} from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settingsUi");
  return { title: t("settings") };
}

export default async function SettingsPage({
  searchParams
}: {
  searchParams: Promise<{ appeal?: string }>;
}) {
  const t = await getTranslations();
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [name, karas, billing, referral] = await Promise.all([
    getCurrentPseudo(user.id),
    getCurrentKarasBalance(),
    getBillingSettings(user.id),
    getReferralStatus()
  ]);
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  const siteOrigin = (() => {
    try {
      return new URL(configuredOrigin || "http://localhost:3000").origin;
    } catch {
      return "http://localhost:3000";
    }
  })();
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <Topbar
        view="settings"
        account={<AccountMenu />}
        name={name ?? undefined}
        karas={karas}
      />
      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        <p className="eyebrow">{t("settingsUi.yourAccount")}</p>
        <h1 className="yk-title mt-3">{t("settingsUi.settings")}</h1>
        <div className="mt-8">
          <LocaleSelector full />
          <SubscriptionSettings billing={billing} />
          <ReferralPanel initialStatus={referral} siteOrigin={siteOrigin} />
          {getDiscordInviteUrl() && (
            <Link
              href="/?discord-reward=claim"
              className="yk-button my-6 min-h-11 whitespace-normal"
            >
              {t("discordReward.settingsLink")}
            </Link>
          )}
          <SettingsPanel />
          <PushSettings userId={user.id} />
          <DataExportForm />
          <SanctionHistory result={(await searchParams).appeal} />
          {name && (
            <div className="mt-6">
              <AccountDeletionForm pseudo={name} />
            </div>
          )}
        </div>
      </main>
      <SiteFooter discordEnabled={Boolean(getDiscordInviteUrl())} />
    </div>
  );
}
