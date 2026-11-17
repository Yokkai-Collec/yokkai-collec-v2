import { getTranslations, getLocale } from "next-intl/server";
import type { Metadata } from "next";
import AuthLayout from "./(auth)/layout";
import SignUpPage from "./(auth)/signup/page";
import { getVerifiedUser } from "@/lib/auth/session";
import { HomeDashboard } from "@/components/home-dashboard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: { absolute: "Yokkai" },
    description: t("createYourFreeAccountCollectYourFavoriteCharacters"),
    alternates: { canonical: "/" },
    openGraph: {
      title: "Yokkai Collec'",
      description: t("openPacksCollectYourFavoriteCharactersAndTrade"),
      type: "website",
      locale: (await getLocale()) === "fr" ? "fr_FR" : "en_US",
      url: "/"
    },
    twitter: { card: "summary_large_image" }
  };
}

export default async function Home({
  searchParams
}: {
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const user = await getVerifiedUser();
  if (user) {
    return (
      <HomeDashboard
        userId={user.id}
        seenAnnouncement={
          typeof user.user_metadata
            ?.yokkai_seen_mystery_auction_announcement === "string"
            ? user.user_metadata.yokkai_seen_mystery_auction_announcement
            : null
        }
      />
    );
  }
  return (
    <AuthLayout>
      <SignUpPage searchParams={searchParams} />
    </AuthLayout>
  );
}
