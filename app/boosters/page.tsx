import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { AccountMenu } from "@/components/account-menu";
import { Game } from "@/components/game";
import { InvocationCardBackProvider } from "@/components/invocation-card-back";
import { getCurrentUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { preload } from "react-dom";
import { cookies } from "next/headers";
import { getDiscordInviteUrl } from "@/lib/discord-invite";
import { createClient } from "@/utils/supabase/server";
import { getInvocationCardBack } from "@/lib/data/invocation-card-back";
import { invocationBackImage } from "@/lib/ui/booster-opening-document";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("gameUi");
  return { title: t("packsMetadata") };
}

export default async function BoostersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const invocationBack = await getInvocationCardBack(
    createClient(await cookies())
  );
  // Avoid a blank card back at the start of the opening animation.
  preload(invocationBackImage(invocationBack), { as: "image" });
  return (
    <InvocationCardBackProvider back={invocationBack}>
      <Game
        key={user.id}
        view="packs"
        account={<AccountMenu />}
        discordEnabled={Boolean(getDiscordInviteUrl())}
      />
    </InvocationCardBackProvider>
  );
}
