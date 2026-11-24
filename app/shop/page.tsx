import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AccountMenu } from "@/components/account-menu";
import {
  CosmeticShop,
  type CosmeticShopState
} from "@/components/cosmetic-shop";
import { SiteFooter } from "@/components/site-footer";
import { getCurrentPseudo, getVerifiedUser } from "@/lib/auth/session";
import { getDiscordInviteUrl } from "@/lib/discord-invite";
import { createClient } from "@/utils/supabase/server";
import "@/styles/cosmetic-shop.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("cosmeticShop");
  return { title: t("title") };
}

export default async function ShopPage({
  searchParams
}: {
  searchParams: Promise<{ cosmetic?: string | string[] }>;
}) {
  const user = await getVerifiedUser();
  if (!user) redirect("/login");

  const db = createClient(await cookies());
  const [{ data, error }, name, { cosmetic }] = await Promise.all([
    db.rpc("get_card_cosmetic_shop"),
    getCurrentPseudo(user.id),
    searchParams
  ]);
  const initial = error ? null : (data as CosmeticShopState | null);
  const offerId =
    typeof cosmetic === "string" &&
    initial?.items.some(item => item.id === cosmetic)
      ? cosmetic
      : undefined;

  return (
    <div className="flex min-h-dvh w-full flex-col">
      <CosmeticShop
        key={offerId ?? "shop"}
        account={<AccountMenu />}
        name={name ?? undefined}
        initial={initial}
        offerId={offerId}
      />
      <SiteFooter discordEnabled={Boolean(getDiscordInviteUrl())} />
    </div>
  );
}
