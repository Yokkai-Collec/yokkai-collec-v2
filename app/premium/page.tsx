import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getCurrentUser } from "@/lib/auth/session";
import { getBillingSettings } from "@/lib/billing/settings";
import { PremiumOffer } from "@/components/premium-offer";
import { PremiumProfileEmbed } from "@/components/premium-profile-embed";
import "@/styles/profile-style.css";
import "@/styles/premium.css";

export async function generateMetadata(): Promise<Metadata> {
  const tPr5 = await getTranslations("premiumUi");
  return { title: tPr5("premium") };
}
export const dynamic = "force-dynamic";

export default async function PremiumPage() {
  const tPr5 = await getTranslations("premiumUi");
  const user = await getCurrentUser();
  const billing = user
    ? await getBillingSettings(user.id)
    : process.env.WHOP_LIVE_CHECKOUT_ENABLED === "true" &&
        process.env.WHOP_LIVE_SYNC_ENABLED === "true"
      ? {
          checkoutProvider: "whop" as const,
          checkoutEnabled: true,
          enabled: false,
          sandbox: false,
          status: null,
          unavailable: false
        }
      : null;
  return (
    <div className="yk-premium-page">
      <header className="yk-premium-nav">
        <Link href="/boosters" aria-label={tPr5("yokkaiCollecHome")}>
          <Image
            src="/assets/brand-logo-ice-retro.png"
            alt=""
            width={1672}
            height={941}
            sizes="112px"
            className="yk-premium-logo"
          />
        </Link>
        <span>YOKKAI PRO</span>
        <Link href={user ? "/settings#subscription" : "/login"}>
          {user ? tPr5("manageMembership") : tPr5("signInArrow")}
        </Link>
      </header>
      <main className="yk-premium-main">
        <PremiumOffer
          signedIn={!!user}
          billing={billing}

          profilePreview={<PremiumProfileEmbed />}
        />
      </main>
      <footer className="yk-premium-footer">
        {tPr5("yourCollectionYourStyle")}
      </footer>
    </div>
  );
}
