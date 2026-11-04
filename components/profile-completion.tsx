"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ProfileFavoriteBinders } from "@/components/profile-favorite-binders";
import { ProfilePrivate } from "@/components/profile-private";
import type { Profile, ProfileDetails } from "@/lib/data/profile";
export function ProfileCompletion({
  profile,
  details,
  detailsError,
  isMe,
  loadCards
}: {
  profile: Profile;
  details?: ProfileDetails;
  detailsError: string;
  isMe: boolean;
  loadCards?: typeof import("@/lib/data/profile").getFriendPaniniAlbumCardsPage;
}) {
  const t = useTranslations();
  return (
    <>
      {!profile.canViewCollection ? (
        <ProfilePrivate />
      ) : details?.favoriteAlbums.length ? (
        <ProfileFavoriteBinders
          key={profile.id}
          ownerId={profile.id}
          ownerName={profile.pseudo}
          albums={details.favoriteAlbums}
          loadCards={loadCards}
        />
      ) : !details ? (
        <p className="yk-profile-empty">
          {detailsError
            ? t("profileUi.binderProgressUnavailable")
            : t("profileUi.loadingProgress")}
        </p>
      ) : (
        <div className="yk-profile-surface yk-profile-completion-empty">
          <span aria-hidden="true">☆</span>
          <h3>{t("profileUi.noFavoriteBindersYet")}</h3>
          <p>{t("profileUi.favoriteBindersHint")}</p>
          {isMe && (
            <Link className="yk-button yk-button-secondary" href="/collection">
              {t("profileUi.chooseMyFavoriteBinders")}{" "}
            </Link>
          )}
        </div>
      )}
    </>
  );
}
