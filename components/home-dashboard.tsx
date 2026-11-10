import { ProductUpdates } from "@/components/product-updates";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AmbientGlow } from "@/components/ambient-glow";
import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { AccountMenu } from "@/components/account-menu";
import { Topbar } from "@/components/topbar";
import { SiteFooter } from "@/components/site-footer";
import { getDiscordInviteUrl } from "@/lib/discord-invite";
import { HomeBinders } from "@/components/home-binders";
import { HomeFriendFeed } from "@/components/home-friend-feed";
import { HomeRankingCarousel } from "@/components/home-ranking-carousel";
import { HomeLeaderboard } from "@/components/home-leaderboard";
import type { FriendFeedPage } from "@/lib/data/friend-feed";
import {
  HomeHero,
  HomeLinks,
  HomePacks,
  HomeSkeleton
} from "@/components/home-content";
import {
  HomeRefresh,
  HomePackTimer,
  LatestPulls,
  BigPulls,
  HomeMarket
} from "@/components/home-live";
import {
  decisionPackSummary,
  type BigPull,
  type HomeCard,
  type HomePackStatus
} from "@/lib/data/home";
import type { Rarity } from "@/lib/data/cards";
import type { MarketPage } from "@/lib/data/market";

async function PanelData({ load }: { load: () => Promise<ReactNode> }) {
  const t = await getTranslations("homeDashboard");
  try {
    return await load();
  } catch {
    return (
      <p role="status" className="yk-home-empty">
        {t("thisPanelIsTemporarilyUnavailablePleaseTryAgainInA")}
      </p>
    );
  }
}

