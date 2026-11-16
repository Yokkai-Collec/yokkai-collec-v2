import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountMenu } from "@/components/account-menu";
import { Topbar } from "@/components/topbar";
import { requireAdminPage } from "@/lib/auth/admin";
import { getCurrentKarasBalance, getCurrentPseudo } from "@/lib/auth/session";
import { AdminNavigation } from "../admin-navigation";
import { GiftCodeCreator } from "./gift-code-creator";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("giftCodes");
  return { title: t("adminTitle") };
}

export default async function AdminGiftCodesPage() {
  const admin = await requireAdminPage();
  const [name, karas, t] = await Promise.all([
    getCurrentPseudo(admin.id),
    getCurrentKarasBalance(),
    getTranslations("giftCodes")
  ]);

  return (
    <div className="min-h-dvh">
      <Topbar
        view="admin"
        account={<AccountMenu />}
        name={name ?? undefined}
        karas={karas}
      />
      <main
        id="main-content"
        className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-8"
      >
        <h1 className="yk-title">{t("adminTitle")}</h1>
        <AdminNavigation />
        <GiftCodeCreator />
      </main>
    </div>
  );
}
