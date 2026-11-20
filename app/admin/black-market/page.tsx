import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountMenu } from "@/components/account-menu";
import { Topbar } from "@/components/topbar";
import { requireAdminPage } from "@/lib/auth/admin";
import { AdminNavigation } from "../admin-navigation";
import { BlackMarketAdmin } from "./stock-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("blackMarket");
  return { title: t("adminTitle") };
}
export default async function AdminBlackMarketPage() {
  await requireAdminPage();
  const t = await getTranslations("blackMarket");
  return (
    <div className="min-h-dvh">
      <Topbar view="admin" account={<AccountMenu />} />
      <main
        id="main-content"
        className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-8"
      >
        <h1 className="yk-title">{t("adminTitle")}</h1>
        <AdminNavigation />
        <BlackMarketAdmin />
      </main>
    </div>
  );
}