export function HomePanel({
  id,
  title,
  href,
  link,
  children
}: {
  id: string;
  title: string;
  href?: string;
  link?: string;
  children: ReactNode;
}) {
  return (
    <section className="yk-home-panel" aria-labelledby={id}>
      <header className="yk-home-panel-heading">
        <h2 id={id}>{title}</h2>
        {href && (
          <Link
            href={href}
            className="yk-button yk-button-primary yk-home-panel-action"
          >
            {link} <span aria-hidden="true">↗</span>
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

async function latest(userId: string) {
  const client = createClient(await cookies());
  const { data, error } = await client
    .from("user_cards")
    .select(
      "id,date_obtention,is_shiny,custom_image_url,cards!inner(id,nom,categorie,franchise,rarete_base,image_url)"
    )
    .eq("user_id", userId)
    .order("date_obtention", { ascending: false })
    .order("id", { ascending: false })
    .limit(12)
    .abortSignal(AbortSignal.timeout(12000));
  if (error) throw error;
  const rows = data as unknown as {
    id: string;
    date_obtention: string;
    is_shiny: boolean;
    custom_image_url: string | null;
    cards: {
      id: string;
      nom: string;
      categorie: string;
      franchise: string | null;
      rarete_base: Rarity;
      image_url: string;
    };
  }[];
  const cards: HomeCard[] = rows.map(row => ({
    id: row.cards.id,
    name: row.cards.nom,
    category: row.cards.categorie,
    anime: row.cards.franchise ?? undefined,
    rarity: row.cards.rarete_base,
    image: row.custom_image_url ?? row.cards.image_url,
    catalogueImage: row.cards.image_url,
    instanceId: row.id,
    obtainedAt: row.date_obtention,
    shiny: row.is_shiny
  }));
  return <LatestPulls cards={cards} />;
}

async function packs(kind: "regular" | "decision" = "regular") {
  const client = createClient(await cookies());
  const { data, error } = await client
    .rpc(
      kind === "decision"
        ? "get_decision_pack_status"
        : "get_regular_pack_status"
    )
    .abortSignal(AbortSignal.timeout(12000));
  if (error) throw error;
  return (
    <HomePackTimer
      kind={kind}
      initial={
        kind === "decision"
          ? { ...decisionPackSummary(data), serverNow: data.serverNow }
          : (data as HomePackStatus)
      }
    />
  );
}

async function bigPulls() {
  const client = createClient(await cookies());
  const { data, error } = await client
    .rpc("get_recent_big_pulls", { p_limit: 20 })
    .abortSignal(AbortSignal.timeout(12000));
  if (error) throw error;
  return <BigPulls pulls={data as BigPull[]} />;
}

async function market() {
  const client = createClient(await cookies());
  // Same bounded RPC and filters as browseAuctions(), with the request cookies
  // rather than its browser session. The RPC already projects catalogue fields.
  const { data, error } = await client
    .rpc("browse_auctions_page", {
      p_query: "",
      p_rarity: "",
      p_category: "",
      p_sort: "interest",
      p_section: "active",
      p_limit: 6
    })
    .abortSignal(AbortSignal.timeout(12000));
  if (error) throw error;
  return <HomeMarket initial={(data as MarketPage).items} />;
}

async function communityFeed(userId: string) {
  const t = await getTranslations("homeDashboard");
  const client = createClient(await cookies());
  const profile = await client
    .rpc("get_profile", { p_identifier: null })
    .abortSignal(AbortSignal.timeout(12000));
  const viewer =
    !profile.error && profile.data?.id === userId
      ? {
          id: profile.data.id,
          name: profile.data.pseudo,
          avatarUrl: profile.data.avatarUrl
        }
      : undefined;
  try {
    const { data, error } = await client
      .rpc("get_public_wall_feed", { p_limit: 10 })
      .abortSignal(AbortSignal.timeout(12000));
    if (error) throw error;
    return (
      <HomeFriendFeed
        scope="everyone"
        initial={data as FriendFeedPage}
        viewer={viewer}
      />
    );
  } catch {
    return (
      <HomeFriendFeed
        scope="everyone"
        initial={{ items: [], next: null }}
        viewer={viewer}
        initialError={t("publicPostsUnavailable")}
      />
    );
  }
}

async function HomeTopbar() {
  const t = await getTranslations("homeDashboard");
  let snapshot: { user: { name: string }; karasBalance: number } | undefined;
  try {
    const client = createClient(await cookies());
    const { data, error } = await client
      .rpc("get_game_info")
      .abortSignal(AbortSignal.timeout(12000));
    if (error) throw error;
    snapshot = data;
  } catch {
    snapshot = undefined;
  }
  return (
    <Topbar
      view="home"
      name={snapshot?.user.name}
      karas={snapshot?.karasBalance}
      infoError={snapshot ? undefined : t("balanceUnavailable")}
      account={<AccountMenu />}
    />
  );
}

export function HomeDashboard({
  userId,
  seenRelease
}: {
  userId: string;
  seenRelease?: string | null;
}) {
  const t = useTranslations("homeDashboard");
  const discordEnabled = Boolean(getDiscordInviteUrl());
  return (
    <div className="relative isolate flex min-h-dvh w-full flex-col">
      <AmbientGlow variant="home" />
      <Suspense fallback={<Topbar view="home" account={<AccountMenu />} />}>
        <HomeTopbar />
      </Suspense>
      <HomeRefresh />
      <main id="main-content" className="yk-home-main">
        <HomeHero />
        <HomePacks>
          <Suspense fallback={<HomeSkeleton />}>
            <PanelData load={() => packs()} />
          </Suspense>

          <Suspense fallback={<HomeSkeleton />}>
            <PanelData load={() => packs("decision")} />
          </Suspense>
        </HomePacks>
        <HomePanel
          id="home-latest"
          title={t("yourLatestPulls")}
          href="/collection"
          link={t("viewCollection")}
        >
          <Suspense fallback={<HomeSkeleton />}>
            <PanelData load={() => latest(userId)} />
          </Suspense>
        </HomePanel>
        <HomePanel id="home-big" title={t("bigDrops")}>
          <Suspense fallback={<HomeSkeleton />}>
            <PanelData load={bigPulls} />
          </Suspense>
        </HomePanel>
        <HomeBinders />
        <Suspense fallback={<HomeSkeleton />}>
          <PanelData load={() => communityFeed(userId)} />
        </Suspense>
        <HomePanel
          id="home-market"
          title={t("theMarket")}
          href="/market"
          link={t("browseMarket")}
        >
          <Suspense fallback={<HomeSkeleton />}>
            <PanelData load={market} />
          </Suspense>
        </HomePanel>
        <HomePanel id="home-leaderboard" title={t("leaderboard")}>
          <Suspense fallback={<HomeSkeleton />}>
            <HomeRankingCarousel
              key={userId}
              userId={userId}
              powerRanking={<HomeLeaderboard userId={userId} />}
            />
          </Suspense>
        </HomePanel>
        <HomeLinks discordEnabled={discordEnabled} />
      </main>
      <ProductUpdates userId={userId} seenRelease={seenRelease} />
      <SiteFooter
        discordEnabled={discordEnabled}
        contactEmail={process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim()}
      />
    </div>
  );
}
