import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { LeaderboardTopbar } from "@/components/leaderboard-topbar";
import { AccountMenu } from "@/components/account-menu";
import { BlackMarketPanel } from "@/components/black-market";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("blackMarket");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false }
  };
}

export default async function BlackMarketPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/black-market");
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <LeaderboardTopbar view="events" account={<AccountMenu />} />
      <BlackMarketPanel viewerId={user.id} />
    </div>
  );
}
