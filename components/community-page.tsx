import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getVerifiedUser, getCurrentPseudo } from "@/lib/auth/session";
import { AccountMenu } from "@/components/account-menu";
import { SiteFooter } from "@/components/site-footer";
import { getDiscordInviteUrl } from "@/lib/discord-invite";
import {
  CommunityView,
  type CommunityScreen
} from "@/components/community-views";

export async function CommunityPage({
  screen,
  playerId,
  auctionId,
  pageHeading,
  children
}: {
  children?: ReactNode;
  pageHeading?: ReactNode;
  screen: CommunityScreen;
  playerId?: string;
  auctionId?: string;
}) {
  const user = await getVerifiedUser();
  if (!user) redirect("/login");
  const isMe = !playerId || playerId === user.id;
  const name = isMe ? await getCurrentPseudo(user.id) : undefined;
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <CommunityView
        key={`${screen}:${playerId ?? auctionId ?? user.id}`}
        screen={screen}
        viewerId={user.id}
        pageHeading={pageHeading}
        account={<AccountMenu />}
        name={name ?? undefined}
        joined={isMe ? user.created_at : undefined}
        isMe={isMe}
        playerId={playerId}
        auctionId={auctionId}
      >
        {children}
      </CommunityView>
      <SiteFooter discordEnabled={Boolean(getDiscordInviteUrl())} />
    </div>
  );
}
