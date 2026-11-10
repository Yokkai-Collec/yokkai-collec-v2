import { NextIntlClientProvider } from "next-intl";
import { ProfileFavoriteBindersPreview } from "@/components/profile-favorite-binders-preview";
import english from "@/messages/en.json";
import french from "@/messages/fr.json";
export default async function Page({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const locale = search.lang === "en" ? "en" : "fr";
  const messages = locale === "fr" ? french : english;
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{
        profileUi: messages.profileUi,
        collectionUi: messages.collectionUi,
        collectionShared: messages.collectionShared,
        common: messages.common
      }}
    >
      <ProfileFavoriteBindersPreview
        count={search.count === "0" ? 0 : search.count === "1" ? 1 : 25}
        privateProfile={search.private === "1"}
        fail={search.fail === "1"}
      />
    </NextIntlClientProvider>
  );
}
