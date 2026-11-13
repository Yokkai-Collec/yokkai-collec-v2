import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getReferralStatus } from "@/lib/referrals/server";
import type { ReferralEvent } from "@/lib/referrals/event";
import { createClient } from "@/utils/supabase/server";
import { Topbar } from "@/components/topbar";
import { AccountMenu } from "@/components/account-menu";
import { ReferralPanel } from "@/components/referral-panel";
import { ReferralEventPanel } from "@/components/referral-event";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("referralEvent");
  return { title: t("title"), robots: { index: false } };
}

export default async function ReferralEventPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/referral-event");
  const db = createClient(await cookies());
  const [event, referral] = await Promise.all([
    db.rpc("get_referral_event"),
    getReferralStatus()
  ]);
  if (event.error) throw new Error("REFERRAL_EVENT_UNAVAILABLE");
  const origin = new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
  ).origin;
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <Topbar view="settings" account={<AccountMenu />} />
      <main
        id="main-content"
        className="mx-auto w-full max-w-6xl min-w-0 px-3 py-6 sm:px-6 sm:py-10"
      >
        <ReferralEventPanel initialEvent={event.data as ReferralEvent | null} />
        <ReferralPanel initialStatus={referral} siteOrigin={origin} />
      </main>
    </div>
  );
}
